// RideNaija — fleet rider wallet (server side).
//
// Why a server function: it keeps the money rules in ONE trusted place and is the only
// thing allowed to write the `ledger` (Firebase rules make it read-only for apps).
//
// POST /api/rider-money   { action: 'status' | 'withdraw', riderKey, phone, amount? }
//
// Wallet = every job since the rider's ledger start date:
//   card / wallet job   +  rider's share
//   cash job            −  company's share (rider collected the whole fare)
//   cash handed in      +  company_cash_remittances recorded by admin
//   paid out            −  withdrawals (pending + paid) and legacy company_card_payments
// Positive balance = RideNaija owes the rider (withdrawable).  Negative = rider owes cash.
// Job entries are written once (cut snapshot) and never change afterwards.
// Phase 1: company (fleet) riders only; others get { enabled:false }.
const admin = require('firebase-admin');

if (!admin.apps.length) {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    try {
      admin.initializeApp({
        credential: admin.credential.cert(JSON.parse(raw)),
        databaseURL: 'https://ridenaija-14d88-default-rtdb.firebaseio.com',
      });
    } catch (e) {
      console.error('[rider-money] Firebase Admin init failed:', e.message);
    }
  }
}

const MIN_WITHDRAW = 1000;
const HEADERS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };

// ── job rules (mirror of the app's riderMoney.js / orders.js) ───────────────
const digits = (p) => String(p || '').replace(/\D/g, '').replace(/^0/, '').replace(/^234/, '');
const lc = (x) => String(x || '').toLowerCase().trim();

function orderKind(b) {
  if (b.source === 'food_order') return b.vendorCategory === 'Marketplace' ? 'shop' : 'food';
  if (b.source === 'market_order' || b.type === 'market') return 'errand';
  return 'delivery';
}
function errandTotal(b) {
  if (orderKind(b) === 'errand' && Number(b.itemsActual) > 0 && lc(b.payMethod) === 'cash' && !b.feePending) {
    return Number(b.itemsActual) + (Number(b.shoppingFee) || 0) + (Number(b.deliveryFee) || 0);
  }
  return Number(b.fare) || 0;
}
function jobMoney(b, cuts) {
  const kind = orderKind(b);
  const cash = lc(b.payMethod) === 'cash';
  const pending = !!b.feePending;
  if (kind === 'delivery') {
    const fare = Number(b.fare) || 0;
    const earn = Math.floor((fare * cuts.company) / 100);
    return { kind, cash, earn: pending ? 0 : earn, owe: cash ? fare - earn : 0, pct: cuts.company };
  }
  const total = errandTotal(b);
  const df = Number(b.deliveryFee) || 0;
  const earn = pending ? 0 : Math.floor((df * cuts.food) / 100);
  return { kind, cash, earn, owe: cash ? Math.max(0, total - earn) : 0, pct: cuts.food };
}
function isCancelled(b) { const s = lc(b.status); return s === 'cancelled' || s === 'terminated'; }
function isDone(b) {
  return !isCancelled(b) && (b.rideStatus === 'completed' || b.rideStatus === 'delivered' || b.deliveryStage === 'delivered');
}
function isMine(b, rider) {
  const myPhone = digits(rider.phone);
  const myName = lc(rider.name);
  const key = rider.fbKey || '';
  const cKey = rider.companyRiderKey || key;
  if (myPhone && (digits(b.riderPhone) === myPhone || digits(b.assignedRiderPhone) === myPhone)) return true;
  if (myName.length > 2 && (lc(b.riderName) === myName || lc(b.assignedRider) === myName)) return true;
  if (key && (b.ridersNodeKey === key || b.companyRiderKey === key)) return true;
  if (cKey && b.companyRiderKey === cKey) return true;
  return false;
}
const isFleet = (r) => r && (r.riderType === 'company' || !!r.companyRiderKey);
const bankOf = (r) => ({
  bankName: r.bank || r.bankName || '',
  account: String(r.account || r.accountNumber || r.paymentNumber || ''),
  accountName: r.accountName || r.name || '',
});

// ── data helpers (db = firebase-admin database) ─────────────────────────────
const val = async (db, path) => (await db.ref(path).once('value')).val();

async function loadRider(db, body) {
  const key = String(body.riderKey || '');
  if (!key || /[.#$/\[\]]/.test(key)) return { error: 'bad_rider' };
  const r = await val(db, 'riders/' + key);
  if (!r) return { error: 'rider_not_found' };
  if (digits(r.phone) !== digits(body.phone) || digits(body.phone).length < 10) return { error: 'phone_mismatch' };
  return { rider: { ...r, fbKey: key } };
}

async function getCuts(db) {
  const [food, fleet] = await Promise.all([val(db, 'food_settings'), val(db, 'settings/fleet')]);
  return { food: Number(food && food.riderCut) || 90, company: Number(fleet && fleet.riderCut) || 70 };
}

// Post any finished jobs that are not in the ledger yet. Idempotent.
async function syncJobs(db, rider, now) {
  const key = rider.fbKey;
  let meta = await val(db, 'ledger_meta/' + key);
  if (!meta || !meta.startAt) {
    meta = { startAt: new Date(now).toISOString() };
    await db.ref('ledger_meta/' + key).set(meta);
  }
  const start = new Date(meta.startAt).getTime();
  const [bookings, existing, cuts] = await Promise.all([val(db, 'bookings'), val(db, 'ledger/' + key), getCuts(db)]);
  const have = existing || {};
  const adds = {};
  Object.entries(bookings || {}).forEach(([id, b]) => {
    if (!b || have[id] || !isDone(b) || !isMine(b, rider)) return;
    if (b.riderPaid || b.companyCardPaid || b.settled || b.manual) return; // already settled the old way
    if (new Date(b.time || 0).getTime() < start) return;
    const m = jobMoney(b, cuts);
    if (m.earn === 0 && m.owe === 0) return;
    adds[id] = { type: 'job', kind: m.kind, cash: m.cash, earn: m.earn, owe: m.owe, pct: m.pct, at: b.time || new Date(now).toISOString(), label: (b.pickup || '') + ' → ' + (b.destination || '') };
  });
  const ids = Object.keys(adds);
  if (ids.length) await db.ref('ledger/' + key).update(adds);
  return { start, ledger: Object.assign({}, have, adds) };
}

// Pure: builds the wallet from already-loaded data. (unit-tested)
function buildWallet({ start, ledger, remittances, cardPayments, withdrawals, rider, limit }) {
  const inRange = (d) => new Date(d || 0).getTime() >= start;
  const mineRem = (x) => (x.riderKey && x.riderKey === rider.fbKey) || (x.riderKey && x.riderKey === rider.companyRiderKey) || (!x.riderKey && lc(x.riderName) === lc(rider.name));
  const entries = [];
  Object.entries(ledger || {}).forEach(([id, e]) => {
    entries.push({ id, type: 'job', at: e.at, label: e.label, amount: e.cash ? -e.owe : e.earn, cash: !!e.cash, kind: e.kind });
  });
  Object.entries(remittances || {}).forEach(([id, x]) => {
    if (x && mineRem(x) && inRange(x.date)) entries.push({ id: 'rem-' + id, type: 'remittance', at: x.date, label: 'Cash handed in', amount: Number(x.amount) || 0 });
  });
  Object.entries(cardPayments || {}).forEach(([id, x]) => {
    if (x && mineRem(x) && inRange(x.date)) entries.push({ id: 'pay-' + id, type: 'payout', at: x.date, label: 'Card earnings paid by RideNaija', amount: -(Number(x.amount) || 0) });
  });
  let pending = 0;
  Object.entries(withdrawals || {}).forEach(([id, w]) => {
    if (!w || w.riderKey !== rider.fbKey || w.status === 'rejected') return;
    const amt = Number(w.amount) || 0;
    if ((w.status || 'pending') === 'pending') pending += amt;
    entries.push({ id: 'wd-' + id, type: 'withdrawal', at: w.requestedAt, label: w.status === 'paid' ? 'Withdrawal paid' : 'Withdrawal pending', amount: -amt, status: w.status || 'pending' });
  });
  entries.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  const balance = entries.reduce((s, e) => s + e.amount, 0);
  const owed = Math.max(0, -balance);
  return {
    balance, available: Math.max(0, balance), owed, pending,
    limit: limit || 0, blocked: !!limit && owed > limit,
    entries: entries.slice(0, 40),
  };
}

async function wallet(db, rider, now) {
  const { start, ledger } = await syncJobs(db, rider, now);
  const [remittances, cardPayments, withdrawals, limits] = await Promise.all([
    val(db, 'company_cash_remittances'), val(db, 'company_card_payments'),
    // all withdrawals for this rider
    db.ref('withdrawals').orderByChild('riderKey').equalTo(rider.fbKey).once('value').then((s) => s.val()),
    val(db, 'settings/ledger'),
  ]);
  return buildWallet({ start, ledger, remittances, cardPayments, withdrawals, rider, limit: Number(limits && limits.cashOwedLimit) || 0 });
}

async function withdraw(db, rider, body, now) {
  const amount = Math.round(Number(body.amount));
  if (!amount || amount < MIN_WITHDRAW) return { error: 'min', min: MIN_WITHDRAW };
  const bank = bankOf(rider);
  if (!bank.bankName || !/^\d{10}$/.test(bank.account)) return { error: 'no_account' };
  if (rider.status && rider.status !== 'verified' && rider.status !== 'busy') return { error: 'not_verified' };

  // one request at a time per rider (also stops double taps)
  const lockRef = db.ref('ledger_lock/' + rider.fbKey);
  const lock = await lockRef.transaction((cur) => (cur && now - cur < 60000 ? undefined : now));
  if (!lock.committed) return { error: 'busy' };
  try {
    const w = await wallet(db, rider, now);
    if (w.pending > 0) return { error: 'pending_exists', wallet: w };
    if (amount > w.available) return { error: 'insufficient', wallet: w };
    const rec = {
      type: 'withdrawal', role: 'rider', amount, riderKey: rider.fbKey,
      customerName: (rider.name || 'Rider') + ' (Fleet rider)', phone: String(rider.phone || ''),
      bankName: bank.bankName, account: bank.account, accountName: bank.accountName,
      status: 'pending', requestedAt: new Date(now).toISOString(), platform: 'native',
    };
    await db.ref('withdrawals').push(rec);
    return { ok: true, amount, wallet: await wallet(db, rider, now) };
  } finally {
    await lockRef.remove();
  }
}

async function run(db, body, now = Date.now()) {
  const who = await loadRider(db, body);
  if (who.error) return { error: who.error };
  const rider = who.rider;
  if (!isFleet(rider)) return { enabled: false };
  if (body.action === 'withdraw') return withdraw(db, rider, body, now);
  if (body.action === 'status') return { enabled: true, minWithdraw: MIN_WITHDRAW, bank: { bankName: bankOf(rider).bankName, account: bankOf(rider).account.replace(/^(\d{3})\d{4}/, '$1****') }, wallet: await wallet(db, rider, now) };
  return { error: 'bad_action' };
}

exports.handler = async function (event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'method' }) };
  if (!admin.apps.length) return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'not_configured' }) };
  try {
    const body = JSON.parse(event.body || '{}');
    const out = await run(admin.database(), body);
    return { statusCode: out.error ? 400 : 200, headers: HEADERS, body: JSON.stringify(out) };
  } catch (e) {
    console.error('[rider-money]', e);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'server' }) };
  }
};

exports.__test = { run, jobMoney, isMine, isDone, buildWallet, MIN_WITHDRAW };
