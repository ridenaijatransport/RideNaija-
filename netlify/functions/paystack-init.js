// Starts a Paystack payment for the native app and returns the hosted-checkout link.
// Needs the Netlify variable PAYSTACK_SECRET_KEY. The secret key never leaves the server.
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (code, obj) => ({ statusCode: code, headers: JSON_HEADERS, body: JSON.stringify(obj) });

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return reply(500, { error: 'PAYSTACK_SECRET_KEY is not set on Netlify' });

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch (e) { return reply(400, { error: 'Bad JSON' }); }
  const email = String(p.email || '').trim();
  const amount = Math.round(Number(p.amount)); // kobo
  const reference = String(p.reference || '').trim();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return reply(400, { error: 'Valid email required' });
  if (!(amount >= 10000)) return reply(400, { error: 'Minimum payment is N100' });
  if (!/^[A-Za-z0-9_.=-]{6,100}$/.test(reference)) return reply(400, { error: 'Bad reference' });

  try {
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        amount,
        reference,
        currency: 'NGN',
        callback_url: (p.callback_url && String(p.callback_url).startsWith('https://')) ? p.callback_url : undefined,
        metadata: { source: 'ridenaija-native', phone: p.phone || '', purpose: p.purpose || '' },
      }),
    });
    const json = await res.json();
    if (!json.status) return reply(502, { error: json.message || 'Paystack refused the request' });
    return reply(200, { authorization_url: json.data.authorization_url, access_code: json.data.access_code, reference: json.data.reference });
  } catch (e) {
    return reply(502, { error: 'Could not reach Paystack' });
  }
};
