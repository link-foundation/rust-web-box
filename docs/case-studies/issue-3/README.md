# Case Study: Issue #3 — Empty Workbench on GitHub Pages

> **Issue**: [link-foundation/rust-web-box#3](https://github.com/link-foundation/rust-web-box/issues/3) — *"Fix all bugs, and improve quality of our project"*
> **Pull request**: [#4](https://github.com/link-foundation/rust-web-box/pull/4)
> **Branch**: `issue-3-eb4b77897b15`
> **Reporter**: @konard
> **Filed**: 2026‑04‑29
> **Severity**: P0 — production deployment is unusable

## TL;DR

The site at <https://link-foundation.github.io/rust-web-box/> renders an empty
VS Code Web workbench: no terminal, no files in the Explorer, no boot
indicator, no Cargo.toml. The user reasonably asks "how were the screenshots
in PR #2 obtained?" — they were obtained against a *root‑pathed* dev server,
which masks **three independent bugs** that only surface under GitHub Pages'
sub‑path deployment (`/rust-web-box/`):

1. **`additionalBuiltinExtensions` use absolute paths without the deploy
   base** → both built‑in extensions 404 → workbench has no
   FileSystemProvider for `webvm:` and no terminal profile → empty UI
   (root cause #1).
2. **CheerpX downloads the warm disk via XHR**, but the GitHub Releases asset
   has no `Access-Control-Allow-Origin`, and `mode: 'no-cors'` only helps
   `fetch()` (which we use to *probe*, not to *download*) → warm disk fails →
   silent fallback to the public Debian image (root cause #2).
3. **GitHub Pages doesn't emit COOP/COEP** so the top‑level document is not
   `crossOriginIsolated` → `SharedArrayBuffer` is unavailable → CheerpX
   threading is broken on first load. The Service Worker fixes this *for
   subresources* but cannot retroactively fix the top‑level navigation
   (root cause #3).

The first cause alone explains every visible symptom in the screenshot. The
others are latent and would surface as soon as the first is fixed.

## Folder layout

| File                                        | What it is                                                            |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `README.md`                                 | This document — timeline, requirements, root causes, plan.            |
| `analysis-extension-base-path.md`           | Deep dive into root cause #1 (the 404s).                              |
| `analysis-disk-cors.md`                     | Deep dive into root cause #2 (XHR + CORS).                            |
| `analysis-coop-coep.md`                     | Deep dive into root cause #3 (top‑level isolation).                   |
| `online-research.md`                        | Citations: VS Code Web docs, CheerpX/WebVM docs, Pages limitations.   |
| `evidence/console-first-load.log`           | Browser console log captured against the live site (Playwright).      |
| `evidence/dom-snapshot-first-load.yml`      | DOM snapshot at t=0 (immediately after navigate).                     |
| `evidence/dom-snapshot-12s.yml`             | DOM snapshot at t≈12 s — workbench still empty.                       |
| `screenshots/issue-3-original.png`          | Reporter's screenshot from the issue.                                 |
| `screenshots/repro-first-load.png`          | Our independent reproduction.                                         |

## Timeline of events

| When                   | What                                                                                                 | Reference                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 2026‑04‑27 16:50 UTC   | PR #1 lands `feat(web): vscode.dev-style shell with auto-opening WebVM bash terminal`. CI green.     | `b9ce1ed`                              |
| 2026‑04‑28             | PR #1 squash‑merged. PR #2 follow‑up adds IDB workspace + auto‑opened `hello_world.rs`. Screenshots in the PR show populated Explorer + terminal. | `bd08545`, `a49e7c0` |
| 2026‑04‑29 ~16:00 UTC  | Pages deployment publishes the squashed bundle. User opens the live URL.                             | `pages.yml`                            |
| 2026‑04‑29 16:03 UTC   | @konard files issue #3 with screenshot showing **empty workbench**.                                  | issue body                             |
| 2026‑04‑29 16:46 UTC   | Solver reproduces with Playwright. Console shows 26+ 404s for `/extensions/webvm-host/package.json`. | `evidence/console-first-load.log:5–9`  |
| 2026‑04‑29 16:46 UTC   | DOM at t=12 s shows `Welcome` + Explorer with `webvm` folder marked "An error occurred while loading the workspace folder contents." | `evidence/dom-snapshot-12s.yml:23–48` |

### Why the regression escaped CI

The boot‑shell smoke test in `web/tests/boot-shell.test.mjs` only asserts
**file presence and content**. It greps the rendered `index.html` for the
strings `extensions/webvm-host` and `extensions/rust-analyzer-web`, which
are present — but it never *executes* the substitution against a sub‑path
URL. Tests would have caught this if the URL had been resolved against a
representative `location.href`.

The Playwright smoke test (`web/tests/playwright-smoke.mjs`) runs against
a static server rooted at `/`, which makes `/extensions/...` resolve
correctly by accident. **No test exercised the deployment topology.** PR #2
was developed and reviewed in this same root‑pathed environment, so the
screenshots were genuine — they just don't reflect what users see on
GitHub Pages.

## Requirements (verbatim from the issue, enumerated)

| #   | Requirement                                                                                                                                       | Where addressed                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| R1  | The workbench must not open empty: terminal shown by default, files visible.                                                                      | Fix #1 + #2 + #3, plus tests R8/R9         |
| R2  | The terminal must show loading status / VM health while CheerpX is booting; everything time‑consuming must surface there.                         | `webvm-host/extension.js` PTY pre‑boot lines + `vm.boot` events |
| R3  | `hello_world.rs` opens as soon as possible.                                                                                                       | Already wired in `extension.js`; gated on R1 fix |
| R4  | Add a `Cargo.toml` to make it easy for users to install packages quickly.                                                                         | Already seeded as `/workspace/hello/Cargo.toml`; verify in tests |
| R5  | Add as many automated tests as possible to verify everything works.                                                                               | New `analysis-*.md`-driven test cases      |
| R6  | Find the root cause(s) why GitHub Pages didn't work.                                                                                              | `analysis-extension-base-path.md`, `analysis-disk-cors.md`, `analysis-coop-coep.md` |
| R7  | Test installation of a popular cargo package.                                                                                                     | New `examples/cargo-install-ripgrep.md` + boot test for warm crate cache |
| R8  | Compile all data to `./docs/case-studies/issue-3/`.                                                                                               | This folder.                               |
| R9  | Reconstruct timeline, list requirements, root causes, propose solutions; check known libraries/components.                                        | This README + `online-research.md`.        |
| R10 | If data insufficient, add debug output / verbose mode for next iteration.                                                                         | `?debug=1` query param + `__rustWebBox.dump()` |
| R11 | If the issue is related to other repos, file reproducible bug reports there.                                                                      | See "Upstream reports" section below.      |

## Root causes (ranked by blast radius)

### Root cause #1 — `additionalBuiltinExtensions` lose the deployment base path

**Severity**: P0. **Blast radius**: every Pages user (100 % of production
traffic). **Detection**: 26+ console 404s within 2 s of load.

The workbench config in `web/index.html:23` and the runtime patch in
`web/glue/boot.js:55–75` populate the extension URI with three components
and rely on VS Code Web to assemble them:

```js
{ scheme: '{ORIGIN_SCHEME}', authority: '{ORIGIN_HOST}', path: '/extensions/webvm-host' }
```

At runtime we substitute `scheme`/`authority` from `location.protocol` /
`location.host`, but **we never prepend the directory in which the page
itself lives**. On Pages the page is at
`https://link-foundation.github.io/rust-web-box/`, but the resulting URL
becomes `https://link-foundation.github.io/extensions/webvm-host/package.json`
— missing the `/rust-web-box/` segment. GitHub Pages 404s.

VS Code's `additionalBuiltinExtensions` accepts a `UriComponents` whose
`path` is **the absolute path on the host**, not a path relative to the
page (see [`vscode/src/vs/workbench/services/extensionManagement/browser/`](https://github.com/microsoft/vscode/tree/main/src/vs/workbench/services/extensionManagement/browser/extensionsScannerService.ts)).
So the placeholder must include the deploy base.

**Fix**: derive `BASE` from `new URL('./', location.href).pathname` (e.g.
`/rust-web-box/`) and prefix `e.path` with it:

```js
const base = new URL('./', location.href).pathname.replace(/\/$/, '');
for (const e of cfg.additionalBuiltinExtensions) {
  if (typeof e.path === 'string' && e.path.startsWith('/extensions/')) {
    e.path = base + e.path; // → '/rust-web-box/extensions/webvm-host'
  }
}
```

The same patch must run in **both** the inline bootstrap in
`index.html` (because `workbench.js` reads `window.product` *before*
`boot.js` finishes loading) and in `boot.js` (defensive, in case the
inline copy is missing).

See `analysis-extension-base-path.md`.

### Root cause #2 — Warm Alpine+Rust disk fails under CORS

**Severity**: P1. **Blast radius**: every user (we silently fall back to the
upstream Debian image, but that defeats the purpose of pre‑baking Rust into
the image and breaks `cargo run` offline).

`web/glue/cheerpx-bridge.js:78–103` uses `fetch(url, { mode: 'no-cors' })` to
*probe* the URL. That works — `no-cors` returns an opaque success. But the
actual download is performed inside CheerpX via `CloudDevice.create()`,
which uses **XMLHttpRequest** under the hood. XHR has no `no-cors` mode and
**always** triggers a CORS preflight against the response. The release asset
at `objects.githubusercontent.com` has no `Access-Control-Allow-Origin`
header, so the request fails:

```
Access to XMLHttpRequest at
'https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2'
from origin 'https://link-foundation.github.io' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```
(*evidence/console-first-load.log:2588 ms*)

**Fix options** (in increasing reliability):

1. Re‑host the disk image on a CORS‑enabled origin: a Cloudflare R2 bucket
   with `Access-Control-Allow-Origin: *`, or a Cloudflare Worker that
   proxies the GitHub Releases redirect with CORS injected.
2. Mirror the disk image into the **same origin** (Pages itself) under a
   path‑hashed name like `/rust-web-box/disk/rust-alpine-<sha>.ext2`. Pages
   serves with `access-control-allow-origin: *` already (we verified this
   with `curl -sI`) and our SW will add CORP. The downside: each disk
   image is ~120 MB and Pages has a 1 GB site cap and per‑file limits.
3. Drop the warm disk for now and use the upstream Debian image, but make
   the fallback explicit ("Rust toolchain must `apk/apt install` on first
   run") so users aren't surprised by missing tooling.

**Selected**: (1) — proxy through a tiny Pages‑hosted JS that uses the
existing `network-shim` proxy fallback chain, *or* simply teach the
warm‑disk URL probe to detect the absence of CORS headers and skip
gracefully (since the Debian fallback already works). The latter is a
one‑line change and ships *now*; the former can land in a follow‑up.

See `analysis-disk-cors.md`.

### Root cause #3 — Top‑level document is not `crossOriginIsolated` on GitHub Pages

**Severity**: P1. **Blast radius**: CheerpX threading is unavailable until
the second navigation (when the SW can intercept).

GitHub Pages does not allow custom response headers, and our Service
Worker injects `Cross-Origin-Opener-Policy: same-origin` /
`Cross-Origin-Embedder-Policy: credentialless` for **subresource** fetches.
But the **top‑level navigation** is fetched from the network *before* the
SW is registered, so the document itself never gets COOP/COEP. Without
those, `self.crossOriginIsolated === false` and `SharedArrayBuffer` is
`undefined`. CheerpX detects this and falls back to single‑threaded mode
(slow, sometimes hangs).

**Fix**: ship the well‑known [coi‑serviceworker](https://github.com/gzuidhof/coi-serviceworker)
pattern (a 5 KB SW that, on first load, force‑reloads the page so the SW
can intercept the navigation request and synthesize the headers). This is
the documented workaround for COOP/COEP on GitHub Pages and is what
[stackblitz/webcontainers](https://webcontainers.io/) and many
[wasm‑threading apps](https://web.dev/cross-origin-isolation-guide/)
on Pages use.

See `analysis-coop-coep.md`.

## Solution plan

The fix lands in **three commits** ordered to be independently revertable:

### Commit 1 — Extension base path (root cause #1, P0)

* Patch `web/index.html` inline bootstrap: derive `BASE` from
  `location.pathname`, prefix `e.path`.
* Patch `web/glue/boot.js` `patchWorkbenchConfig()` likewise.
* Patch `web/build/build-workbench.mjs` to emit a `{BASE_PATH}` placeholder
  so the same artifact works on `/rust-web-box/` and on `/`.
* Add `web/tests/extension-paths.test.mjs` that simulates the substitution
  against three URLs (`/`, `/rust-web-box/`, `/rust-web-box/sub/`) and
  asserts the resolved extension URLs are correct.

### Commit 2 — Disk fetch + CORS robustness (root cause #2, P1)

* In `cheerpx-bridge.js`, replace `mode: 'no-cors'` probe with a HEAD that
  inspects `Access-Control-Allow-Origin`. If absent, log a structured
  warning and fall back to the same‑origin manifest mirror.
* Add a `web/disk/manifest.json` field `corsHostedUrl` and prefer it when
  present.
* Add `web/tests/disk-cors.test.mjs` that asserts the probe correctly
  classifies CORS‑less responses as unusable.

### Commit 3 — `crossOriginIsolated` on first paint (root cause #3, P1)

* Add `web/coi-serviceworker.js` (vendored from gzuidhof/coi-serviceworker,
  MIT‑licensed) and load it before any other script in `index.html`. On a
  cold load it self‑registers and reloads the page once. On warm loads it
  is a no‑op.
* Update `web/sw.js` so its scope and the COI SW don't conflict (different
  filenames, both under `/rust-web-box/`).
* Add `web/tests/coop-coep.test.mjs` that verifies the COI SW is loaded
  ahead of the workbench scripts in the rendered HTML.

### Commit 4 — Verbose/debug mode (R10)

* Add a `?debug=1` query string handler that logs every bus method call,
  every fs operation, and dumps `__rustWebBox` to a downloadable JSON.
* Make the `boot-toast` show progress phases (not just errors) when
  `?debug=1`.
* Add `web/tests/debug-mode.test.mjs`.

### Commit 5 — Cargo install smoke (R7)

* Add `examples/cargo-install-ripgrep.md` documenting the manual flow
  (`cargo install ripgrep`) and the expected output.
* Add a Playwright test that boots the page, types `cargo --version` into
  the terminal, and asserts a non‑zero‑length response within 60 s. This
  is a sanity check that *any* Cargo command works at all; full
  `cargo install` is too slow for CI but the case study documents how to
  run it manually.

### Commit 6 — Case study + PR description (R8/R9)

* This folder.
* PR #4 description rewritten to enumerate fixes, link the case study,
  and embed before/after screenshots.

## Upstream reports (R11)

| Project                        | Issue / PR to file                                                                                              | Why                                                                                       |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `microsoft/vscode-web` (npm)   | Documentation request: clarify in the README that `additionalBuiltinExtensions` `path` is **host‑absolute**.    | Two-line note would have prevented this bug. Many sub‑path deployers will hit this.       |
| `leaningtech/cheerpx`          | Feature request: surface the underlying XHR error (status code, response headers) when `CloudDevice.create` fails — currently we only see `null` from the engine. | Improves diagnostics for everyone hosting cross‑origin disks.       |
| `actions/deploy-pages`         | Feature request: optional `headers:` input that emits a `_headers` file (or wires Cloudflare‑style overrides) so deploys can opt into COOP/COEP without a SW workaround. | This is the canonical fix; the SW workaround is fragile.        |
| `gzuidhof/coi-serviceworker`   | Just adopting it. No new report needed.                                                                         | —                                                                                         |

Each upstream report will include: minimal repro URL, console transcript
extracted from `evidence/console-first-load.log`, and a link to this
case study.

## References

External docs and prior art that informed this analysis are catalogued in
[`online-research.md`](./online-research.md). Key links:

* VS Code Web docs — [extension hosting](https://code.visualstudio.com/api/extension-guides/web-extensions)
* CheerpX docs — [browser deployment](https://cheerpx.io/docs)
* Cross‑Origin‑Isolation guide — [web.dev](https://web.dev/cross-origin-isolation-guide/)
* `coi-serviceworker` — [gzuidhof/coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)
* WebContainers headers requirement — [webcontainers.io/guides/configuring-headers](https://webcontainers.io/guides/configuring-headers)
* GitHub Pages limits — [github.com/orgs/community/discussions](https://github.com/orgs/community/discussions/categories/pages)
