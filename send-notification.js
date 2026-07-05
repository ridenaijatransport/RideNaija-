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

function buildMessage(title, body, data) {
  return {
    data: {
      title: title,
      body: body,
      link: (data && data.link) || '/index.html',
      bookingId: (data && data.bookingId) || '',
      ...(data || {})
    },
    webpush: {
      headers: { Urgency: 'high' },
      fcmOptions: { link: (data && data.link) || '/index.html' }
    }
  };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!admin.apps.length) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Notification service not configured.' }) };
  }

  try {
    const { token, title, body, data, adminBroadcast } = JSON.parse(event.body || '{}');
    console.log('[RideNaija] send-notification called. adminBroadcast:', !!adminBroadcast, 'token?', !!token, 'title:', title);

    if (!token && !adminBroadcast) return { statusCode: 400, body: JSON.stringify({ error: 'token or adminBroadcast required' }) };
    if (!title || !body) return { statusCode: 400, body: JSON.stringify({ error: 'title and body required' }) };

    // ═══════════════════════════════════════════════════════════
    // ADMIN BROADCAST — every admin device saved its own token directly
    // under fcm_tokens/admins/{token} (same pattern as riders/partners).
    // We read every one of them and send individually via sendEachForMulticast,
    // which gives a REAL per-token success/failure result — unlike topic
    // messaging, which always reports "success" even if zero devices are
    // actually subscribed. Any token that FCM reports as dead gets pruned
    // from the database right here, so stale devices self-heal over time
    // instead of accumulating forever.
    // ═══════════════════════════════════════════════════════════
    if (adminBroadcast) {
      const snap = await admin.database().ref('fcm_tokens/admins').once('value');
      const val = snap.val() || {};
      const entries = Object.entries(val); // [ [dbKey, {token, updatedAt}], ... ]
      const tokens = entries.map(function(e){ return e[1] && e[1].token; }).filter(Boolean);

      if (tokens.length === 0) {
        console.warn('[RideNaija] adminBroadcast: no admin tokens on file.');
        return { statusCode: 200, body: JSON.stringify({ success: true, sent: 0, note: 'No admin devices registered yet.' }) };
      }

      const message = buildMessage(title, body, data);
      const response = await admin.messaging().sendEachForMulticast({ tokens: tokens, ...message });

      // Prune dead tokens
      const pruneOps = [];
      response.responses.forEach(function(r, i) {
        if (!r.success) {
          const code = r.error && r.error.code;
          if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            pruneOps.push(admin.database().ref('fcm_tokens/admins/' + entries[i][0]).remove().catch(function(){}));
          }
        }
      });
      await Promise.all(pruneOps);

      console.log('[RideNaija] adminBroadcast sent. success:', response.successCount, 'failure:', response.failureCount);
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, sent: response.successCount, failed: response.failureCount, totalDevices: tokens.length })
      };
    }

    // ═══════════════════════════════════════════════════════════
    // Single-device send — riders, partners, customers, all by exact token.
    // ═══════════════════════════════════════════════════════════
    const message = { ...buildMessage(title, body, data), token };
    const response = await admin.messaging().send(message);
    console.log('[RideNaija] Notification sent OK. messageId:', response);
    return { statusCode: 200, body: JSON.stringify({ success: true, messageId: response }) };

  } catch (error) {
    console.error('[RideNaija] send error:', error.code, error.message);
    const isInvalidToken = error.code === 'messaging/registration-token-not-registered' ||
                           error.code === 'messaging/invalid-registration-token';
    return {
      statusCode: isInvalidToken ? 200 : 500,
      body: JSON.stringify({ success: false, invalidToken: isInvalidToken, error: error.message })
    };
  }
};
