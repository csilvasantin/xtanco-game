try {
  self.importScripts('./xtanco-version.js');
} catch (error) {}

const APP = self.XTANCO_APP || {};
const CORE_CACHE = APP.cacheName || 'admiraxp-dev';
const RUNTIME_CACHE = CORE_CACHE + '-runtime';
const CACHE_PREFIXES = ['xtanco-', 'admirasimulator-', 'admiraxp-'];
const CORE_FILES = [
  './',
  './index.html',
  './game.html',
  './README.md',
  './xtanco-version.js',
  './xtanco-runtime-config.js',
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CORE_CACHE)
      .then(cache => cache.addAll(CORE_FILES.map(url => new Request(url, { cache: 'reload' }))))
      .catch(() => undefined)
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => {
      if (CACHE_PREFIXES.some(prefix => key.startsWith(prefix)) && key !== CORE_CACHE && key !== RUNTIME_CACHE) {
        return caches.delete(key);
      }
      return Promise.resolve();
    }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  if (isDocumentRequest(request) || isRuntimeRequest(url.pathname) || isStaticRequest(url.pathname)) {
    event.respondWith(networkFirst(request, CORE_CACHE));
    return;
  }

  if (isMediaRequest(request, url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
  }
});

function isDocumentRequest(request) {
  const accept = request.headers.get('accept') || '';
  return request.mode === 'navigate' || accept.includes('text/html');
}

function isRuntimeRequest(pathname) {
  return pathname.endsWith('/xtanco-version.js') || pathname.endsWith('/xtanco-runtime-config.js');
}

function isStaticRequest(pathname) {
  return /\.(html|js|css|json)$/i.test(pathname);
}

function isMediaRequest(request, pathname) {
  if (['image', 'audio', 'video', 'font'].includes(request.destination)) return true;
  return /\.(png|jpg|jpeg|gif|svg|ico|mp3|m4a|wav|mp4|webm)$/i.test(pathname);
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request) || await caches.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => undefined);

  if (cached) return cached;
  const fresh = await networkPromise;
  if (fresh) return fresh;
  throw new Error('Asset unavailable: ' + request.url);
}
