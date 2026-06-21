// ═══════════════════════════════════════════════════════════
// RideNaija — Paystack Transfer API (Netlify Serverless Function)
// File location: netlify/functions/pay-rider.js
//
// This runs on Netlify's server — customers never see this code
// It automatically sends money to riders after a confirmed ride
//
// HOW TO DEPLOY:
// 1. Create a folder called "netlify" in your ridenaija folder
// 2. Inside it create another folder called "functions"
// 3. Put this file inside: netlify/functions/pay-rider.js
// 4. Go to Netlify dashboard → Environment Variables
// 5. Add: PAYSTACK_SECRET_KEY = sk_live_your_secret_key_here
// 6. Re-deploy your site — the function is now live
// ═══════════════════════════════════════════════════════════

exports.handler = async function(event, context) {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { riderName, riderBank, riderAccount, amount, bookingId, riderPhone } = JSON.parse(event.body);

    // Step 1: Create a transfer recipient on Paystack
    const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'nuban',
        name: riderName,
        account_number: riderAccount,
        bank_code: riderBank, // Paystack bank code e.g. "058" for GTBank
        currency: 'NGN'
      })
    });

    const recipient = await recipientRes.json();

    if (!recipient.status) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Could not create recipient: ' + recipient.message })
      };
    }

    const recipientCode = recipient.data.recipient_code;

    // Step 2: Initiate the transfer
    const transferRes = await fetch('https://api.paystack.co/transfer', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.PAYSTACK_SECRET_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        source: 'balance',
        amount: amount * 100, // Paystack uses kobo
        recipient: recipientCode,
        reason: 'RideNaija ride payment — Booking ' + bookingId
      })
    });

    const transfer = await transferRes.json();

    if (!transfer.status) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Transfer failed: ' + transfer.message })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        transferCode: transfer.data.transfer_code,
        message: 'Payment of ₦' + amount.toLocaleString() + ' sent to ' + riderName
      })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};
