/* Minimal service worker: PWA kurulumu için; API isteklerine müdahale etmez. */
self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
