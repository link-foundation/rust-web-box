# Root cause #3 — Top‑level document is not `crossOriginIsolated`

## Symptom

In the browser console:

```js
> self.crossOriginIsolated
false
> typeof SharedArrayBuffer
"undefined"
```

CheerpX detects the absent `SharedArrayBuffer` and falls back to a
single‑threaded code path. On Alpine + Rust, single‑threaded mode is
several times slower and occasionally hangs because some of CheerpX's
JIT codegen assumes worker threads.

## Why

GitHub Pages does not allow custom response headers
([community discussion](https://github.com/orgs/community/discussions/categories/pages)).
Cross‑origin isolation requires **two** response headers on the
top‑level document:

* `Cross-Origin-Opener-Policy: same-origin`
* `Cross-Origin-Embedder-Policy: require-corp` *or* `credentialless`

(See [web.dev guide](https://web.dev/cross-origin-isolation-guide/).)

We attempt to synthesize these via the Service Worker in `web/sw.js:56–79`:

```js
function withCoopCoep(response) {
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  ...
}
```

But this only works for **subresource fetches that the SW intercepts**.
The very first navigation that loads `index.html` is fetched directly
from the network (no SW is registered yet), so the document's response
has no COOP/COEP. The browser caches that decision for the lifetime of
the document. Subsequent reloads will get COOP/COEP from the SW *if* the
SW has activated and is in scope, but only after the first visit triggers
the SW registration.

## The known fix: `coi-serviceworker`

The community workaround is documented at
[gzuidhof/coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)
(MIT). It's a tiny SW (≈5 KB) that:

1. On the very first navigation, registers itself and **forces a one‑time
   reload** (`window.location.reload()`).
2. On the reload, intercepts the navigation request (now in scope) and
   synthesizes COOP/COEP headers.
3. On warm loads, no reload is needed; the SW is already active.

This is what [stackblitz/webcontainers](https://webcontainers.io/) and
many other WASM‑threading SPAs deploy on GitHub Pages. It is the
documented escape hatch.

## Trade‑offs

* **Cost**: one extra reload on the very first visit (the user sees a
  brief flash). Subsequent visits incur no overhead.
* **Failure mode**: if the SW fails to register (e.g. private browsing
  with SW disabled), the page boots in non‑isolated mode. CheerpX still
  works but threading is unavailable. We surface a toast in this case.
* **Compatibility**: works on Chrome, Edge, Firefox 113+, Safari 17.4+.
  Older Safari is unaffected: it never had `SharedArrayBuffer` in
  cross‑origin contexts so users were never threaded anyway.

## Verification

`web/tests/coop-coep.test.mjs` (new):

* Asserts `web/coi-serviceworker.js` is shipped under
  `web/`.
* Asserts `web/index.html` loads it as the **first** script tag in
  `<head>`.
* Asserts the SW correctly identifies itself with a unique cache name so
  it doesn't collide with our existing `web/sw.js`.

In‑browser verification (Playwright):

* Navigate to the page, wait for `__rustWebBox.crossOriginIsolated`
  to be `true`. Reject if false after 10 s.

## Upstream report

`actions/deploy-pages` should support an optional `headers:` input that
emits a `_headers` file (Cloudflare Pages style) or wires header overrides
some other way. The SW workaround is fragile and adds a reload to first
load. A Pages‑native COOP/COEP option would benefit every WASM threading
project deploying on Pages.
