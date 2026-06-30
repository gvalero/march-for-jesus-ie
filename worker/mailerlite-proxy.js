// Cloudflare Worker — MailerLite API Proxy for marchforjesus.ie
// Deploy to Cloudflare Workers. Set MAILERLITE_API_KEY as a secret.

const ALLOWED_ORIGINS = [
  'https://marchforjesus.ie',
  'https://www.marchforjesus.ie',
  'https://gvalero.github.io',
  'http://localhost:8080'
];

const MAILERLITE_GROUP_ID = '181638643685786861';

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Handle CORS preflight
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
};
