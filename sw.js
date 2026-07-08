const CACHE_NAME = 'ridenaija-v24';
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
// PUSH NOTIFICATIONS — handled directly, without firebase-messaging-compat.js
//
// Why: that library listens for the 'push' event internally and eventually
// calls showNotification() on our behalf, but it doesn't always signal back
// to the browser fast/reliably enough that the event has been fully handled.
// Chrome REQUIRES every push to result in a notification, and if it isn't
// sure one is coming in time, it shows its own generic fallback ("This site
// has been updated in the background") as a safety net — right alongside
// the real one a moment later. That's the duplicate you were seeing.
//
// Handling the raw 'push' event ourselves and wrapping it in event.waitUntil()
// removes that ambiguity entirely: Chrome can see, directly, that we already
// committed to showing exactly one notification for this event.
// ═══════════════════════════════════════════════════════════
self.addEventListener('push', function (event) {
  event.waitUntil((async function () {
    let data = {};
    try {
      const payload = event.data ? event.data.json() : {};
      data = payload.data || payload || {};
    } catch (e) {
      console.error('[RideNaija] push payload parse error:', e);
    }
    const title = data.title || 'RideNaija';
    // De-duplication: give every notification a stable "tag" derived from the
    // booking it's about (or the title, if there's no booking id). If the same
    // event is ever delivered more than once to this device, the browser
    // REPLACES the existing notification with the same tag instead of
    // stacking a second one next to it.
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
    return self.registration.showNotification(title, options);
  })());
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
