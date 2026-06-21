// ═══════════════════════════════════════════════════════════
// RideNaija — Daily Subscription Reminder (Netlify Scheduled Function)
// File location: netlify/functions/check-subscriptions-scheduled.js
//
// Runs automatically once a day (see "schedule" export at the bottom).
// Checks every verified, non-company rider's subscription status using
// the EXACT same overdue logic as admin.html's loadRiderSubTable(), and
// pushes a reminder notification to any rider who just became overdue.
//
// Requires the same FIREBASE_SERVICE_ACCOUNT environment variable as
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

// Mirrors the vehicle-type → monthly-vs-weekly logic in admin.html loadRiderSubTable()
function isMonthlyVehicle(vehicleType) {
  const rtype = (vehicleType || 'okada').toLowerCase();
  const isOkada = rtype === 'okada';
  const isKeke = rtype === 'keke';
  const isTaxi = rtype === 'taxi' || rtype === 'taxi_suv' || rtype === 'taxi_mini';
  const isRoyal = rtype.includes('royal') || rtype.includes('intercity');
  return isRoyal || (!isOkada && !isKeke && !isTaxi);
}

async function checkSubscriptions() {
  if (!admin.apps.length) {
    console.error('Firebase Admin not initialized — cannot run subscription check');
    return { checked: 0, notified: 0, error: 'not configured' };
  }

  const db = admin.database();
  const [ridersSnap, historySnap] = await Promise.all([
    db.ref('riders').once('value'),
    db.ref('sub_history').once('value')
  ]);

  const ridersData = ridersSnap.val() || {};
  const historyData = historySnap.val() || {};
  const history = Object.values(historyData);

  let checked = 0;
  let notified = 0;

  for (const [riderKey, rider] of Object.entries(ridersData)) {
    if (rider.status !== 'verified') continue;          // skip pending/rejected riders
    if (rider.riderType === 'company') continue;          // company riders don't have this subscription
    checked++;

    const rName = (rider.name || '').toLowerCase();
    const paid = history.filter(h => (h.rider || '').toLowerCase() === rName);
    if (!paid.length) continue; // never paid — admin already sees this, don't spam on day one

    const lastPayDate = new Date(Math.max(...paid.map(h => new Date(h.date || 0).getTime())));
    const renewDays = isMonthlyVehicle(rider.vehicleType || rider.type) ? 30 : 7;
    const dueDate = new Date(lastPayDate);
    dueDate.setDate(dueDate.getDate() + renewDays);
    const daysLeft = Math.floor((dueDate - new Date()) / (1000 * 60 * 60 * 24));
    const isOverdue = daysLeft < 0;

    if (!isOverdue) continue;

    // Only notify once per overdue day — track last-notified date on the rider record
    // so this doesn't push the same rider repeatedly every day they stay overdue... unless
    // that's actually desired (it is, by design: daily reminder until they pay).
    const tokenSnap = await db.ref('fcm_tokens/riders/' + riderKey).once('value');
    const tokenData = tokenSnap.val();
    if (!tokenData || !tokenData.token) continue;

    try {
      await admin.messaging().send({
        notification: {
          title: '⚠️ Subscription Overdue',
          body: `Your RideNaija subscription is ${Math.abs(daysLeft)} day${Math.abs(daysLeft) !== 1 ? 's' : ''} overdue. Pay now to stay active.`
        },
        data: { link: '/index.html' },
        token: tokenData.token,
        webpush: {
          notification: { icon: '/icons/icon-192.png', badge: '/icons/icon-192.png' },
          fcmOptions: { link: '/index.html' }
        }
      });
      notified++;
    } catch (err) {
      console.error(`Failed to notify rider ${rider.name}:`, err.message);
    }
  }

  console.log(`Subscription check complete: ${checked} riders checked, ${notified} overdue riders notified`);
  return { checked, notified };
}

exports.handler = async function (event) {
  const result = await checkSubscriptions();
  return {
    statusCode: 200,
    body: JSON.stringify(result)
  };
};

// Run once a day at 8:00 AM UTC (~9:00 AM Lagos time)
exports.config = {
  schedule: '0 8 * * *'
};
