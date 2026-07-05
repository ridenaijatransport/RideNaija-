// ═══════════════════════════════════════════════════════════
// RideNaija — FCM Topic Subscription (Netlify Serverless Function)
// File location: netlify/functions/subscribe-topic.js
// ═══════════════════════════════════════════════════════════

const admin = require('firebase-admin');

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.error('[RideNaija] FIREBASE_SERVICE_ACCOUNT env var is NOT SET.');
  } else {
    try {
      const serviceAccount = JSON.parse(raw);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: 'https://ridenaija-14d88-default-rtdb.firebaseio.com'
      });
      console.log('[RideNaija] Firebase Admin SDK initialized OK. Project:', serviceAccount.project_id);
    } catch (e) {
      console.error('[RideNaija] Firebase Admin init failed:', e.message);
    }
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  if (!admin.apps.length) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Notification service not configured. Set FIREBASE_SERVICE_ACCOUNT in Netlify environment variables.' }) };
  }

  try {
    const { token, topic, action } = JSON.parse(event.body || '{}');
    console.log('[RideNaija] subscribe-topic called. topic:', topic, 'action:', action || 'subscribe', 'token?', !!token);

    if (!token || !topic) {
      return { statusCode: 400, body: JSON.stringify({ error: 'token and topic are required' }) };
    }

    const result = action === 'unsubscribe'
      ? await admin.messaging().unsubscribeFromTopic([token], topic)
      : await admin.messaging().subscribeToTopic([token], topic);

    console.log('[RideNaija] topic subscription result:', JSON.stringify(result));

    // CRITICAL: admin.messaging().subscribeToTopic() can return HTTP 200 with
    // successCount:0/failureCount:1 when the token itself was rejected (bad
    // format, expired, wrong project). That is a REAL failure even though
    // nothing threw — if we don't check it here, the client shows "✅ Enabled"
    // for a device that was never actually subscribed to the topic.
    if (result.failureCount > 0) {
      const errDetail = (result.errors && result.errors[0] && result.errors[0].error && result.errors[0].error.message) || 'Token rejected by FCM';
      console.error('[RideNaija] subscribe-topic PER-TOKEN FAILURE:', errDetail);
      return {
        statusCode: 200,
        body: JSON.stringify({ success: false, error: errDetail, successCount: result.successCount, failureCount: result.failureCount })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, successCount: result.successCount, failureCount: result.failureCount })
    };

  } catch (error) {
    console.error('[RideNaija] subscribe-topic error:', error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
