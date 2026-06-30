import { MERCH_CATALOG, findVariant, listVariants } from './merch-catalog.js';

const ALLOWED_ORIGINS = [
  'https://marchforjesus.ie',
  'https://www.marchforjesus.ie',
  'https://gvalero.github.io',
  'http://localhost:8080',
  'http://localhost:5173'
];

function isAllowedOrigin(origin) {
  if (!origin) {
    return false;
  }

  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }

  if (/^http:\/\/localhost:\d+$/.test(origin)) {
    return true;
  }

  if (/^https:\/\/[a-z0-9-]+-\d+\.app\.github\.dev$/i.test(origin)) {
    return true;
  }

  return false;
}

const RESERVATION_TTL_SECONDS = 30 * 60;
const ALERT_INTERVAL = 10;
const EXPECTED_PROFILE = 'mfj-dublin-merch';
const EXPECTED_MICROSOFT_TENANT = 'allnations.ie';
const EXPECTED_MICROSOFT_TENANT_ID = 'ccbeac7f-5f2b-4e2f-96fb-71bba535ccf3';
const GRAPH_SHAREPOINT_KEYS = [
  'MICROSOFT_GRAPH_TENANT_ID',
  'MICROSOFT_GRAPH_CLIENT_ID',
  'MICROSOFT_GRAPH_CLIENT_SECRET',
  'MICROSOFT_GRAPH_SITE_ID',
  'MICROSOFT_GRAPH_LIST_ID'
];
const GRAPH_AUTH_KEYS = [
  'MICROSOFT_GRAPH_TENANT_ID',
  'MICROSOFT_GRAPH_CLIENT_ID',
  'MICROSOFT_GRAPH_CLIENT_SECRET'
];
const DEFAULT_MERCH_CONFIRMATION_SENDER = 'information@marchforjesus.ie';
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function jsonResponse(body, status = 200, origin = '') {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json'
    }
  });
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Stripe-Signature',
    'Access-Control-Max-Age': '86400'
  };
}

function requireBinding(env, key) {
  if (!env[key]) {
    throw new Error(`Missing required binding: ${key}`);
  }
  return env[key];
}

function getUnixTime() {
  return Math.floor(Date.now() / 1000);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normaliseLineItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ResponseError('Choose at least one merch item before checking out.', 400);
  }

  const quantities = new Map();
  for (const item of rawItems) {
    const variantId = String(item.variantId || '').trim();
    const quantity = Number(item.quantity);
    if (!variantId || !Number.isInteger(quantity) || quantity < 1) {
      throw new ResponseError('One or more checkout items are invalid.', 400);
    }
    quantities.set(variantId, (quantities.get(variantId) || 0) + quantity);
  }

  return Array.from(quantities, ([variantId, quantity]) => {
    const variant = findVariant(variantId);
    if (!variant) {
      throw new ResponseError(`Unknown merch option: ${variantId}`, 400);
    }
    return { variant, quantity };
  });
}

class ResponseError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function assertRuntimeProfile(env) {
  if (env.PROFILE_NAME !== EXPECTED_PROFILE) {
    throw new ResponseError(`Merch checkout profile mismatch. Expected ${EXPECTED_PROFILE}.`, 500);
  }
}

function getStripeSecretKey(env) {
  const stripeSecretKey = requireBinding(env, 'STRIPE_SECRET_KEY');
  const stripeKeyMode = requireBinding(env, 'STRIPE_KEY_MODE');
  const expectedPrefix = `sk_${stripeKeyMode}_`;

  if (!['test', 'live'].includes(stripeKeyMode)) {
    throw new ResponseError('Stripe key mode must be test or live.', 500);
  }

  if (!stripeSecretKey.startsWith(expectedPrefix)) {
    throw new ResponseError(`Stripe key does not match configured ${stripeKeyMode} profile.`, 500);
  }

  return stripeSecretKey;
}

function getMicrosoftProfile(env) {
  if (env.MICROSOFT_PROFILE_NAME !== EXPECTED_PROFILE) {
    throw new ResponseError(`Microsoft automation profile mismatch. Expected ${EXPECTED_PROFILE}.`, 500);
  }

  return env.MICROSOFT_PROFILE_NAME;
}

function getMicrosoftTenant(env) {
  if (env.MICROSOFT_TENANT_DOMAIN !== EXPECTED_MICROSOFT_TENANT) {
    throw new ResponseError(`Microsoft tenant mismatch. Expected ${EXPECTED_MICROSOFT_TENANT}.`, 500);
  }

  return env.MICROSOFT_TENANT_DOMAIN;
}

function getMicrosoftGraphAuthConfig(env) {
  const presentKeys = GRAPH_AUTH_KEYS.filter((key) => env[key]);
  if (presentKeys.length !== GRAPH_AUTH_KEYS.length) {
    const missingKeys = GRAPH_AUTH_KEYS.filter((key) => !env[key]);
    throw new ResponseError(`Incomplete Microsoft Graph auth configuration. Missing: ${missingKeys.join(', ')}.`, 500);
  }

  if (env.MICROSOFT_GRAPH_TENANT_ID !== EXPECTED_MICROSOFT_TENANT_ID) {
    throw new ResponseError(`Microsoft Graph tenant ID mismatch. Expected ${EXPECTED_MICROSOFT_TENANT_ID}.`, 500);
  }

  return {
    tenantId: env.MICROSOFT_GRAPH_TENANT_ID,
    clientId: env.MICROSOFT_GRAPH_CLIENT_ID,
    clientSecret: env.MICROSOFT_GRAPH_CLIENT_SECRET
  };
}

function isMicrosoftGraphSharePointConfigured(env) {
  const presentKeys = GRAPH_SHAREPOINT_KEYS.filter((key) => env[key]);
  if (presentKeys.length === 0) {
    return false;
  }

  if (presentKeys.length !== GRAPH_SHAREPOINT_KEYS.length) {
    const missingKeys = GRAPH_SHAREPOINT_KEYS.filter((key) => !env[key]);
    throw new ResponseError(`Incomplete Microsoft Graph SharePoint configuration. Missing: ${missingKeys.join(', ')}.`, 500);
  }

  return true;
}

function getMicrosoftGraphSharePointConfig(env) {
  if (!isMicrosoftGraphSharePointConfigured(env)) {
    return null;
  }

  const authConfig = getMicrosoftGraphAuthConfig(env);
  return {
    ...authConfig,
    siteId: env.MICROSOFT_GRAPH_SITE_ID,
    listId: env.MICROSOFT_GRAPH_LIST_ID
  };
}

function getMicrosoftGraphMailConfig(env) {
  const authConfig = getMicrosoftGraphAuthConfig(env);
  const sender = String(env.MERCH_CONFIRMATION_SENDER || DEFAULT_MERCH_CONFIRMATION_SENDER).trim();

  if (!isValidEmail(sender)) {
    throw new ResponseError('MERCH_CONFIRMATION_SENDER must be a valid email address.', 500);
  }

  return {
    ...authConfig,
    sender
  };
}

function requireAdmin(request, env) {
  const token = requireBinding(env, 'ADMIN_API_TOKEN');
  const expectedHeader = `Bearer ${token}`;
  const actualHeader = request.headers.get('Authorization') || '';

  if (actualHeader !== expectedHeader) {
    throw new ResponseError('Admin access is required.', 401);
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) {
    return '';
  }

  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function ensureInventory(db) {
  const statements = listVariants().map((variant) => db.prepare(`
    INSERT INTO inventory (variant_id, initial_stock, reserved_quantity, sold_quantity, updated_at)
    VALUES (?, ?, 0, 0, datetime('now'))
    ON CONFLICT(variant_id) DO UPDATE SET
      initial_stock = excluded.initial_stock,
      updated_at = datetime('now')
  `).bind(variant.id, variant.initialStock));

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

async function releaseReservation(db, reservationId, finalStatus = 'expired') {
  const reservation = await db.prepare(`
    SELECT id, status
    FROM reservations
    WHERE id = ?
  `).bind(reservationId).first();

  if (!reservation || reservation.status !== 'pending') {
    return false;
  }

  const lines = await db.prepare(`
    SELECT variant_id, quantity
    FROM reservation_lines
    WHERE reservation_id = ?
  `).bind(reservationId).all();

  for (const line of lines.results || []) {
    await db.prepare(`
      UPDATE inventory
      SET reserved_quantity = MAX(reserved_quantity - ?, 0),
          updated_at = datetime('now')
      WHERE variant_id = ?
    `).bind(line.quantity, line.variant_id).run();
  }

  await db.prepare(`
    UPDATE reservations
    SET status = ?
    WHERE id = ?
  `).bind(finalStatus, reservationId).run();

  return true;
}

async function cleanupExpiredReservations(db) {
  const now = getUnixTime();
  const expired = await db.prepare(`
    SELECT id
    FROM reservations
    WHERE status = 'pending'
      AND expires_at <= ?
    LIMIT 50
  `).bind(now).all();

  for (const reservation of expired.results || []) {
    await releaseReservation(db, reservation.id, 'expired');
  }
}

async function releaseReservedVariants(db, reservedLines) {
  for (const line of reservedLines) {
    await db.prepare(`
      UPDATE inventory
      SET reserved_quantity = MAX(reserved_quantity - ?, 0),
          updated_at = datetime('now')
      WHERE variant_id = ?
    `).bind(line.quantity, line.variant.id).run();
  }
}

async function getCatalogWithAvailability(db) {
  await ensureInventory(db);
  await cleanupExpiredReservations(db);

  const rows = await db.prepare(`
    SELECT variant_id, initial_stock, reserved_quantity, sold_quantity
    FROM inventory
  `).all();

  const inventory = new Map((rows.results || []).map((row) => [
    row.variant_id,
    {
      initialStock: Number(row.initial_stock),
      reserved: Number(row.reserved_quantity),
      sold: Number(row.sold_quantity)
    }
  ]));

  return MERCH_CATALOG.map((product) => ({
    ...product,
    sizes: product.sizes.map((size) => {
      const stock = inventory.get(size.id) || {
        initialStock: size.stock,
        reserved: 0,
        sold: 0
      };
      const available = Math.max(stock.initialStock - stock.reserved - stock.sold, 0);
      return {
        ...size,
        initialStock: stock.initialStock,
        reserved: stock.reserved,
        sold: stock.sold,
        available
      };
    })
  }));
}

async function reserveItems(db, reservationId, lines) {
  const reserved = [];
  const insertedLines = [];

  for (const line of lines) {
    try {
      const result = await db.prepare(`
        UPDATE inventory
        SET reserved_quantity = reserved_quantity + ?,
            updated_at = datetime('now')
        WHERE variant_id = ?
          AND initial_stock - sold_quantity - reserved_quantity >= ?
        RETURNING variant_id
      `).bind(line.quantity, line.variant.id, line.quantity).first();

      if (!result) {
        await releaseReservedVariants(db, reserved);
        await db.prepare('DELETE FROM reservation_lines WHERE reservation_id = ?').bind(reservationId).run();
        throw new ResponseError(`${line.variant.productName} ${line.variant.colour} ${line.variant.size} is no longer available in the requested quantity.`, 409);
      }

      reserved.push(line);

      await db.prepare(`
        INSERT INTO reservation_lines (
          reservation_id,
          variant_id,
          product_name,
          colour,
          size,
          quantity,
          unit_amount
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        reservationId,
        line.variant.id,
        line.variant.productName,
        line.variant.colour,
        line.variant.size,
        line.quantity,
        line.variant.priceGbp * 100
      ).run();

      insertedLines.push(line);
    } catch (error) {
      if (!(error instanceof ResponseError)) {
        await releaseReservedVariants(db, reserved);
        if (insertedLines.length > 0) {
          await db.prepare('DELETE FROM reservation_lines WHERE reservation_id = ?').bind(reservationId).run();
        }
      }
      throw error;
    }
  }
}

function appendFormValue(params, key, value) {
  if (value !== undefined && value !== null && value !== '') {
    params.append(key, String(value));
  }
}

async function createStripeCheckoutSession(env, reservationId, lines, customerEmail) {
  const stripeSecretKey = getStripeSecretKey(env);
  const siteUrl = env.SITE_URL || 'https://marchforjesus.ie';
  const params = new URLSearchParams();

  appendFormValue(params, 'mode', 'payment');
  appendFormValue(params, 'success_url', `${siteUrl}/shop-success.html?session_id={CHECKOUT_SESSION_ID}`);
  appendFormValue(params, 'cancel_url', `${siteUrl}/?checkout=cancelled`);
  appendFormValue(params, 'metadata[reservation_id]', reservationId);
  appendFormValue(params, 'metadata[channel]', 'mfj_dublin_merch');
  appendFormValue(params, 'payment_intent_data[metadata][reservation_id]', reservationId);
  appendFormValue(params, 'payment_intent_data[metadata][channel]', 'mfj_dublin_merch');
  appendFormValue(params, 'expires_at', getUnixTime() + RESERVATION_TTL_SECONDS);
  appendFormValue(params, 'allow_promotion_codes', 'false');
  appendFormValue(params, 'billing_address_collection', 'auto');

  if (customerEmail) {
    appendFormValue(params, 'customer_email', customerEmail);
    appendFormValue(params, 'payment_intent_data[receipt_email]', customerEmail);
  }

  lines.forEach((line, index) => {
    const productTitle = `${line.variant.productName} - ${line.variant.colour} - ${line.variant.size}`;
    appendFormValue(params, `line_items[${index}][quantity]`, line.quantity);
    appendFormValue(params, `line_items[${index}][price_data][currency]`, 'gbp');
    appendFormValue(params, `line_items[${index}][price_data][unit_amount]`, line.variant.priceGbp * 100);
    appendFormValue(params, `line_items[${index}][price_data][product_data][name]`, productTitle);
    appendFormValue(params, `line_items[${index}][price_data][product_data][description]`, 'Collection at the March for Jesus Dublin event (collection point TBC).');
    appendFormValue(params, `line_items[${index}][price_data][product_data][metadata][variant_id]`, line.variant.id);
  });

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params
  });

  const data = await response.json();
  if (!response.ok) {
    throw new ResponseError(data.error?.message || 'Stripe could not create a checkout session.', 502);
  }

  return data;
}

async function handleCatalog(request, env, origin) {
  const db = requireBinding(env, 'MERCH_DB');
  const catalog = await getCatalogWithAvailability(db);
  const totalInitialStock = catalog.reduce((sum, product) => sum + product.sizes.reduce((sizeSum, size) => sizeSum + size.initialStock, 0), 0);
  const totalAvailable = catalog.reduce((sum, product) => sum + product.sizes.reduce((sizeSum, size) => sizeSum + size.available, 0), 0);

  return jsonResponse({
    catalog,
    totals: {
      initialStock: totalInitialStock,
      available: totalAvailable
    }
  }, 200, origin);
}

async function handleCheckout(request, env, origin) {
  const db = requireBinding(env, 'MERCH_DB');
  await ensureInventory(db);
  await cleanupExpiredReservations(db);

  const body = await request.json();
  const lines = normaliseLineItems(body.items);
  const customerEmail = body.customerEmail ? String(body.customerEmail).trim() : '';
  if (!customerEmail || !isValidEmail(customerEmail)) {
    throw new ResponseError('Enter a valid email address for your Stripe receipt.', 400);
  }

  const reservationId = crypto.randomUUID();
  const now = getUnixTime();
  const expiresAt = now + RESERVATION_TTL_SECONDS;

  await db.prepare(`
    INSERT INTO reservations (id, status, customer_email, amount_total, currency, expires_at, created_at)
    VALUES (?, 'pending', ?, 0, 'gbp', ?, ?)
  `).bind(reservationId, customerEmail || null, expiresAt, now).run();

  try {
    await reserveItems(db, reservationId, lines);
    const amountTotal = lines.reduce((sum, line) => sum + (line.variant.priceGbp * 100 * line.quantity), 0);
    await db.prepare(`
      UPDATE reservations
      SET amount_total = ?
      WHERE id = ?
    `).bind(amountTotal, reservationId).run();

    const session = await createStripeCheckoutSession(env, reservationId, lines, customerEmail);
    await db.prepare(`
      UPDATE reservations
      SET stripe_checkout_session_id = ?
      WHERE id = ?
    `).bind(session.id, reservationId).run();

    return jsonResponse({
      reservationId,
      checkoutUrl: session.url,
      expiresAt
    }, 200, origin);
  } catch (error) {
    await releaseReservation(db, reservationId, 'failed');
    throw error;
  }
}

async function verifyStripeSignature(request, env, rawBody) {
  const webhookSecret = requireBinding(env, 'STRIPE_WEBHOOK_SECRET');
  const signature = request.headers.get('Stripe-Signature') || '';
  const timestamp = signature.split(',').find((part) => part.startsWith('t='))?.slice(2);
  const expectedSignature = signature.split(',').find((part) => part.startsWith('v1='))?.slice(3);

  if (!timestamp || !expectedSignature) {
    throw new ResponseError('Missing Stripe webhook signature.', 400);
  }

  verifyStripeTimestamp(timestamp, getUnixTime());

  const payload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const actualSignature = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');

  if (actualSignature !== expectedSignature) {
    throw new ResponseError('Invalid Stripe webhook signature.', 400);
  }
}

function verifyStripeTimestamp(timestamp, now) {
  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber)) {
    throw new ResponseError('Invalid Stripe webhook timestamp.', 400);
  }

  if (Math.abs(now - timestampNumber) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    throw new ResponseError('Expired Stripe webhook timestamp.', 400);
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function formatCurrencyMinor(amount, currency) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: String(currency || 'gbp').toUpperCase()
  }).format(Number(amount || 0) / 100);
}

function buildOrderConfirmationEmail(payload) {
  const order = payload.order;
  const orderReference = String(order.id).slice(0, 8).toUpperCase();
  const customerName = order.customer_name ? ` ${escapeHtml(order.customer_name)}` : '';
  const itemCount = Number(payload.totals?.itemCount || (payload.lines || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0));
  const totalPaid = formatCurrencyMinor(order.amount_total, order.currency);
  const rows = (payload.lines || []).map((line) => `
    <tr>
      <td style="padding:16px 0;border-bottom:1px solid #eadfce;">
        <strong style="display:block;color:#4d0921;font-size:16px;line-height:1.35;">${escapeHtml(line.product_name)}</strong>
        <span style="display:block;color:#6b5f55;font-size:14px;line-height:1.5;">${escapeHtml(line.colour)} / ${escapeHtml(line.size)}</span>
      </td>
      <td style="padding:16px 12px;border-bottom:1px solid #eadfce;text-align:center;color:#4d0921;font-weight:700;">${escapeHtml(line.quantity)}</td>
      <td style="padding:16px 0;border-bottom:1px solid #eadfce;text-align:right;color:#4d0921;font-weight:700;">${escapeHtml(formatCurrencyMinor(line.total_amount, order.currency))}</td>
    </tr>
  `).join('');

  return `
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your March for Jesus Dublin merch order is confirmed. Bring this email to collection (point TBC).</div>
    <div style="margin:0;padding:0;background:#f8eee0;color:#4d0921;font-family:Arial,Helvetica,sans-serif;">
      <div style="max-width:680px;margin:0 auto;padding:28px 16px;">
        <div style="background:#4d0921;border-radius:28px 28px 0 0;padding:32px 28px;text-align:center;">
          <div style="display:inline-block;border:1px solid rgba(248,238,224,0.42);border-radius:999px;color:#f8eee0;font-size:12px;font-weight:700;letter-spacing:0.16em;padding:9px 14px;text-transform:uppercase;">March for Jesus Dublin</div>
          <h1 style="margin:22px 0 8px;color:#f8eee0;font-size:38px;line-height:1.02;letter-spacing:0.02em;">Your order is confirmed</h1>
          <p style="margin:0;color:#eadfce;font-size:16px;line-height:1.55;">Thanks${customerName} - your merch is reserved for collection at the March for Jesus Dublin event (collection point TBC).</p>
        </div>
        <div style="background:#ffffff;border:1px solid #eadfce;border-top:0;border-radius:0 0 28px 28px;padding:28px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:0 0 24px;">
            <tr>
              <td style="background:#f8eee0;border-radius:18px;padding:18px;text-align:center;">
                <span style="display:block;color:#6b5f55;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Order reference</span>
                <strong style="display:block;color:#4d0921;font-size:26px;letter-spacing:0.08em;margin-top:6px;">${escapeHtml(orderReference)}</strong>
              </td>
              <td width="12"></td>
              <td style="background:#f8eee0;border-radius:18px;padding:18px;text-align:center;">
                <span style="display:block;color:#6b5f55;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Total paid</span>
                <strong style="display:block;color:#4d0921;font-size:26px;margin-top:6px;">${escapeHtml(totalPaid)}</strong>
              </td>
            </tr>
          </table>
          <div style="border:1px solid #eadfce;border-radius:22px;padding:4px 18px 0;margin:0 0 24px;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
              <thead>
                <tr>
                  <th align="left" style="padding:14px 0;border-bottom:2px solid #4d0921;color:#4d0921;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">Item</th>
                  <th align="center" style="padding:14px 12px;border-bottom:2px solid #4d0921;color:#4d0921;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">Qty</th>
                  <th align="right" style="padding:14px 0;border-bottom:2px solid #4d0921;color:#4d0921;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;">Total</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div style="background:#fff8ed;border-left:5px solid #4d0921;border-radius:18px;padding:18px 20px;margin:0 0 24px;">
            <h2 style="margin:0 0 8px;color:#4d0921;font-size:18px;line-height:1.3;">Collection reminder</h2>
            <p style="margin:0;color:#3d332d;font-size:15px;line-height:1.6;">Bring this email to the merch collection point at the March for Jesus Dublin event (collection point TBC). Your order contains ${escapeHtml(itemCount)} ${itemCount === 1 ? 'item' : 'items'}.</p>
          </div>
          <p style="margin:0 0 8px;color:#3d332d;font-size:15px;line-height:1.6;">If you have any questions, reply to this email or contact <a href="mailto:information@marchforjesus.ie" style="color:#4d0921;font-weight:700;">information@marchforjesus.ie</a>.</p>
          <p style="margin:20px 0 0;color:#6b5f55;font-size:12px;line-height:1.5;">You are receiving this transactional email because a merch pre-order was placed through marchforjesus.ie.</p>
        </div>
      </div>
    </div>
  `;
}

async function setOrderConfirmationEmailStatus(db, orderId, status, errorMessage = null) {
  await db.prepare(`
    UPDATE orders
    SET confirmation_email_status = ?,
        confirmation_email_error = ?,
        confirmation_email_sent_at = CASE WHEN ? = 'sent' THEN ? ELSE confirmation_email_sent_at END
    WHERE id = ?
  `).bind(status, errorMessage ? errorMessage.slice(0, 500) : null, status, getUnixTime(), orderId).run();
}

async function sendOrderConfirmationEmail(db, env, orderId, payload) {
  const order = payload.order;
  if (order.confirmation_email_status === 'sent') {
    return false;
  }

  if (!order.customer_email || !isValidEmail(order.customer_email)) {
    await setOrderConfirmationEmailStatus(db, orderId, 'failed', 'Order has no valid customer email address.');
    throw new Error('Order confirmation email could not be sent because the order has no valid customer email address.');
  }

  try {
    const config = getMicrosoftGraphMailConfig(env);
    const accessToken = await getMicrosoftGraphAccessToken(config);
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: {
          subject: 'Your March for Jesus Dublin merch order is confirmed',
          body: {
            contentType: 'HTML',
            content: buildOrderConfirmationEmail(payload)
          },
          toRecipients: [{
            emailAddress: {
              address: order.customer_email
            }
          }],
          replyTo: [{
            emailAddress: {
              address: config.sender
            }
          }]
        },
        saveToSentItems: true
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Microsoft Graph sendMail failed: ${errorText.slice(0, 500)}`);
    }

    await setOrderConfirmationEmailStatus(db, orderId, 'sent');
    return true;
  } catch (error) {
    const message = error.message || 'Microsoft Graph sendMail failed.';
    await setOrderConfirmationEmailStatus(db, orderId, 'failed', message);
    console.error('Order confirmation email failed:', message);
    throw new Error(message);
  }
}

async function getOrderIdByReservationId(db, reservationId) {
  const existingOrder = await db.prepare(`
    SELECT id
    FROM orders
    WHERE reservation_id = ?
  `).bind(reservationId).first();

  return existingOrder?.id || null;
}

async function markOrderPaid(db, env, session) {
  const reservationId = session.metadata?.reservation_id;
  if (!reservationId) {
    throw new ResponseError('Stripe session is missing reservation metadata.', 400);
  }

  const reservation = await db.prepare(`
    SELECT *
    FROM reservations
    WHERE id = ?
  `).bind(reservationId).first();

  if (!reservation) {
    throw new ResponseError(`Reservation not found: ${reservationId}`, 404);
  }

  let orderId;
  let alreadyProcessed = false;

  if (reservation.status === 'paid') {
    orderId = await getOrderIdByReservationId(db, reservationId);
    if (!orderId) {
      throw new ResponseError(`Paid reservation has no order: ${reservationId}`, 500);
    }
    alreadyProcessed = true;
  } else {
    if (reservation.status !== 'pending') {
      throw new ResponseError(`Reservation is not payable: ${reservation.status}`, 409);
    }

    const lines = await db.prepare(`
      SELECT *
      FROM reservation_lines
      WHERE reservation_id = ?
    `).bind(reservationId).all();

    const now = getUnixTime();
    orderId = crypto.randomUUID();
    const customerDetails = session.customer_details || {};
    const customerEmail = customerDetails.email || session.customer_email || reservation.customer_email || '';
    if (!isValidEmail(customerEmail)) {
      throw new ResponseError('Paid Stripe session did not include a valid customer email address.', 500);
    }

    await db.prepare(`
      INSERT INTO orders (
        id,
        reservation_id,
        stripe_checkout_session_id,
        stripe_payment_intent_id,
        customer_name,
        customer_email,
        amount_total,
        currency,
        payment_status,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      orderId,
      reservationId,
      session.id,
      session.payment_intent || null,
      customerDetails.name || null,
      customerEmail,
      session.amount_total || reservation.amount_total,
      session.currency || reservation.currency,
      session.payment_status || 'paid',
      now
    ).run();

    for (const line of lines.results || []) {
      await db.prepare(`
        UPDATE inventory
        SET reserved_quantity = MAX(reserved_quantity - ?, 0),
            sold_quantity = sold_quantity + ?,
            updated_at = datetime('now')
        WHERE variant_id = ?
      `).bind(line.quantity, line.quantity, line.variant_id).run();

      await db.prepare(`
        INSERT INTO order_lines (
          order_id,
          variant_id,
          product_name,
          colour,
          size,
          quantity,
          unit_amount,
          total_amount
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        orderId,
        line.variant_id,
        line.product_name,
        line.colour,
        line.size,
        line.quantity,
        line.unit_amount,
        line.unit_amount * line.quantity
      ).run();
    }

    await db.prepare(`
      UPDATE reservations
      SET status = 'paid',
          paid_at = ?
      WHERE id = ?
    `).bind(now, reservationId).run();
  }

  let order = await getOrderPayload(db, orderId);
  await sendOrderConfirmationEmail(db, env, orderId, order);
  order = await getOrderPayload(db, orderId);

  const milestonesCrossed = alreadyProcessed ? [] : await recordMilestones(db);
  if (!['synced', 'partial_sync'].includes(order.order.microsoft_sync_status)) {
    await sendMicrosoftHandoff(db, env, orderId, {
      ...order,
      milestonesCrossed
    });
  }

  return { orderId, milestonesCrossed, alreadyProcessed };
}

async function getOrderPayload(db, orderId) {
  const order = await db.prepare(`
    SELECT *
    FROM orders
    WHERE id = ?
  `).bind(orderId).first();

  const lines = await db.prepare(`
    SELECT *
    FROM order_lines
    WHERE order_id = ?
  `).bind(orderId).all();

  const totalItems = (lines.results || []).reduce((sum, line) => sum + Number(line.quantity), 0);

  return {
    order,
    lines: lines.results || [],
    totals: {
      itemCount: totalItems,
      amountTotal: order.amount_total,
      currency: order.currency
    }
  };
}

async function recordMilestones(db) {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS total_items
    FROM order_lines
  `).first();

  const totalItems = Number(row.total_items || 0);
  const crossed = [];

  for (let milestone = ALERT_INTERVAL; milestone <= totalItems; milestone += ALERT_INTERVAL) {
    const result = await db.prepare(`
      INSERT OR IGNORE INTO alert_milestones (milestone, sent_at)
      VALUES (?, ?)
    `).bind(milestone, getUnixTime()).run();

    if (result.meta?.changes) {
      crossed.push(milestone);
    }
  }

  return crossed;
}

function buildMicrosoftPayload(env, payload) {
  const profileName = getMicrosoftProfile(env);
  const tenantDomain = getMicrosoftTenant(env);

  return {
    profile: {
      name: profileName,
      source: 'cloudflare-worker',
      site: 'marchforjesus.ie',
      microsoftTenant: tenantDomain
    },
    ...payload
  };
}

function amountMinorToMajor(amount) {
  const value = Number(amount || 0);
  return Number.isFinite(value) ? value / 100 : 0;
}

function unixSecondsToIso(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) {
    return new Date(0).toISOString();
  }
  return new Date(timestamp * 1000).toISOString();
}

function buildSharePointOrderFields(payload, line) {
  const order = payload.order;

  return {
    Title: line.product_name,
    OrderID: order.id,
    StripeCheckoutSessionID: order.stripe_checkout_session_id,
    StripePaymentIntentID: order.stripe_payment_intent_id || '',
    CustomerName: order.customer_name || '',
    CustomerEmail: order.customer_email || '',
    Colour: line.colour,
    Size: line.size,
    Quantity: Number(line.quantity),
    UnitPrice: amountMinorToMajor(line.unit_amount),
    TotalPaid: amountMinorToMajor(line.total_amount),
    Currency: String(order.currency || payload.totals?.currency || '').toUpperCase(),
    PaymentStatus: order.payment_status || 'paid',
    CollectionStatus: order.collection_status || 'not_collected',
    CreatedTimestamp: unixSecondsToIso(order.created_at),
    MilestoneAlert: (payload.milestonesCrossed || []).join(', '),
    RawOrderJSON: JSON.stringify(payload)
  };
}

async function getMicrosoftGraphAccessToken(config) {
  const body = new URLSearchParams();
  body.set('client_id', config.clientId);
  body.set('client_secret', config.clientSecret);
  body.set('scope', 'https://graph.microsoft.com/.default');
  body.set('grant_type', 'client_credentials');

  const response = await fetch(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Microsoft Graph token request failed.');
  }

  if (!data.access_token) {
    throw new Error('Microsoft Graph token response did not include an access token.');
  }

  return data.access_token;
}

async function deleteSharePointItem(endpoint, accessToken, itemId) {
  const response = await fetch(`${endpoint}/${encodeURIComponent(itemId)}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`delete ${itemId}: ${await response.text()}`);
  }
}

async function findSharePointItemsByOrderId(endpoint, accessToken, orderId) {
  if (!orderId) {
    throw new Error('Order ID required for SharePoint rollback sweep.');
  }

  const escapedOrderId = String(orderId).replace(/'/g, "''");
  const url = new URL(endpoint);
  url.searchParams.set('$expand', 'fields($select=OrderID)');
  url.searchParams.set('$filter', `fields/OrderID eq '${escapedOrderId}'`);

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Prefer': 'HonorNonIndexedQueriesWarningMayFailRandomly'
    }
  });

  if (!response.ok) {
    throw new Error(`find rollback rows: ${await response.text()}`);
  }

  const data = await response.json();
  return data.value || [];
}

async function rollbackSharePointOrderLines(endpoint, accessToken, orderId, createdItemIds) {
  if (!orderId) {
    throw new Error('Order ID required for SharePoint rollback sweep.');
  }

  const idsToDelete = new Set(createdItemIds);
  const rollbackErrors = [];

  try {
    const matchingItems = await findSharePointItemsByOrderId(endpoint, accessToken, orderId);
    for (const item of matchingItems) {
      if (item.id) {
        idsToDelete.add(item.id);
      }
    }
  } catch (error) {
    rollbackErrors.push(error.message);
  }

  for (const itemId of idsToDelete) {
    try {
      await deleteSharePointItem(endpoint, accessToken, itemId);
    } catch (error) {
      rollbackErrors.push(error.message);
    }
  }

  if (rollbackErrors.length > 0) {
    throw new Error(rollbackErrors.join(' | ').slice(0, 500));
  }
}

async function writeSharePointOrderLines(env, payload) {
  const config = getMicrosoftGraphSharePointConfig(env);
  if (!config) {
    return false;
  }

  const endpoint = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(config.siteId)}/lists/${encodeURIComponent(config.listId)}/items`;
  const createdItemIds = [];
  let accessToken;

  try {
    accessToken = await getMicrosoftGraphAccessToken(config);

    for (const line of payload.lines || []) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: buildSharePointOrderFields(payload, line)
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText.slice(0, 500));
      }

      const item = await response.json();
      if (!item || !item.id) {
        throw new Error('SharePoint item creation response did not include an item ID.');
      }

      createdItemIds.push(item.id);
    }
  } catch (error) {
    if (!accessToken) {
      throw error;
    }

    try {
      await rollbackSharePointOrderLines(endpoint, accessToken, payload.order.id, createdItemIds);
    } catch (rollbackError) {
      throw new Error(`${error.message} | SharePoint rollback failed: ${rollbackError.message}`.slice(0, 500));
    }

    throw error;
  }

  return true;
}

async function postPowerAutomateWebhook(env, payload) {
  const webhookUrl = env.POWER_AUTOMATE_WEBHOOK_URL;
  if (!webhookUrl) {
    return false;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-MFJ-Profile': payload.profile.name
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText.slice(0, 500));
  }

  return true;
}

async function sendMicrosoftHandoff(db, env, orderId, payload) {
  const configuredTargets = [];
  const errors = [];
  let synced = false;
  let fullPayload;

  try {
    fullPayload = buildMicrosoftPayload(env, payload);
  } catch (error) {
    await db.prepare(`
      UPDATE orders
      SET microsoft_sync_status = 'failed',
          microsoft_sync_error = ?
      WHERE id = ?
    `).bind(error.message.slice(0, 500), orderId).run();
    return;
  }

  try {
    if (isMicrosoftGraphSharePointConfigured(env)) {
      configuredTargets.push('sharepoint_graph');
      await writeSharePointOrderLines(env, fullPayload);
      synced = true;
    }
  } catch (error) {
    errors.push(`SharePoint Graph: ${error.message}`);
  }

  try {
    if (env.POWER_AUTOMATE_WEBHOOK_URL) {
      configuredTargets.push('power_automate');
      await postPowerAutomateWebhook(env, fullPayload);
      synced = true;
    }
  } catch (error) {
    errors.push(`Power Automate: ${error.message}`);
  }

  if (configuredTargets.length === 0) {
    await db.prepare(`
      UPDATE orders
      SET microsoft_sync_status = 'not_configured',
          microsoft_sync_error = 'MICROSOFT_GRAPH_* SharePoint config or POWER_AUTOMATE_WEBHOOK_URL is not configured'
      WHERE id = ?
    `).bind(orderId).run();
    return;
  }

  if (!synced) {
    await db.prepare(`
      UPDATE orders
      SET microsoft_sync_status = 'failed',
          microsoft_sync_error = ?
      WHERE id = ?
    `).bind(errors.join(' | ').slice(0, 500), orderId).run();
    return;
  }

  await db.prepare(`
    UPDATE orders
    SET microsoft_sync_status = ?,
        microsoft_sync_error = ?,
        microsoft_synced_at = ?
    WHERE id = ?
  `).bind(
    errors.length > 0 ? 'partial_sync' : 'synced',
    errors.length > 0 ? errors.join(' | ').slice(0, 500) : null,
    getUnixTime(),
    orderId
  ).run();
}

async function handleStripeWebhook(request, env, origin) {
  const db = requireBinding(env, 'MERCH_DB');
  const rawBody = await request.text();
  await verifyStripeSignature(request, env, rawBody);

  const event = JSON.parse(rawBody);
  const existing = await db.prepare(`
    SELECT id
    FROM webhook_events
    WHERE id = ?
  `).bind(event.id).first();

  if (existing) {
    return jsonResponse({ received: true, duplicate: true }, 200, origin);
  }

  if (event.type === 'checkout.session.completed') {
    await markOrderPaid(db, env, event.data.object);
  } else if (event.type === 'checkout.session.expired') {
    const reservationId = event.data.object.metadata?.reservation_id;
    if (reservationId) {
      await releaseReservation(db, reservationId, 'expired');
    }
  }

  // Record the event only after required side effects complete, so Stripe retries email failures.
  await db.prepare(`
    INSERT INTO webhook_events (id, type, processed_at)
    VALUES (?, ?, ?)
  `).bind(event.id, event.type, getUnixTime()).run();

  return jsonResponse({ received: true }, 200, origin);
}

async function handleStockSummary(env, origin) {
  const db = requireBinding(env, 'MERCH_DB');
  const catalog = await getCatalogWithAvailability(db);
  const variants = catalog.flatMap((product) => product.sizes.map((size) => ({
    product: product.name,
    colour: product.colour,
    size: size.label,
    initialStock: size.initialStock,
    sold: size.sold,
    reserved: size.reserved,
    available: size.available
  })));

  return jsonResponse({ variants }, 200, origin);
}

async function handleOrderLookup(request, env, origin) {
  const db = requireBinding(env, 'MERCH_DB');
  const url = new URL(request.url);
  const sessionId = (url.searchParams.get('session_id') || '').trim();

  if (!sessionId || !/^cs_(test|live)_[A-Za-z0-9]{20,}$/.test(sessionId)) {
    throw new ResponseError('Invalid session_id.', 400);
  }

  const row = await db.prepare(`
    SELECT
      id,
      customer_email,
      amount_total,
      currency,
      payment_status,
      confirmation_email_status
    FROM orders
    WHERE stripe_checkout_session_id = ?
    LIMIT 1
  `).bind(sessionId).first();

  if (!row) {
    return jsonResponse({ status: 'pending' }, 200, origin);
  }

  return jsonResponse({
    status: 'ready',
    orderRef: String(row.id).slice(0, 8).toUpperCase(),
    customerEmail: row.customer_email,
    amountTotal: row.amount_total,
    currency: row.currency,
    paymentStatus: row.payment_status,
    confirmationEmailStatus: row.confirmation_email_status
  }, 200, origin);
}

async function handleOrdersExport(request, env, origin) {
  requireAdmin(request, env);
  const db = requireBinding(env, 'MERCH_DB');
  const rows = await db.prepare(`
    SELECT
      orders.id AS order_id,
      orders.stripe_checkout_session_id,
      orders.stripe_payment_intent_id,
      orders.customer_name,
      orders.customer_email,
      orders.amount_total,
      orders.currency,
      orders.payment_status,
      orders.collection_status,
      orders.confirmation_email_status,
      orders.confirmation_email_error,
      orders.confirmation_email_sent_at,
      orders.created_at,
      order_lines.variant_id,
      order_lines.product_name,
      order_lines.colour,
      order_lines.size,
      order_lines.quantity,
      order_lines.unit_amount,
      order_lines.total_amount
    FROM orders
    JOIN order_lines ON order_lines.order_id = orders.id
    ORDER BY orders.created_at DESC, orders.id, order_lines.product_name
  `).all();

  const headers = [
    'order_id',
    'stripe_checkout_session_id',
    'stripe_payment_intent_id',
    'customer_name',
    'customer_email',
    'amount_total',
    'currency',
    'payment_status',
    'collection_status',
    'confirmation_email_status',
    'confirmation_email_error',
    'confirmation_email_sent_at',
    'created_at',
    'variant_id',
    'product_name',
    'colour',
    'size',
    'quantity',
    'unit_amount',
    'total_amount'
  ];

  const csv = [
    headers.join(','),
    ...(rows.results || []).map((row) => headers.map((header) => csvEscape(row[header])).join(','))
  ].join('\n');

  return new Response(csv, {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="mfj-merch-orders.csv"'
    }
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    try {
      assertRuntimeProfile(env);

      if (request.method === 'GET' && url.pathname === '/api/catalog') {
        return await handleCatalog(request, env, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/stock') {
        return await handleStockSummary(env, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/orders/export.csv') {
        return await handleOrdersExport(request, env, origin);
      }

      if (request.method === 'GET' && url.pathname === '/api/orders/lookup') {
        return await handleOrderLookup(request, env, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/checkout') {
        return await handleCheckout(request, env, origin);
      }

      if (request.method === 'POST' && url.pathname === '/api/stripe/webhook') {
        return await handleStripeWebhook(request, env, origin);
      }

      return jsonResponse({ error: 'Not found' }, 404, origin);
    } catch (error) {
      if (error instanceof ResponseError) {
        return jsonResponse({ error: error.message }, error.status, origin);
      }

      console.error('Merch worker error:', error);
      return jsonResponse({ error: 'Internal server error' }, 500, origin);
    }
  },

  async scheduled(_event, env) {
    assertRuntimeProfile(env);
    const db = requireBinding(env, 'MERCH_DB');
    await cleanupExpiredReservations(db);
  }
};

export {
  ResponseError,
  buildOrderConfirmationEmail,
  buildSharePointOrderFields,
  csvEscape,
  createStripeCheckoutSession,
  getMicrosoftGraphMailConfig,
  getStripeSecretKey,
  getMicrosoftGraphAccessToken,
  isMicrosoftGraphSharePointConfigured,
  isValidEmail,
  normaliseLineItems,
  rollbackSharePointOrderLines,
  writeSharePointOrderLines,
  verifyStripeTimestamp
};
