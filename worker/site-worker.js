// Cloudflare Worker — marchforjesus.ie site + form backend.
//
// This single Dublin-owned Worker does two jobs:
//   1. Serves the static site from the [assets] binding (env.ASSETS).
//   2. Handles the signup / contact form POST at /api/subscribe:
//        - forwards the subscriber to MailerLite, and
//        - fires a consent-gated, server-side TikTok "SubmitForm" event
//          (Events API) that mirrors the browser Pixel event.
//
// Because the form now posts SAME-ORIGIN (marchforjesus.ie/api/subscribe),
// there is no cross-origin dependency on the shared Belfast Worker, and the
// TikTok pixel/token used here are Dublin's alone — Belfast is untouched.
//
// Server-side secrets (never in the repo or browser), set on the Worker:
//   MAILERLITE_API_KEY               — MailerLite account API key
//   TIKTOK_EVENTS_API_ACCESS_TOKEN   — TikTok Events API access token
// Public var (safe in config):
//   TIKTOK_PIXEL_ID                  — TikTok pixel id (also in browser code)

const ALLOWED_ORIGINS = [
  'https://marchforjesus.ie',
  'https://www.marchforjesus.ie',
  'https://gvalero.github.io',
  'http://localhost:8080'
];

const MAILERLITE_GROUP_ID = '181638643685786861';

const TIKTOK_EVENTS_API_ENDPOINT = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

const CHURCH_REGISTRATION_URL =
  'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=f6y-zCtfL06W-3G7pTXM82CVYKlavfFOlvnuDnu6lV1UMjlCWkJIRkdJUTM5MExVVDI5RldZQ0w2Vi4u';

// Send a server-side TikTok "SubmitForm" event that mirrors the browser Pixel
// event. The shared event_id lets TikTok deduplicate the two copies. This is
// best-effort: any failure here must never affect the signup response.
async function sendTikTokSubmitForm(env, request, data) {
  const token = env.TIKTOK_EVENTS_API_ACCESS_TOKEN;
  const pixelId = env.TIKTOK_PIXEL_ID;
  if (!token || !pixelId || !data.eventId) return;

  const payload = {
    event_source: 'web',
    event_source_id: pixelId,
    data: [{
      event: 'SubmitForm',
      event_time: Math.floor(Date.now() / 1000),
      event_id: data.eventId,
      user: {
        ttclid: data.ttclid || undefined,
        ttp: data.ttp || undefined,
        ip: request.headers.get('CF-Connecting-IP') || undefined,
        user_agent: request.headers.get('User-Agent') || undefined
      },
      page: { url: data.pageUrl || 'https://marchforjesus.ie/' }
    }]
  };

  try {
    const res = await fetch(TIKTOK_EVENTS_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    // Log status only — never log raw form fields or the access token.
    console.log('TikTok Events API status:', res.status);
  } catch (e) {
    console.error('TikTok Events API request failed:', e && e.message);
  }
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

async function handleSubscribe(request, env, ctx) {
  const origin = request.headers.get('Origin') || '';

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });
  }

  try {
    const data = await request.json();
    const { email, name, last_name, phone, county, church, attended_before, marketing_consent, form_type } = data;

    if (!email) {
      return new Response(JSON.stringify({ error: 'Email is required' }), {
        status: 400,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
      });
    }

    // Build subscriber payload
    const subscriberPayload = {
      email,
      fields: {},
      groups: [MAILERLITE_GROUP_ID],
      status: 'active'
    };

    if (name) subscriberPayload.fields.name = name;
    if (last_name) subscriberPayload.fields.last_name = last_name;
    if (phone) subscriberPayload.fields.phone = phone;
    if (county) subscriberPayload.fields.county = county;
    if (church) subscriberPayload.fields.church = church;
    if (attended_before) subscriberPayload.fields.have_you_attended_mfj_dublin_or_belfast_before = attended_before;
    if (marketing_consent) subscriberPayload.fields.marketing_consent = marketing_consent;
    if (form_type) subscriberPayload.fields.lead_source = form_type;

    // Call MailerLite API
    const mlResponse = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.MAILERLITE_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(subscriberPayload)
    });

    const mlData = await mlResponse.json();

    if (!mlResponse.ok) {
      console.error('MailerLite error:', JSON.stringify(mlData));
      return new Response(JSON.stringify({ error: 'Failed to subscribe. Please try again.' }), {
        status: 500,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
      });
    }

    // Server-side TikTok SubmitForm — sign-up form only, with marketing
    // tracking consent. Runs after the response via waitUntil so a slow or
    // failing TikTok call never delays or breaks the signup.
    if (form_type === 'website_signup' && data.marketing_tracking_consent === true) {
      if (ctx && typeof ctx.waitUntil === 'function') {
        ctx.waitUntil(sendTikTokSubmitForm(env, request, data));
      } else {
        sendTikTokSubmitForm(env, request, data);
      }
    }

    return new Response(JSON.stringify({ success: true, message: 'Successfully subscribed!' }), {
      status: 200,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Worker error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' }
    });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Form backend — everything else falls through to the static site assets.
    if (url.pathname === '/api/subscribe') {
      return handleSubscribe(request, env, ctx);
    }

    if (url.pathname === '/churchregistration') {
      return Response.redirect(CHURCH_REGISTRATION_URL, 302);
    }

    return env.ASSETS.fetch(request);
  }
};
