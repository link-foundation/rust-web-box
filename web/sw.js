// Service Worker for rust-web-box.
//
// Responsibilities (target state):
//   1. Aggressively cache the VS Code Web bundle and CheerpX runtime so
//      repeat visits load in <10 s.
//   2. Synthesize Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy
//      response headers for same-origin assets so SharedArrayBuffer +
//      WASM threads work on GitHub Pages, which doesn't set them itself.
//
// Current state: only the COOP/COEP shim is wired up, since the VS Code Web
// and CheerpX bundles aren't vendored yet. Caching is gated behind a version
// constant so we can invalidate cleanly when the bundles land.

const CACHE_VERSION = 'rust-web-box-v0';
const SHELL_ASSETS = [
  './',
  './index.html',
  './glue/boot.js',
  './glue/boot.css',
  './glue/network-shim.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) =>
          key === CACHE_VERSION ? null : caches.delete(key),
        ),
      ),
    ),
  );
  self.clients.claim();
});

function withCoopCoep(response) {
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return withCoopCoep(cached);
      return fetch(event.request).then((response) => {
        const copy = response.clone();
        caches
          .open(CACHE_VERSION)
          .then((cache) => cache.put(event.request, copy))
          .catch(() => {});
        return withCoopCoep(response);
      });
    }),
  );
});
