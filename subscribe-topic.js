// ═══════════════════════════════════════════════════════════
// RideNaija — FCM Topic Subscription (Netlify Serverless Function)
// File location: netlify/functions/subscribe-topic.js
//
// Web push clients CANNOT subscribe themselves to a topic directly —
// only the Admin SDK can do this. This function lets the client ask
// the server to subscribe (or unsubscribe) its own token to a topic,
// e.g. admin devices subscribing to "admin_alerts".
//
// Uses the same FIREBASE_SERVICE_ACCOUNT environment variable as
// send-notification.js — no additional setup needed if that's done.
// ═══════════════════════════════════════════════════════════

const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: 'https://ridenaija-14d88-default-rtdb.firebaseio.com'
    });
  } catch (e) {
    console.error('Firebase Admin init failed:', e.message);
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

    if (!token || !topic) {
      return { statusCode: 400, body: JSON.stringify({ error: 'token and topic are required' }) };
    }

    const result = action === 'unsubscribe'
      ? await admin.messaging().unsubscribeFromTopic([token], topic)
      : await admin.messaging().subscribeToTopic([token], topic);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, successCount: result.successCount, failureCount: result.failureCount })
    };

  } catch (error) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
