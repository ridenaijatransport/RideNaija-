const CACHE_NAME = 'ridenaija-v25';
const ASSETS = ['/', '/index.html', '/admin.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
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

// NETWORK-FIRST (was cache-first). This is the fix for a real bug: with
// cache-first, a saved copy of index.html/admin.html only ever got refreshed
// when sw.js itself also changed — so an update to just index.html could
// silently never reach a returning visitor even after a fully successful
// deploy, no matter how many times the page was reloaded. Network-first
// means every visit with a connection gets the true latest version; the
// cache is only ever used as a fallback when there's genuinely no network,
// which is the only thing a service worker cache should be protecting
// against for HTML pages.
self.addEventListener('fetch', e => {
  e.respondWith(
    fetch(e.request).then(networkResponse => {
      const respClone = networkResponse.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(e.request, respClone)).catch(() => {});
      return networkResponse;
    }).catch(() => caches.match(e.request).then(cached => cached || caches.match('/index.html')))
  );
});

// ═══════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS — handled directly via the native 'push' event, without
// firebase-messaging-compat.js. That library doesn't always signal back to
// the browser fast enough that a notification is coming, so Chrome would
// show its own generic fallback alongside the real one. Handling the raw
// event ourselves and wrapping it in event.waitUntil() removes that
// ambiguity entirely.
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

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.link) || '/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
