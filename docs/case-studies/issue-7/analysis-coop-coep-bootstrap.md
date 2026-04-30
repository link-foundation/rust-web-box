# Root cause #1 — Top‑level navigation never gets COOP/COEP

## Symptom

In the live console at <https://link-foundation.github.io/rust-web-box/>:

```
[ERROR] CheerpX initialization failed: DataCloneError:
        Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope':
        SharedArrayBuffer transfer requires self.crossOriginIsolated.
```
(*evidence/console-first-load.txt:29*)

Independently confirmed via Playwright's `evaluate("__rustWebBox.dump()")`:

```json
{
  "crossOriginIsolated": false,
  "sharedArrayBuffer": false,
  "serviceWorker": true,
  "vmPhase": "starting Linux"
}
```

`serviceWorker: true` means the SW registered and is the document's
controller — but `crossOriginIsolated: false` means the document was
fetched **before** the SW was the controller, so its response did not
have COOP/COEP. Because isolation is latched at the navigation, no
amount of subsequent SW interception can flip it.

## Mechanism — why the SW alone is not enough

`web/sw.js:62–73` synthesizes the right headers:

```js
function withCoopCoep(response) {
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Cross-Origin-Embedder-Policy', 'credentialless');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(response.body, { ..., headers });
}
```

It works for **subresources** because by the time
`workbench.web.main.js` issues its module fetches, the SW is the
document's controller and the SW's `fetch` listener wraps every same‑
origin response in `withCoopCoep()`. The browser sees those subresources
arrive with COEP=credentialless and is happy to embed them in the
already‑isolated document.

But the **document itself** is the very first request of the
navigation, and:

1. The SW registration call lives in `boot.js` (a `type=module` script
   that runs after the AMD bootstrap chain), so it can't even start
   until the document has parsed.
2. Even if it ran from a synchronous `<script>` in `<head>`, the
   `register()` returns a promise. By the time the SW activates, the
   document HTTP response has already been parsed and committed.
3. Browsers latch isolation per‑document at navigation time. There is
   no API to "upgrade" a non‑isolated document to isolated after the
   fact.

So the only recipe that works on GitHub Pages (and any other static
host that doesn't allow custom headers) is:

> Register the SW from a synchronous `<script>` in `<head>`, then on
> the FIRST navigation (when isolation isn't yet active) call
> `location.reload()` exactly once. The reload re‑fetches the
> navigation; this time the SW is in scope, intercepts the request,
> and decorates the response with COOP/COEP. The reloaded document
> commits with isolation enabled.

This is sometimes called the "coi-serviceworker" pattern after
[gzuidhof/coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)
which originated it. Major prior art:

* [StackBlitz/WebContainers](https://webcontainers.io/) — same pattern
  for `webcontainer-api` deployments.
* [Observable](https://observablehq.com/) — used internally for
  WASM‑threaded data viz on Pages-style static hosting.
* [jsfiddle](https://jsfiddle.net/) — uses it for WASM playgrounds.

## Why issue #3 documented this but didn't fix it

The fix was in PR #4's documented plan:

> Commit 3 — `crossOriginIsolated` on first paint (root cause #3, P1)
>
> Add `web/coi-serviceworker.js` (vendored from gzuidhof/coi-serviceworker,
> MIT-licensed) and load it before any other script in `index.html`. On a
> cold load it self-registers and reloads the page once. On warm loads it
> is a no-op.

But `git log --oneline web/coi-serviceworker.js` shows the file was
never added; PR #4 only landed the *header‑synthesis half* in
`web/sw.js`. The plan's Commit 3 was dropped from PR #4 (likely
because PR #4 already had two unrelated fixes and the boot still
appeared to "work" on the dev server, where the page is served from
`http://localhost:1337` — a context which **already** is
cross‑origin‑isolated by virtue of being a same‑origin navigation
without third‑party iframes).

The bug only manifests under GitHub Pages because Pages serves the
top‑level document from `link-foundation.github.io` (a domain shared
with other Pages deployments) and Chrome treats those neighbours as
cross‑origin when computing the isolation context. That's why the dev
server passed and the deploy didn't.

## The fix shipped in PR #8

`web/glue/coi-bootstrap.js` (≈90 LOC, classic `<script>`, no deps).

Behaviour decision tree:

```
load index.html
  ├─ ?coi=0 in URL?           → return (opt-out)
  ├─ crossOriginIsolated?     → return (warm load)
  ├─ no serviceWorker API?    → console.warn + return (private mode)
  ├─ session marker set?      → console.warn + return (avoid reload loop)
  ├─ already controlled?      → set marker, location.reload() (controller stale)
  └─ register SW
        ├─ on controllerchange → if !isolated: set marker, reload
        ├─ after 1500ms        → if controller && !isolated: set marker, reload
        └─ on statechange→activated → if !isolated: set marker, reload
```

The marker is a `sessionStorage` key, `'rust-web-box.coi.reloaded'`,
that is cleared as soon as the page observes
`window.crossOriginIsolated === true`. This means:

* A *successful* reload (isolation latches on the second navigation)
  clears the marker, so a future cold load on the same tab can reload
  again if needed (e.g. SW evicted).
* A *failing* reload (browser refuses to intercept the navigation,
  e.g. user disabled SWs in `chrome://settings`) leaves the marker
  set, so the second attempt sees it and bails with a structured
  `console.warn` instead of looping forever.

## Trade‑offs and edge cases

* **Cost on cold load**: one extra navigation. The SW is already
  cached after the first load, so the reload happens in <500 ms in
  practice. Subsequent visits in the same session see no reload.
* **Tabs and incognito**: `sessionStorage` is per‑tab, so a user
  opening five tabs each gets one reload. That is the correct
  behaviour — every fresh tab needs its own isolation latch.
* **Browsers without SW**: warning logged, page boots without
  isolation, CheerpX surfaces the same DataCloneError. We can't do
  better; the failure mode is the existing one and is now diagnosable.
* **Browsers that block SW navigation interception** (some enterprise
  configs): the reload happens once, isolation still doesn't latch,
  the second pass sees the marker and bails. The user gets a
  structured `console.warn` pointing at this analysis file. No reload
  loop.
* **`?coi=0` opt‑out**: diagnostic escape hatch. Useful if a future
  browser quirk causes a reload‑loop on a specific user agent — they
  can append `?coi=0` to confirm the issue is COI‑related and continue
  using the workbench in non‑threaded (degraded) mode.

## Why we don't vendor `coi-serviceworker` literally

We already ship `web/sw.js` with our own caching strategy, our own
`CACHE_VERSION` bump on bundle changes, and our own routing for
non‑basic responses. Adding a *second* SW would require coordinating
two scopes and two registration lifecycles — a fragile setup. The
header‑synthesis half of `coi-serviceworker` is already in
`web/sw.js:62–73`; the bootstrap half is now in
`web/glue/coi-bootstrap.js`. Both halves carry MIT‑attributed
references in their leading comments (see the file headers), satisfying
the upstream license.

## Verification

1. Unit test (`web/tests/coi-bootstrap.test.mjs`):

   ```js
   import { test } from 'node:test';
   import assert from 'node:assert/strict';
   import { readFile } from 'node:fs/promises';
   import { fileURLToPath } from 'node:url';

   const root = fileURLToPath(new URL('../', import.meta.url));

   test('coi-bootstrap.js is the first <script> in <head> of index.html', async () => {
     const html = await readFile(`${root}index.html`, 'utf8');
     const m = html.match(/<head>[\s\S]*?<\/head>/);
     assert.ok(m, '<head> block exists');
     const head = m[0];
     // First <script> in head should be coi-bootstrap.
     const firstScript = head.match(/<script\b[^>]*>/);
     assert.ok(firstScript, 'at least one script in head');
     assert.match(firstScript[0], /coi-bootstrap\.js/);
   });
   ```

2. Manual e2e (Playwright, captured to
   `evidence/console-first-load.txt`):

   ```bash
   # before the fix:
   $ playwright … "console.log(crossOriginIsolated)"  # → false
   $ playwright … "console.log(__rustWebBox.dump())"  # crossOriginIsolated:false
   # the page emits DataCloneError, terminal stuck on "Booting Linux VM…"

   # after the fix:
   $ playwright … "console.log(crossOriginIsolated)"  # → true (after one reload)
   $ playwright … "console.log(__rustWebBox.dump())"  # crossOriginIsolated:true
   # CheerpX boots; terminal lands at the Alpine login prompt within ~30 s.
   ```

3. Regression test for the **header** half is already covered in
   `web/tests/pages-parity.test.mjs`. The bootstrap half adds the
   missing coverage for the **registration ordering** half.
