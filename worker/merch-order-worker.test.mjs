import assert from 'node:assert/strict';
import test from 'node:test';
import { listVariants } from './merch-catalog.js';
import {
  ResponseError,
  buildSharePointOrderFields,
  createStripeCheckoutSession,
  csvEscape,
  getMicrosoftGraphAccessToken,
  getStripeSecretKey,
  isMicrosoftGraphSharePointConfigured,
  isValidEmail,
  normaliseLineItems,
  rollbackSharePointOrderLines,
  writeSharePointOrderLines,
  verifyStripeTimestamp
} from './merch-order-worker.js';

const graphEnv = {
  MICROSOFT_GRAPH_TENANT_ID: 'ccbeac7f-5f2b-4e2f-96fb-71bba535ccf3',
  MICROSOFT_GRAPH_CLIENT_ID: 'client-id',
  MICROSOFT_GRAPH_CLIENT_SECRET: 'client-secret',
  MICROSOFT_GRAPH_SITE_ID: 'site-id',
  MICROSOFT_GRAPH_LIST_ID: 'list-id'
};

function graphPayload(lines) {
  return {
    order: {
      id: 'order-1',
      stripe_checkout_session_id: 'cs_test_123',
      stripe_payment_intent_id: 'pi_test_123',
      customer_name: 'Example Customer',
      customer_email: 'customer@example.com',
      currency: 'gbp',
      payment_status: 'paid',
      collection_status: 'not_collected',
      created_at: 1770000000
    },
    lines,
    totals: {
      currency: 'gbp'
    },
    milestonesCrossed: []
  };
}

test('catalog stock totals match the agreed merch allocation', () => {
  const totalStock = listVariants().reduce((sum, variant) => sum + variant.initialStock, 0);
  assert.equal(totalStock, 342);
});

test('checkout line normalisation merges duplicate variants', () => {
  const lines = normaliseLineItems([
    { variantId: 'mfj-logo-tshirt-burgundy-m', quantity: 1 },
    { variantId: 'mfj-logo-tshirt-burgundy-m', quantity: 2 }
  ]);

  assert.equal(lines.length, 1);
  assert.equal(lines[0].variant.id, 'mfj-logo-tshirt-burgundy-m');
  assert.equal(lines[0].quantity, 3);
});

test('checkout line normalisation rejects invalid variants', () => {
  assert.throws(
    () => normaliseLineItems([{ variantId: 'personal-project-shirt', quantity: 1 }]),
    ResponseError
  );
});

test('Stripe key guard rejects profile/key mode mismatches', () => {
  assert.equal(
    getStripeSecretKey({ STRIPE_KEY_MODE: 'test', STRIPE_SECRET_KEY: 'sk_test_123' }),
    'sk_test_123'
  );

  assert.throws(
    () => getStripeSecretKey({ STRIPE_KEY_MODE: 'test', STRIPE_SECRET_KEY: 'sk_live_123' }),
    ResponseError
  );
});

test('Stripe Checkout Session is configured for collection, not shipping', async (t) => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (_url, options = {}) => {
    requestBody = new URLSearchParams(options.body);
    return new Response(JSON.stringify({
      id: 'cs_test_collection',
      url: 'https://checkout.stripe.com/c/pay/cs_test_collection'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  await createStripeCheckoutSession({
    STRIPE_KEY_MODE: 'test',
    STRIPE_SECRET_KEY: 'sk_test_123',
    SITE_URL: 'https://marchforjesus.ie'
  }, 'reservation-1', [{
    variant: listVariants()[0],
    quantity: 1
  }], 'customer@example.com');

  assert.equal(requestBody.get('billing_address_collection'), 'auto');
  assert.equal(requestBody.get('customer_email'), 'customer@example.com');
  assert.equal(requestBody.get('payment_intent_data[receipt_email]'), 'customer@example.com');
  assert.equal(requestBody.get('shipping_address_collection[allowed_countries][0]'), null);
  assert.equal(requestBody.get('shipping_address_collection[allowed_countries][1]'), null);
  assert.match(
    requestBody.get('line_items[0][price_data][product_data][description]'),
    /Collection at the March for Jesus Dublin event/
  );
});

test('Stripe webhook timestamp guard rejects stale replay attempts', () => {
  verifyStripeTimestamp('1000', 1100);
  assert.throws(() => verifyStripeTimestamp('1000', 1401), ResponseError);
  assert.throws(() => verifyStripeTimestamp('not-a-time', 1401), ResponseError);
});

test('customer email validation accepts normal emails and rejects malformed input', () => {
  assert.equal(isValidEmail('orders@marchforjesus.co.uk'), true);
  assert.equal(isValidEmail('bad-email'), false);
  assert.equal(isValidEmail('orders@example'), false);
});

test('CSV export escapes values safely', () => {
  assert.equal(csvEscape('plain'), 'plain');
  assert.equal(csvEscape('hello, "MFJ"'), '"hello, ""MFJ"""');
});

test('direct SharePoint config rejects partial Microsoft Graph bindings', () => {
  assert.equal(isMicrosoftGraphSharePointConfigured({}), false);

  assert.throws(
    () => isMicrosoftGraphSharePointConfigured({
      MICROSOFT_GRAPH_TENANT_ID: 'ccbeac7f-5f2b-4e2f-96fb-71bba535ccf3'
    }),
    ResponseError
  );
});

test('SharePoint order fields map paid line payloads to list columns', () => {
  const fields = buildSharePointOrderFields({
    order: {
      id: 'order-1',
      stripe_checkout_session_id: 'cs_test_123',
      stripe_payment_intent_id: 'pi_test_123',
      customer_name: 'Example Customer',
      customer_email: 'customer@example.com',
      currency: 'gbp',
      payment_status: 'paid',
      collection_status: 'not_collected',
      created_at: 1770000000
    },
    lines: [],
    totals: {
      currency: 'gbp'
    },
    milestonesCrossed: [10, 20]
  }, {
    product_name: 'MFJ Logo T-shirt',
    colour: 'Burgundy',
    size: 'M',
    quantity: 2,
    unit_amount: 2000,
    total_amount: 4000
  });

  assert.equal(fields.Title, 'MFJ Logo T-shirt');
  assert.equal(fields.OrderID, 'order-1');
  assert.equal(fields.CustomerEmail, 'customer@example.com');
  assert.equal(fields.Quantity, 2);
  assert.equal(fields.UnitPrice, 20);
  assert.equal(fields.TotalPaid, 40);
  assert.equal(fields.Currency, 'GBP');
  assert.equal(fields.MilestoneAlert, '10, 20');
  assert.match(fields.RawOrderJSON, /order-1/);
});

test('Microsoft Graph token request rejects malformed success responses', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(JSON.stringify({}), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  await assert.rejects(
    () => getMicrosoftGraphAccessToken({
      tenantId: 'ccbeac7f-5f2b-4e2f-96fb-71bba535ccf3',
      clientId: 'client-id',
      clientSecret: 'client-secret'
    }),
    /access token/
  );
});

test('SharePoint line write rolls back earlier rows if a later line fails', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).includes('/oauth2/v2.0/token')) {
      return new Response(JSON.stringify({ access_token: 'graph-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (options.method === 'POST' && calls.filter((call) => call.method === 'POST' && call.url.includes('/lists/')).length === 1) {
      return new Response(JSON.stringify({ id: 'created-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (options.method === 'POST') {
      return new Response('second row failed', { status: 500 });
    }
    if ((options.method || 'GET') === 'GET' && String(url).includes('/lists/')) {
      return new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (options.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response('unexpected call', { status: 500 });
  };

  await assert.rejects(
    () => writeSharePointOrderLines(graphEnv, graphPayload([
      {
        product_name: 'MFJ Logo T-shirt',
        colour: 'Burgundy',
        size: 'M',
        quantity: 1,
        unit_amount: 2000,
        total_amount: 2000
      },
      {
        product_name: 'MFJ Cap',
        colour: 'Cream',
        size: 'One Size',
        quantity: 1,
        unit_amount: 2000,
        total_amount: 2000
      }
    ])),
    /second row failed/
  );

  assert.equal(calls.filter((call) => call.method === 'DELETE').length, 1);
  assert.match(calls.find((call) => call.method === 'DELETE').url, /created-1/);
});

test('SharePoint rollback deletes all earlier rows when a later line fails', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  let listPostCount = 0;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).includes('/oauth2/v2.0/token')) {
      return new Response(JSON.stringify({ access_token: 'graph-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (options.method === 'POST' && String(url).includes('/lists/')) {
      listPostCount += 1;
      if (listPostCount <= 2) {
        return new Response(JSON.stringify({ id: `created-${listPostCount}` }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      return new Response('third row failed', { status: 500 });
    }
    if ((options.method || 'GET') === 'GET' && String(url).includes('/lists/')) {
      return new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (options.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response('unexpected call', { status: 500 });
  };

  const line = {
    product_name: 'MFJ Logo T-shirt',
    colour: 'Burgundy',
    size: 'M',
    quantity: 1,
    unit_amount: 2000,
    total_amount: 2000
  };

  await assert.rejects(
    () => writeSharePointOrderLines(graphEnv, graphPayload([line, line, line])),
    /third row failed/
  );

  const deleteCalls = calls.filter((call) => call.method === 'DELETE');
  assert.equal(deleteCalls.length, 2);
  assert.match(deleteCalls[0].url, /created-1/);
  assert.match(deleteCalls[1].url, /created-2/);
});

test('SharePoint rollback sweeps by order ID if created row response is malformed', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).includes('/oauth2/v2.0/token')) {
      return new Response(JSON.stringify({ access_token: 'graph-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (options.method === 'POST' && String(url).includes('/lists/')) {
      return new Response('{not-json', {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if ((options.method || 'GET') === 'GET' && String(url).includes('/lists/')) {
      return new Response(JSON.stringify({ value: [{ id: 'swept-by-order-id' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (options.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response('unexpected call', { status: 500 });
  };

  await assert.rejects(
    () => writeSharePointOrderLines(graphEnv, graphPayload([
      {
        product_name: 'MFJ Logo T-shirt',
        colour: 'Burgundy',
        size: 'M',
        quantity: 1,
        unit_amount: 2000,
        total_amount: 2000
      }
    ])),
    /Unexpected token|JSON/
  );

  assert.ok(calls.some((call) => call.method === 'GET' && call.url.includes('OrderID')));
  const deleteCall = calls.find((call) => call.method === 'DELETE');
  assert.match(deleteCall.url, /swept-by-order-id/);
});

test('SharePoint rollback sweeps by order ID if created row response is null', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET' });
    if (String(url).includes('/oauth2/v2.0/token')) {
      return new Response(JSON.stringify({ access_token: 'graph-token' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (options.method === 'POST' && String(url).includes('/lists/')) {
      return new Response(JSON.stringify(null), {
        status: 201,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if ((options.method || 'GET') === 'GET' && String(url).includes('/lists/')) {
      return new Response(JSON.stringify({ value: [{ id: 'null-response-sweep' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    if (options.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response('unexpected call', { status: 500 });
  };

  await assert.rejects(
    () => writeSharePointOrderLines(graphEnv, graphPayload([
      {
        product_name: 'MFJ Logo T-shirt',
        colour: 'Burgundy',
        size: 'M',
        quantity: 1,
        unit_amount: 2000,
        total_amount: 2000
      }
    ])),
    /did not include an item ID/
  );

  const deleteCall = calls.find((call) => call.method === 'DELETE');
  assert.match(deleteCall.url, /null-response-sweep/);
});

test('SharePoint rollback sweep requires an order ID', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(JSON.stringify({ value: [] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });

  await assert.rejects(
    () => rollbackSharePointOrderLines('https://graph.microsoft.com/v1.0/sites/site-id/lists/list-id/items', 'graph-token', '', []),
    /Order ID required/
  );
});
