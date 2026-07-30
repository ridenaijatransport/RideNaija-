const CACHE_NAME = 'ridenaija-v24';
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

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request).catch(() => caches.match('/index.html'))));
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
