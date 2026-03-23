const CACHE_VERSION = 'v5';
const STATIC_CACHE = `werunops-static-${CACHE_VERSION}`;
const PAGE_CACHE = `werunops-pages-${CACHE_VERSION}`;
const CORE_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './config.js',
  './app.js',
  './github-api.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(CORE_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== PAGE_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/')) return;

  const sameOrigin = url.origin === self.location.origin;
  const isNavigation = request.mode === 'navigate';
  const isStaticAsset = sameOrigin && /\.(css|js|png|jpg|jpeg|svg|ico|webp)$/i.test(url.pathname);

  // Keep HTML fresh while preserving offline fallback.
  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const cloned = response.clone();
          caches.open(PAGE_CACHE).then((cache) => cache.put(request, cloned));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match('./index.html');
        })
    );
    return;
  }

  // Static assets use stale-while-revalidate for snappy reloads.
  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const refresh = fetch(request)
          .then((response) => {
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
            return response;
          })
          .catch(() => null);

        return cached || refresh;
      })
    );
    return;
  }

  // Other requests prefer network and fall back to cache when available.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (sameOrigin) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
