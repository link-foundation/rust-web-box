# Online Research — issue #7 references

Citations and prior art that informed the analysis. Where a link
includes a stable archive (web.archive.org), prefer that for posterity.

## Cross‑Origin Isolation

* **MDN — `crossOriginIsolated`**:
  <https://developer.mozilla.org/en-US/docs/Web/API/Window/crossOriginIsolated>
  Defines when a Window is cross‑origin isolated and what that
  unlocks (`SharedArrayBuffer`, high‑resolution timers, etc.).

* **MDN — `SharedArrayBuffer` security requirements**:
  <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements>
  Confirms the requirement: secure context + `crossOriginIsolated`,
  and that headers must be present at navigation time.

* **web.dev — Cross‑Origin Isolation guide**:
  <https://web.dev/cross-origin-isolation-guide/>
  The canonical guide. Sets out COOP/COEP rules and gives the
  Service Worker workaround as an explicit option for static hosts
  that can't set headers.

* **web.dev — COEP credentialless**:
  <https://web.dev/coep-credentialless/>
  Why we use `credentialless` instead of `require-corp`: it lets us
  embed cross‑origin resources (like the GitHub Releases disk image
  fetch attempt) without requiring those origins to opt in via
  `Cross-Origin-Resource-Policy`.

## The Service‑Worker workaround

* **`gzuidhof/coi-serviceworker`**:
  <https://github.com/gzuidhof/coi-serviceworker>
  The reference implementation of the register‑then‑reload pattern.
  MIT‑licensed. We adopt the *pattern* (and credit it in
  `coi-bootstrap.js` and the SW comments) but don't vendor the file
  literally because we already own a SW with caching responsibilities.

* **WebContainers — Configuring Headers**:
  <https://webcontainers.io/guides/configuring-headers>
  StackBlitz's docs explicitly recommend the SW workaround when
  deploying on a host that can't set headers (e.g. GitHub Pages).
  Confirms the approach is the industry standard.

* **Chrome Status — `SharedArrayBuffer` cross‑origin isolation**:
  <https://chromestatus.com/feature/5724083864829952>
  Chrome's launch note for the isolation requirement (April 2021).
  Documents the navigation‑time latching that makes our reload
  necessary.

## GitHub Pages limits

* **GitHub Pages community discussion — custom headers**:
  <https://github.com/orgs/community/discussions/categories/pages>
  Multiple threads confirming Pages does not allow custom response
  headers. The closest official answer is "use a Cloudflare Worker
  proxy" or "use the SW workaround".

* **`actions/deploy-pages` — `headers:` proposal**:
  <https://github.com/actions/deploy-pages/issues>
  No accepted proposal at time of writing; multiple feature requests.
  Long‑term, this is the right fix for the COOP/COEP problem.

## Browser‑specific quirks

* **Firefox 113 — COEP=credentialless support**:
  <https://www.mozilla.org/en-US/firefox/113.0/releasenotes/>
  Firefox added `credentialless` support in 113 (May 2023). Older
  Firefox falls back to `require-corp` semantics (we'd need every
  cross‑origin resource to set CORP); since the only cross‑origin
  resource is the GitHub Releases disk (which we already bypass with
  the same‑origin Debian fallback), this is fine.

* **Safari 16.4 — COOP/COEP isolation**:
  <https://webkit.org/blog/13966/release-notes-for-safari-16-4/>
  Safari added cross‑origin isolation support in 16.4 (March 2023).
  Earlier Safari has no `SharedArrayBuffer` even with the right
  headers; our SW reload is a no‑op there (the bootstrap detects
  isolation can never latch and bails after one attempt).

* **Chrome — service worker navigation interception caveats**:
  <https://web.dev/articles/service-worker-lifecycle>
  Confirms that `clients.claim()` makes a freshly activated SW take
  control of existing clients, but **does not** retroactively rewrite
  the response that already loaded the document. That's why the
  reload is necessary even with `clients.claim()` — we have it in our
  SW (`web/sw.js:53`).

## Prior art in similar projects

* **Observable Notebooks** — uses the SW reload pattern for WASM
  threading on Pages‑style hosts.
  <https://observablehq.com/@observablehq/cross-origin-isolation>

* **JS Fiddle** — ditto for `pyodide`/`emscripten` examples that need
  threads.

* **`sqlite-wasm` docs** — explicitly recommend the same workaround:
  <https://sqlite.org/wasm/doc/trunk/persistence.md>

* **WebVM (LeaningTech)** — their public deployment at
  <https://webvm.io/> is on a host that can set headers, so they
  don't need this workaround. But their docs note the requirement.

## Summary

The fix in PR #8 implements the documented standard pattern. There is
no novel research here — the gap was purely an implementation gap from
PR #4's plan (issue #3 case study, "Solution plan / Commit 3") that
was never carried out. We close it now.
