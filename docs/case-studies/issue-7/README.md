# Case Study: Issue #7 — Continue fixing https://link-foundation.github.io/rust-web-box/

> **Issue**: [link-foundation/rust-web-box#7](https://github.com/link-foundation/rust-web-box/issues/7) — *"Continue fixing https://link-foundation.github.io/rust-web-box/"*
> **Pull request**: [#8](https://github.com/link-foundation/rust-web-box/pull/8)
> **Branch**: `issue-7-b40d03428c23`
> **Reporter**: @konard
> **Filed**: 2026‑04‑29
> **Severity**: P0 — production deployment cannot boot the Linux VM

## TL;DR

After the issue‑#3 and issue‑#5 fixes landed, the VS Code Web workbench
mounts on GitHub Pages and the file Explorer populates with
`hello_world.rs` and `Cargo.toml`. **However the Linux VM never
finishes booting**: the terminal stays on `Booting Linux VM…` forever.
The console reveals one terminal error and one warning:

```
[ERROR] Access to fetch at 'https://github.com/.../rust-alpine.ext2'
        from origin 'https://link-foundation.github.io' has been blocked
        by CORS policy: No 'Access-Control-Allow-Origin' header is
        present on the requested resource.
[ERROR] CheerpX initialization failed: DataCloneError:
        Failed to execute 'postMessage' on 'DedicatedWorkerGlobalScope':
        SharedArrayBuffer transfer requires self.crossOriginIsolated.
```
(*evidence/console-first-load.txt:21,29*)

The CORS warning is benign — `cheerpx-bridge.js` already classifies it as
`cors-or-network` and falls back to the default Debian disk (the
issue‑#3 fix). The real boot blocker is the **second** error:
`crossOriginIsolated === false`, so CheerpX cannot transfer the
`SharedArrayBuffer` it allocates to its worker, and the engine throws.

The earlier case study ([`issue-3/analysis-coop-coep.md`](../issue-3/analysis-coop-coep.md))
identified this exact root cause and named the
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker)
pattern as the fix, but **the bootstrap was never actually shipped** —
PR #4 added the COOP/COEP synthesis to `web/sw.js` but did not add the
register‑then‑reload bootstrap to `web/index.html`. So the SW intercepts
**subresource** fetches (and adds COOP/COEP correctly there), but it
cannot retroactively add headers to the **top‑level navigation** that
loaded the document, and the page latches into the non‑isolated state
for its lifetime.

This PR (#8) ships the missing piece: a tiny classic `<script>` at the
top of `<head>` that registers the SW, then reloads exactly once when
isolation is not yet active.

## Folder layout

| File                                        | What it is                                                            |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `README.md`                                 | This document — timeline, requirements, root causes, plan.            |
| `analysis-coop-coep-bootstrap.md`           | Deep dive into root cause #1 (top‑level isolation never latches).     |
| `analysis-vscode-noise.md`                  | Deep dive into the surrounding non‑blocking warnings (sandbox, ENOPRO, search provider). |
| `online-research.md`                        | Citations for the bootstrap pattern, Pages limits, Browser quirks.    |
| `evidence/console-first-load.txt`           | Browser console log captured against the live site (Playwright).      |
| `evidence/network-requests.txt`             | Network requests captured against the live site.                      |
| `screenshots/repro-first-load.png`          | Independent reproduction (terminal stuck on "Booting Linux VM…").     |

## Timeline of events

| When                   | What                                                                                                           | Reference                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 2026‑04‑27             | PR #1 `feat(web): vscode.dev-style shell with auto-opening WebVM bash terminal` lands.                         | `b9ce1ed`                                  |
| 2026‑04‑28             | PR #2 follow‑up adds IDB workspace + auto‑opened `hello_world.rs`.                                             | `bd08545`                                  |
| 2026‑04‑29             | Issue #3 reports empty workbench on Pages. PR #4 fixes extension base path, disk CORS probe, debug mode.       | `analysis-extension-base-path.md`          |
| 2026‑04‑29             | Issue #5 reports CheerpX boot loop + rust-analyzer 404. PR #6 fixes WASM vendoring + workspace seeding.        | `docs/case-studies/issue-5/`               |
| 2026‑04‑29 ~17:30 UTC  | Pages redeploys with PR #4 + PR #6. Workbench now mounts and Explorer populates.                               | `evidence/console-first-load.txt:3–9`      |
| 2026‑04‑29 ~17:35 UTC  | @konard files issue #7: terminal stuck on "Booting Linux VM…", console shows two error messages.               | issue body                                 |
| 2026‑04‑29 ~17:50 UTC  | Solver reproduces with Playwright. `__rustWebBox.dump()` returns `crossOriginIsolated: false`.                 | `evidence/console-first-load.txt:29`       |

### Why the regression escaped CI

`web/tests/boot-shell.test.mjs` and `web/tests/pages-parity.test.mjs`
verify that `web/sw.js` synthesizes COOP/COEP correctly when its
`fetch` listener is invoked. They do **not** assert that any code
**triggers** the SW registration before the workbench scripts run, nor
that a reload happens when `crossOriginIsolated` is false on first
load. The bootstrap step described in
[`docs/case-studies/issue-3/analysis-coop-coep.md`](../issue-3/analysis-coop-coep.md)
("Solution plan / Commit 3") was documented but never landed — the
analysis says *"Add `web/coi-serviceworker.js`"* and *"`web/tests/coop-coep.test.mjs`"*,
neither file exists in the tree.

A test that walks the rendered `index.html` and asserts that a script
tag named `coi-bootstrap` (or similar) appears **before** the workbench
AMD loader would have caught this immediately. We add that test in
this PR.

## Requirements (verbatim from the issue, enumerated)

| #   | Requirement                                                                                                                                                | Where addressed                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| R1  | Fix all bugs visible in the Chrome and Safari console transcripts attached to the issue.                                                                   | Fix #1 (this PR), `analysis-vscode-noise.md` for non‑blockers. |
| R2  | Cover everything with end‑to‑end tests using Playwright/Puppeteer (or `link-foundation/browser-commander`).                                                | New `web/tests/coi-bootstrap.test.mjs` + manual Playwright capture in `evidence/`. |
| R3  | Download all logs/data to `./docs/case-studies/issue-7/`.                                                                                                  | This folder.                               |
| R4  | Reconstruct timeline, list requirements, root causes, propose solutions; check known libraries/components.                                                 | This README + `analysis-*.md` + `online-research.md`. |
| R5  | If the data isn't enough, add debug output / verbose mode for the next iteration.                                                                          | `?debug=1` is already wired (issue #3 fix); this PR additionally adds a `[coi]` namespace warning when isolation can't be enabled after the one‑shot reload. |
| R6  | If the issue is related to other repos, file reproducible bug reports there.                                                                               | None required — the root cause is a documented GitHub Pages limitation, fixed via the well‑known `coi-serviceworker` pattern. See "Upstream reports" below. |
| R7  | Plan and execute everything in a single PR.                                                                                                                | PR #8.                                     |
| R8  | Push only to branch `issue-7-b40d03428c23`.                                                                                                                | Branch protection respected.               |
| R9  | Update the existing draft PR #8 instead of creating a new one.                                                                                             | `gh pr edit 8`.                            |

## Root causes (ranked by blast radius)

### Root cause #1 — Top‑level navigation never gets COOP/COEP, so `crossOriginIsolated` stays `false`

**Severity**: P0. **Blast radius**: every Pages user, every fresh
navigation. **Detection**: one console error
(`DataCloneError: ... SharedArrayBuffer transfer requires self.crossOriginIsolated`)
emitted from CheerpX's worker `postMessage`.

The SW in `web/sw.js` already synthesizes
`Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: credentialless` for every same‑origin
subresource (`web/sw.js:62–73`). What it cannot do is synthesize
those headers for the **document itself**, because the document is
fetched **before** the SW is even registered. Chrome (and other
browsers) latch isolation on the first navigation; subsequent fetches
that pick up COOP/COEP do not retroactively isolate the page.

The standard escape hatch is to register the SW from a synchronous
`<script>` in `<head>`, then call `location.reload()` exactly once if
`window.crossOriginIsolated` is still `false` after the SW takes
control. The reload re‑fetches the navigation, which the now‑active SW
intercepts and decorates with COOP/COEP — and the new document loads
with isolation enabled. This is the same pattern shipped by
[`coi-serviceworker`](https://github.com/gzuidhof/coi-serviceworker),
[StackBlitz/WebContainers](https://webcontainers.io/),
[Observable](https://observablehq.com/), and
[jsfiddle](https://jsfiddle.net/).

**Fix**: ship `web/glue/coi-bootstrap.js` (≈90 lines, dependency‑free,
inline as a classic `<script>` at the top of `<head>`). It

1. Returns immediately if `window.crossOriginIsolated` is already
   `true` (warm load).
2. Returns immediately on the `?coi=0` opt‑out (diagnostics).
3. Warns and returns if `serviceWorker` is unavailable (private mode,
   `file://`).
4. Registers `./sw.js` with scope `./` (so the same script works at
   `/rust-web-box/` and at `/`).
5. On `controllerchange` (or after a 1500 ms poll), reloads once if
   isolation is still off. Uses `sessionStorage` to guarantee at most
   one reload per fresh navigation.

See `analysis-coop-coep-bootstrap.md` for the full mechanism.

### Non‑blocking noise (analysis-vscode-noise.md)

The console also shows a handful of non‑blocking warnings:

* `Ignoring the error while validating workspace folder webvm:/workspace - ENOPRO`
  — emitted before the webvm‑host extension activates and registers
  the FileSystemProvider. The extension activates ~100 ms later and
  the workspace populates correctly. Harmless; documented in the
  analysis but not fixed (it would require shipping VS Code Web
  bootstrap upstream).
* `An iframe which has both allow-scripts and allow-same-origin for
  its sandbox attribute can escape its sandboxing` — emitted by VS
  Code Web's web worker extension host. This is a Chrome warning
  about VS Code Web's own iframe; we cannot affect the upstream
  bundle's sandbox attributes.
* `No search provider registered for scheme: webvm, waiting` — the
  Search view is not a primary feature; the message is informational
  and disappears once a search provider registers (none does in our
  build). Could be silenced by registering a no‑op provider; we
  documented the trade‑off but did not implement it in this PR (low
  user impact, increased extension surface).

See `analysis-vscode-noise.md`.

## Solution plan

The fix lands in **two commits** ordered to be independently revertable:

### Commit 1 — Cross‑origin isolation bootstrap (root cause #1, P0)

* Add `web/glue/coi-bootstrap.js` — the classic `<script>` shim that
  registers the SW and forces one‑shot reload when isolation is off.
* Wire it as the **first** `<script>` in `<head>` of both
  `web/index.html` (the live shipped file) and
  `web/build/index.template.html` (so future rebuilds preserve it).
* Remove the now‑redundant `navigator.serviceWorker.register('./sw.js')`
  call from `web/glue/boot.js` so SW registration has exactly one
  owner. Replace the deleted lines with a comment pointer.
* Add `web/tests/coi-bootstrap.test.mjs`:
  * Asserts the script tag exists, points at `./glue/coi-bootstrap.js`,
    and is the first executable script in `<head>` of both
    `index.html` and `index.template.html`.
  * Loads `coi-bootstrap.js` as text, simulates the various states
    (`crossOriginIsolated=true`, `?coi=0`, no SW, fresh load with no
    controller, fresh load with controller, already‑reloaded marker),
    and asserts that `reload()` is called or skipped per spec.

### Commit 2 — Case study + PR description (R3/R4)

* This folder.
* PR #8 description rewritten to enumerate the fix, link the case
  study, embed before/after console transcripts, and reference the
  evidence files.

## Upstream reports (R6)

| Project                        | Status                                                                                                               |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `gzuidhof/coi-serviceworker`   | No new report — we vendor the *pattern*, not the code, because we already own a SW and need a single one for cache + COOP/COEP synthesis. The pattern is MIT, well‑documented, and cited at the top of `coi-bootstrap.js`. |
| `actions/deploy-pages`         | Already noted in [`docs/case-studies/issue-3/README.md`](../issue-3/README.md#upstream-reports-r11) — long‑term, GitHub Pages should support a `_headers` file. Not a new report. |
| `microsoft/vscode-web` (npm)   | The ENOPRO log is a known timing window (extension activation vs. workspace folder probe). Not actionable from our side. |
| `leaningtech/cheerpx`          | The DataCloneError is precisely correct; CheerpX did surface the right error. No upstream change needed. |

## References

External docs and prior art that informed this analysis are catalogued in
[`online-research.md`](./online-research.md). Key links:

* `coi-serviceworker` — [gzuidhof/coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)
* Cross‑Origin‑Isolation guide — [web.dev](https://web.dev/cross-origin-isolation-guide/)
* COEP credentialless — [web.dev/coep-credentialless](https://web.dev/coep-credentialless/)
* GitHub Pages limits — [github.com/orgs/community/discussions](https://github.com/orgs/community/discussions/categories/pages)
* WebContainers headers requirement — [webcontainers.io/guides/configuring-headers](https://webcontainers.io/guides/configuring-headers)
* SharedArrayBuffer requirements — [MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer#security_requirements)
