// Service Worker for rust-web-box.
//
// Responsibilities:
//   1. Aggressively cache the static shell, the vendored VS Code Web
//      bundle, and the CheerpX runtime so repeat visits load in <10 s
//      (issue #1 acceptance criterion 10).
//   2. Synthesize Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy
//      response headers for same-origin assets so SharedArrayBuffer +
//      WASM threads work on GitHub Pages, which doesn't set them itself.
//
// The cache version is bumped whenever the vendored bundle versions
// change so old caches get evicted on activate.

// Bump on every breaking change to the bundled assets so old caches
// get evicted on activate.
const CACHE_VERSION = 'rust-web-box-v2-vscode1.91.1-cheerpx1.2.11';

// Static shell + glue. The VS Code Web bundle and CheerpX assets are
// fetched lazily and cached on first hit (handled by the fetch listener),
// so this list stays manageable.
const SHELL_ASSETS = [
  './',
  './index.html',
  './glue/boot.js',
  './glue/boot.css',
  './glue/network-shim.js',
  './glue/cheerpx-bridge.js',
  './glue/webvm-bus.js',
  './glue/webvm-server.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .catch(() => {
        // Pre-caching is best-effort; assets may not exist when running
        // tests against a non-built tree.
      }),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => (key === CACHE_VERSION ? null : caches.delete(key))),
      ),
    ),
  );
  self.clients.claim();
});

function withCoopCoep(response) {
  // The body of an opaque response can't be re-wrapped, so leave those
  // alone. Same for non-2xx.
  if (!response || response.type === 'opaque' || response.status === 0) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  // Make sure SharedArrayBuffer-needing assets are flagged
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Only handle same-origin requests; cross-origin (CDN) requests pass
  // through unmodified so the network shim's proxy fallback works.
  if (url.origin !== self.location.origin) return;

  // Don't try to cache range requests (the VS Code bundle uses range
  // requests for some assets); pass them through with COOP/COEP headers.
  if (event.request.headers.get('range')) {
    event.respondWith(fetch(event.request).then(withCoopCoep));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return withCoopCoep(cached);
      return fetch(event.request)
        .then((response) => {
          // Only cache successful basic responses.
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(event.request, copy))
              .catch(() => {});
          }
          return withCoopCoep(response);
        })
        .catch((err) => {
          // Surface as a 503 so the page can show a graceful fallback.
          return new Response(`fetch failed: ${err.message}`, {
            status: 503,
            statusText: 'Service Unavailable',
          });
        });
    }),
  );
});
