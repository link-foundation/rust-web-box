// Service Worker for rust-web-box.
//
// Responsibilities:
//   1. Cache the vendored VS Code Web bundle and the CheerpX runtime so
//      repeat visits load in <10 s (issue #1 acceptance criterion 10).
//   2. Keep our own app shell (index.html + everything under `glue/` and
//      `extensions/`) **fresh** on every visit, so a code fix actually
//      reaches users on their next load (issue #43).
//   3. Synthesize Cross-Origin-Opener-Policy / Cross-Origin-Embedder-Policy
//      response headers for same-origin assets so SharedArrayBuffer +
//      WASM threads work on GitHub Pages, which doesn't set them itself.
//
// ── Why two caching strategies (issue #43) ───────────────────────────────
// The original worker served *every* same-origin request cache-first and
// only evicted the cache when `CACHE_VERSION` changed — and that version
// was bumped only when the vendored bundle versions changed. The result:
// after #39 removed the custom error toast and v0.16.0/v0.17.0 shipped the
// fix, an iPad that had visited during v0.15.0 kept serving the *stale*
// cached `index.html` / `glue/boot.js` forever. The user reloaded, the fix
// was live on the origin, yet the device still rendered the old toast and
// the old "open the browser console" advisory — "still not working on iPad
// Pro" (issue #43). The merged fix could never reach the device.
//
// The fix is to split assets by mutability:
//   • **App shell** (our HTML + `glue/*` + `extensions/*`) is *mutable* —
//     it changes on every release. Serve it **network-first**: fetch the
//     live copy, update the cache, fall back to cache only when offline.
//     A code fix now lands on the very next online load, no manual cache
//     bump required. These files are tiny, so the network round-trip is
//     cheap.
//   • **Vendored bundles** (`vscode-web/*`, `cheerpx/*`, `disk/*`) are
//     large and effectively *immutable* — their contents change only when
//     their pinned version (encoded in `CACHE_VERSION`) changes. Serve
//     them **cache-first** for the <10 s warm load, and rely on the
//     `CACHE_VERSION` bump + `activate` eviction to roll them forward.
//
// `CACHE_VERSION` is still bumped whenever the vendored bundle versions
// change (so old immutable assets get evicted), and additionally carries
// an app-shell epoch (`-app{N}`) that we bump on any breaking change to the
// shell-caching contract — bumping it forces a one-time eviction of every
// device's stale cache, which is exactly what unsticks the iPads already
// pinned to the pre-#39 shell.

// Bump the `-app{N}` suffix on any change to the shell-caching contract,
// and the `cheerpx`/`vscode` tokens whenever the vendored bundles change,
// so old caches get evicted on activate.
const CACHE_VERSION = 'rust-web-box-v3-vscode1.91.1-cheerpx1.3.3-app2';

// Static shell + glue, pre-cached on install so the offline fallback has
// something to serve. These are served network-first at runtime (see
// `isShellAsset`), so pre-caching only matters for the offline path.
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

// Our own app shell is mutable and must stay fresh. Everything that is NOT
// a large vendored bundle is treated as shell. We allowlist the immutable
// vendored prefixes and treat the rest of the same-origin space as shell
// so a newly-added glue/extension file is fresh by default rather than
// silently pinned to its first-seen version.
const IMMUTABLE_PREFIXES = ['/vscode-web/', '/cheerpx/', '/disk/'];

function isImmutableAsset(pathname) {
  return IMMUTABLE_PREFIXES.some((prefix) => pathname.includes(prefix));
}

function isShellAsset(pathname) {
  return !isImmutableAsset(pathname);
}

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
  // Take over as soon as possible so the freshness fix applies on this
  // navigation rather than the one after next.
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
  // The warm disk is staged onto this Pages origin as GitHubDevice
  // chunks, so the page no longer needs experimental COEP
  // `credentialless` to tolerate a cross-origin Release asset. Use the
  // stricter, more widely implemented isolation pair for CheerpX's
  // SharedArrayBuffer/WASM-threading path.
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  // Same-origin assets still flag CORP for any embedded subresources.
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Cache-first: serve the cached copy if present, otherwise fetch and cache.
// Used for the large, effectively-immutable vendored bundles.
function cacheFirst(request) {
  return caches.match(request).then((cached) => {
    if (cached) return withCoopCoep(cached);
    return fetch(request)
      .then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches
            .open(CACHE_VERSION)
            .then((cache) => cache.put(request, copy))
            .catch(() => {});
        }
        return withCoopCoep(response);
      })
      .catch(
        (err) =>
          new Response(`fetch failed: ${err.message}`, {
            status: 503,
            statusText: 'Service Unavailable',
          }),
      );
  });
}

// Network-first: fetch the live copy and refresh the cache, falling back to
// the cached copy only when the network is unavailable. Used for our own
// mutable app shell so a code fix reaches the user on the next online load
// (issue #43) while still working offline.
function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok && response.type === 'basic') {
        const copy = response.clone();
        caches
          .open(CACHE_VERSION)
          .then((cache) => cache.put(request, copy))
          .catch(() => {});
      }
      return withCoopCoep(response);
    })
    .catch(() =>
      caches.match(request).then((cached) => {
        if (cached) return withCoopCoep(cached);
        return new Response('offline and no cached copy available', {
          status: 503,
          statusText: 'Service Unavailable',
        });
      }),
    );
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

  // Mutable app shell → network-first (always fresh, offline-tolerant).
  // Immutable vendored bundles → cache-first (fast warm load).
  if (isShellAsset(url.pathname)) {
    event.respondWith(networkFirst(event.request));
  } else {
    event.respondWith(cacheFirst(event.request));
  }
});
