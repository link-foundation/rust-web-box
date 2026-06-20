// Regression tests for issue #43: the service worker must keep our own
// mutable app shell FRESH so a code fix actually reaches users.
//
// Bug shape: `sw.js` served every same-origin request cache-first and only
// evicted the cache when `CACHE_VERSION` changed — and that version was
// bumped only when the vendored bundle versions changed. After #39 removed
// the custom error toast and v0.16.0/v0.17.0 shipped the fix, an iPad that
// had cached the v0.15.0 shell kept serving the stale `index.html` /
// `glue/boot.js` forever. The user reloaded, the fix was live on the
// origin, and the device still rendered the old toast — "still not working
// on iPad Pro".
//
// Fix: split assets by mutability. The app shell (our HTML + `glue/*` +
// `extensions/*`) is served network-first (fresh, offline-tolerant); the
// large vendored bundles (`vscode-web/*`, `cheerpx/*`, `disk/*`) stay
// cache-first for the warm <10 s load.
//
// These tests EXECUTE sw.js in a mocked ServiceWorkerGlobalScope so the
// strategy is verified by behaviour, not just by reading the source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://link-foundation.github.io';
const BASE = '/rust-web-box';

// A minimal response stand-in we fully control (real Node Response always
// reports type 'default', and we need 'basic' to exercise the cache path).
function mkResp(body, { ok = true, status = 200, type = 'basic' } = {}) {
  return {
    body,
    ok,
    status,
    statusText: status === 200 ? 'OK' : 'ERR',
    type,
    headers: new Headers(),
    clone() {
      return mkResp(body, { ok, status, type });
    },
  };
}

// Read back the text of whatever the worker handed to `respondWith`. The
// worker wraps every served response through `withCoopCoep`, which builds a
// real Response, so `.text()` is available.
async function bodyText(response) {
  if (response && typeof response.text === 'function') return response.text();
  return response?.body ?? null;
}

async function loadWorker({ cacheSeed = {}, fetchImpl } = {}) {
  const src = await fs.readFile(path.join(WEB_ROOT, 'sw.js'), 'utf8');

  // One in-memory cache keyed by request URL string.
  const store = new Map(Object.entries(cacheSeed));
  const fetchCalls = [];

  const cache = {
    addAll: async () => {},
    put: async (req, resp) => {
      store.set(reqUrl(req), resp);
    },
    match: async (req) => store.get(reqUrl(req)) ?? undefined,
  };
  const caches = {
    open: async () => cache,
    match: async (req) => store.get(reqUrl(req)) ?? undefined,
    keys: async () => ['rust-web-box-stale-v0'],
    delete: async () => true,
  };

  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, handler) => {
      listeners[type] = handler;
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    caches,
  };

  const fetchMock =
    fetchImpl ??
    (async (req) => {
      fetchCalls.push(reqUrl(req));
      return mkResp(`NETWORK:${reqUrl(req)}`);
    });

  const sandbox = {
    self,
    caches,
    fetch: fetchMock,
    Response,
    Headers,
    URL,
    Promise,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'sw.js' });

  return { listeners, store, fetchCalls, self };
}

function reqUrl(req) {
  return typeof req === 'string' ? req : req.url;
}

// Drive the captured fetch listener with a fake FetchEvent.
async function handleFetch(listeners, url, { headers = {} } = {}) {
  let served;
  const event = {
    request: { url, headers: new Headers(headers) },
    respondWith: (p) => {
      served = p;
    },
  };
  listeners.fetch(event);
  return served === undefined ? undefined : await served;
}

test('sw: registers install/activate/fetch listeners', async () => {
  const { listeners } = await loadWorker();
  assert.equal(typeof listeners.install, 'function');
  assert.equal(typeof listeners.activate, 'function');
  assert.equal(typeof listeners.fetch, 'function');
});

test('sw: app-shell glue is network-first — a fresh deploy wins over a stale cache (issue #43)', async () => {
  const url = `${ORIGIN}${BASE}/glue/boot.js`;
  const { listeners, store } = await loadWorker({
    cacheSeed: { [url]: mkResp('STALE-TOAST-CODE') },
    fetchImpl: async () => mkResp('FRESH-NATIVE-NOTIFICATIONS'),
  });
  const res = await handleFetch(listeners, url);
  assert.equal(
    await bodyText(res),
    'FRESH-NATIVE-NOTIFICATIONS',
    'glue must be served from the network, not the stale cache',
  );
  // ...and the fresh copy refreshes the cache for offline use.
  assert.equal(store.get(url).body, 'FRESH-NATIVE-NOTIFICATIONS');
});

test('sw: index.html navigation is network-first (fresh shell each load)', async () => {
  const url = `${ORIGIN}${BASE}/index.html`;
  const { listeners } = await loadWorker({
    cacheSeed: { [url]: mkResp('STALE-HTML') },
    fetchImpl: async () => mkResp('FRESH-HTML'),
  });
  const res = await handleFetch(listeners, url);
  assert.equal(await bodyText(res), 'FRESH-HTML');
});

test('sw: the "./" navigation root is network-first', async () => {
  const url = `${ORIGIN}${BASE}/`;
  const { listeners } = await loadWorker({
    cacheSeed: { [url]: mkResp('STALE-ROOT') },
    fetchImpl: async () => mkResp('FRESH-ROOT'),
  });
  const res = await handleFetch(listeners, url);
  assert.equal(await bodyText(res), 'FRESH-ROOT');
});

test('sw: extensions are network-first too (the webvm-host extension ships the notification surface)', async () => {
  const url = `${ORIGIN}${BASE}/extensions/webvm-host/extension.js`;
  const { listeners } = await loadWorker({
    cacheSeed: { [url]: mkResp('STALE-EXT') },
    fetchImpl: async () => mkResp('FRESH-EXT'),
  });
  const res = await handleFetch(listeners, url);
  assert.equal(await bodyText(res), 'FRESH-EXT');
});

test('sw: app shell falls back to cache when the network is offline', async () => {
  const url = `${ORIGIN}${BASE}/glue/boot.js`;
  const { listeners } = await loadWorker({
    cacheSeed: { [url]: mkResp('CACHED-OFFLINE-COPY') },
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  const res = await handleFetch(listeners, url);
  assert.equal(await bodyText(res), 'CACHED-OFFLINE-COPY');
});

test('sw: vendored vscode-web bundle is cache-first (warm <10 s load preserved)', async () => {
  const url = `${ORIGIN}${BASE}/vscode-web/out/vs/workbench/workbench.web.main.js`;
  let networkHits = 0;
  const { listeners } = await loadWorker({
    cacheSeed: { [url]: mkResp('CACHED-BUNDLE') },
    fetchImpl: async () => {
      networkHits += 1;
      return mkResp('NETWORK-BUNDLE');
    },
  });
  const res = await handleFetch(listeners, url);
  assert.equal(await bodyText(res), 'CACHED-BUNDLE', 'vendored bundle must come from cache');
  assert.equal(networkHits, 0, 'a cache hit on a vendored bundle must not touch the network');
});

test('sw: cheerpx + disk assets are cache-first', async () => {
  for (const p of ['/cheerpx/cx.js', '/disk/rust-alpine.ext2']) {
    const url = `${ORIGIN}${BASE}${p}`;
    let networkHits = 0;
    const { listeners } = await loadWorker({
      cacheSeed: { [url]: mkResp('CACHED') },
      fetchImpl: async () => {
        networkHits += 1;
        return mkResp('NETWORK');
      },
    });
    const res = await handleFetch(listeners, url);
    assert.equal(await bodyText(res), 'CACHED', `${p} must be cache-first`);
    assert.equal(networkHits, 0, `${p} cache hit must not touch the network`);
  }
});

test('sw: every response carries synthesized COOP/COEP isolation headers', async () => {
  const url = `${ORIGIN}${BASE}/glue/boot.js`;
  const { listeners } = await loadWorker({
    fetchImpl: async () => mkResp('FRESH'),
  });
  const res = await handleFetch(listeners, url);
  assert.equal(res.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
  assert.equal(res.headers.get('Cross-Origin-Embedder-Policy'), 'require-corp');
});

test('sw: cross-origin requests are passed through untouched (no respondWith)', async () => {
  const { listeners } = await loadWorker();
  const res = await handleFetch(listeners, 'https://cdn.example.com/some-asset.js');
  assert.equal(res, undefined, 'cross-origin requests must not be intercepted');
});

test('sw: range requests bypass the cache and pass through with headers', async () => {
  const url = `${ORIGIN}${BASE}/vscode-web/out/vs/big-asset.js`;
  let networkHits = 0;
  const { listeners } = await loadWorker({
    cacheSeed: { [url]: mkResp('CACHED-RANGE') },
    fetchImpl: async () => {
      networkHits += 1;
      return mkResp('RANGE-BODY');
    },
  });
  const res = await handleFetch(listeners, url, { headers: { range: 'bytes=0-1023' } });
  assert.equal(networkHits, 1, 'range request must hit the network, not the cache');
  assert.equal(res.headers.get('Cross-Origin-Opener-Policy'), 'same-origin');
});

test('sw: activate evicts caches whose key is not the current CACHE_VERSION', async () => {
  const deleted = [];
  const src = await fs.readFile(path.join(WEB_ROOT, 'sw.js'), 'utf8');
  const listeners = {};
  const caches = {
    open: async () => ({ addAll: async () => {} }),
    keys: async () => ['rust-web-box-old-1', 'rust-web-box-old-2'],
    delete: async (key) => {
      deleted.push(key);
      return true;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (t, h) => {
      listeners[t] = h;
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    caches,
  };
  const sandbox = { self, caches, fetch: async () => {}, Response, Headers, URL, Promise, console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'sw.js' });

  let waited;
  await listeners.activate({ waitUntil: (p) => (waited = p) });
  await waited;
  assert.deepEqual(deleted.sort(), ['rust-web-box-old-1', 'rust-web-box-old-2']);
});

test('sw: CACHE_VERSION carries an app-shell epoch so the stale-cache eviction is forced (issue #43)', async () => {
  const src = await fs.readFile(path.join(WEB_ROOT, 'sw.js'), 'utf8');
  const m = src.match(/CACHE_VERSION = '([^']+)'/);
  assert.ok(m, 'CACHE_VERSION must be a single-quoted string literal');
  assert.match(m[1], /-app\d+$/, 'CACHE_VERSION must end with an -app{N} epoch token');
});
