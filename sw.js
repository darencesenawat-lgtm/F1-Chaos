// sw.js — F1 Chaos PWA
// Static-only caching. Network-only for /api/* and /data/*.

const CACHE_VERSION = 'v4';
const CACHE_NAME = `f1-chaos-${CACHE_VERSION}`;

// Put your core static files here (add more as needed)
const PRECACHE = [
  '/',               // index.html (served by Vercel as /)
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// --- Install: precache core assets
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
});

// --- Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(k => k.startsWith('f1-chaos-') && k !== CACHE_NAME)
        .map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

// --- Fetch: static cache only; bypass /api/* and /data/*
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GETs
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  // 🚫 NEVER cache dynamic routes (chat replies, game JSON)
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/data/')) {
    return; // network-only: let the browser fetch it live
  }

  // SPA navigation fallback: return cached index.html when offline
  const isNavRequest =
    req.mode === 'navigate' ||
    (req.headers.get('accept') || '').includes('text/html');

  if (isNavRequest) {
    event.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets: stale-while-revalidate
  event.respondWith(staleWhileRevalidate(req));
});

// --- Helper: stale-while-revalidate for static files
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((res) => {
      // Only cache OK same-origin basic responses
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        cache.put(request, copy);
      }
      return res;
    })
    .catch(() => null);

  // Prefer cached, fall back to network
  return cached || networkFetch || caches.match('/index.html');
}
