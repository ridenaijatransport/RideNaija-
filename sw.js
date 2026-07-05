const CACHE_NAME = 'ridenaija-v23';
const ASSETS = ['/', '/index.html', '/admin.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  // Cache each asset independently so one missing/renamed file (e.g. an icon
  // path that doesn't match what's actually deployed) can never block the
  // whole install. cache.addAll() is all-or-nothing — a single 404 used to
  // fail the entire install, which meant the SW never reached 'activated',
  // which meant notification setup (which waits for that state) hung forever.
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(ASSETS.map(url => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('/index.html'))));
});

// ═══════════════════════════════════════════════════════════
// FIREBASE CLOUD MESSAGING — background push notifications
// This is the ONLY service worker file in the whole app. Every portal
// (admin/index/rider-portal/partner-portal) registers this exact same
// file at the exact same scope, so there is only ever one SW registration
// for the origin. Registering more than one script at the same scope was
// the root cause of duplicate/inconsistent push notifications.
// ═══════════════════════════════════════════════════════════
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAAGIy2WpDB491rR1M8oCGEzThuMrrJMrA",
  authDomain: "ridenaija-14d88.firebaseapp.com",
  databaseURL: "https://ridenaija-14d88-default-rtdb.firebaseio.com",
  projectId: "ridenaija-14d88",
  storageBucket: "ridenaija-14d88.firebasestorage.app",
  messagingSenderId: "75868798616",
  appId: "1:75868798616:web:eb8ceadb9992fb79ee5aed"
});

const messaging = firebase.messaging();

// Fires when a push arrives and the app is not in the foreground
// (closed, minimized, or a different browser tab is active)
// NOTE: the backend (netlify/functions/send-notification.js) sends a
// DATA-ONLY payload (message.data, not message.notification) on purpose —
// that's what stops the browser from auto-displaying its own unstyled
// notification. So this handler must read payload.data, not payload.notification.
messaging.onBackgroundMessage(function (payload) {
  const data = payload.data || {};
  const title = data.title || 'RideNaija';
  // De-duplication: give every notification a stable "tag" derived from the
  // booking it's about (or the title, if there's no booking id). If the same
  // event ever gets delivered more than once to this device — a leftover old
  // registration, a retried send, a topic fan-out hitting a stale token that
  // is technically still "this device" — the browser REPLACES the existing
  // notification with the same tag instead of stacking a second one next to
  // it. This is what stops the "one blank + one with content" duplicate.
  const tag = 'rn-' + (data.bookingId || data.link || title);
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { link: data.link || '/index.html' },
    vibrate: [200, 100, 200],
    tag: tag,
    renotify: true
  };
  self.registration.showNotification(title, options);
});

// Tapping a notification focuses an existing tab if one is open, else opens a new one
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.link) || '/index.html';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windowClients) {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(targetUrl.split('?')[0]) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
