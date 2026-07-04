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

// Data-only payload — we display the notification manually so it only shows ONCE
messaging.onBackgroundMessage(function(payload) {
  const data = payload.data || {};
  const title = data.title || 'RideNaija';
  const body  = data.body  || '';
  const link  = data.link  || '/index.html';

  self.registration.showNotification(title, {
    body: body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { link: link },
    vibrate: [200, 100, 200]
  });
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.link) || '/index.html';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(windowClients) {
      for (let i = 0; i < windowClients.length; i++) {
        const client = windowClients[i];
        if (client.url.includes(targetUrl.split('?')[0]) && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
