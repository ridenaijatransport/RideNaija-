// Asks Paystack whether a payment reference was really paid.
// GET /api/paystack-verify?reference=XXX&amount=<kobo, optional sanity check>
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (code, obj) => ({ statusCode: code, headers: JSON_HEADERS, body: JSON.stringify(obj) });

exports.handler = async function (event) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return reply(500, { error: 'PAYSTACK_SECRET_KEY is not set on Netlify' });
  const q = event.queryStringParameters || {};
  const reference = String(q.reference || '').trim();
  if (!/^[A-Za-z0-9_.=-]{6,100}$/.test(reference)) return reply(400, { error: 'Bad reference' });
  const expected = Math.round(Number(q.amount)) || 0;

  try {
    const res = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
      headers: { Authorization: 'Bearer ' + secret },
    });
    const json = await res.json();
    if (!json.status) {
      return reply(200, { status: 'pending', paid: false, message: json.message || '' });
    }
    const d = json.data || {};
    const paid = d.status === 'success' && (!expected || Number(d.amount) >= expected);
    return reply(200, {
      status: d.status === 'success' && !paid ? 'amount_mismatch' : d.status,
      paid,
      amount: d.amount,
      reference: d.reference,
      channel: d.channel,
    });
  } catch (e) {
    return reply(502, { error: 'Could not reach Paystack' });
  }
};
