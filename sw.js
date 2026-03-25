// Service Worker — force fresh content, no CDN cache
// v1.61 — 2026-03-25
const SW_VERSION = 'v1.70';
self.addEventListener('install', e => {
  console.log('[SW] Install ' + SW_VERSION);
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.map(k => {
    console.log('[SW] Purging cache: ' + k);
    return caches.delete(k);
  }))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  // Force no-cache for all same-origin HTML/JS/CSS
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match(e.request))
    );
  }
});
