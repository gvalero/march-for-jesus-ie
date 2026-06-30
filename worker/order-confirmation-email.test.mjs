import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildOrderConfirmationEmail,
  createStripeCheckoutSession,
  getMicrosoftGraphMailConfig
} from './merch-order-worker.js';

test('buildOrderConfirmationEmail escapes order line content', () => {
  const html = buildOrderConfirmationEmail({
    order: {
      id: '12345678-0000-4000-8000-000000000001',
      amount_total: 2000,
      currency: 'gbp'
    },
    lines: [{
      product_name: '<script>alert("x")</script>',
      colour: 'Cream & Burgundy',
      size: 'M',
      quantity: 1,
      total_amount: 2000
    }]
  });

  assert.match(html, /Your order is confirmed/);
  assert.match(html, /12345678/);
  assert.match(html, /Cream &amp; Burgundy/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /£20\.00/);
});

test('getMicrosoftGraphMailConfig defaults to MFJ sender and validates tenant', () => {
  const config = getMicrosoftGraphMailConfig({
    MICROSOFT_GRAPH_TENANT_ID: 'ccbeac7f-5f2b-4e2f-96fb-71bba535ccf3',
    MICROSOFT_GRAPH_CLIENT_ID: 'client-id',
    MICROSOFT_GRAPH_CLIENT_SECRET: 'client-secret'
  });

  assert.equal(config.sender, 'information@marchforjesus.ie');
  assert.equal(config.tenantId, 'ccbeac7f-5f2b-4e2f-96fb-71bba535ccf3');
});

test('createStripeCheckoutSession passes customer email through to Stripe receipt fields', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody = '';

  globalThis.fetch = async (_url, options) => {
    requestBody = String(options.body);
    return new Response(JSON.stringify({
      id: 'cs_test_123',
      url: 'https://checkout.stripe.test/session'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  try {
    await createStripeCheckoutSession({
      STRIPE_SECRET_KEY: 'sk_test_123',
      STRIPE_KEY_MODE: 'test',
      SITE_URL: 'https://marchforjesus.co.uk'
    }, 'reservation-123', [{
      quantity: 1,
      variant: {
        id: 'mfj-logo-tshirt-cream-m',
        productName: 'MFJ Logo T-shirt',
        colour: 'Cream',
        size: 'M',
        priceGbp: 20
      }
    }], 'customer@example.com');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(requestBody, /customer_email=customer%40example\.com/);
  assert.match(requestBody, /payment_intent_data%5Breceipt_email%5D=customer%40example\.com/);
});
