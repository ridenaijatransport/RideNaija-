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

messaging.onBackgroundMessage(function(payload) {
  const title = (payload.notification && payload.notification.title) || 'RideNaija';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: payload.data || {},
    vibrate: [200, 100, 200]
  };
  self.registration.showNotification(title, options);
});
