// ═══════════════════════════════════════════════════════════
// RideNaija — FCM Push Notification Sender (Netlify Serverless Function)
// File location: netlify/functions/send-notification.js
//
// This runs on Netlify's server — customers and riders never see this code.
// It sends real push notifications using Firebase Admin SDK + a service account.
//
// HOW TO SET UP:
// 1. Go to console.firebase.google.com → your RideNaija project
// 2. Click the gear icon → Project Settings → Service Accounts tab
// 3. Click "Generate new private key" — this downloads a JSON file
// 4. Open that JSON file, copy its ENTIRE contents
// 5. Go to Netlify dashboard → Site settings → Environment Variables
// 6. Add a new variable: FIREBASE_SERVICE_ACCOUNT
//    Value = paste the entire JSON file contents (as one line is fine)
// 7. Re-deploy your site — the function is now live at /api/send-notification
// ═══════════════════════════════════════════════════════════

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK once (Netlify reuses warm function instances)
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
    const { token, title, body, data, topic } = JSON.parse(event.body || '{}');

    if (!token && !topic) {
      return { statusCode: 400, body: JSON.stringify({ error: 'token or topic is required' }) };
    }
    if (!title || !body) {
      return { statusCode: 400, body: JSON.stringify({ error: 'title and body are required' }) };
    }

    const message = {
      notification: { title, body },
      data: data || {},
      ...(token ? { token } : { topic }),
      webpush: {
        notification: {
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png'
        },
        fcmOptions: {
          link: (data && data.link) || '/index.html'
        }
      }
    };

    const response = await admin.messaging().send(message);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, messageId: response })
    };

  } catch (error) {
    // Common case: token is stale/invalid (user uninstalled, cleared data, etc.)
    // Don't treat this as a hard failure — just report it so the caller can clean up.
    const isInvalidToken = error.code === 'messaging/registration-token-not-registered' ||
                            error.code === 'messaging/invalid-registration-token';
    return {
      statusCode: isInvalidToken ? 200 : 500,
      body: JSON.stringify({
        success: false,
        invalidToken: isInvalidToken,
        error: error.message
      })
    };
  }
};
