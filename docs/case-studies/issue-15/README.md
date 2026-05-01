# Case Study: Issue #15 - Real End-to-End Tests for Deployed Pages

## Summary

Issue #15 asked for **real end-to-end tests that run against the deployed
GitHub Pages site at https://link-foundation.github.io/rust-web-box**, not
just locally — and pinned them to two regressions discovered while drafting
the issue:

1. The CheerpX 1.2.11 runtime that the project shipped emitted
   `TypeError: Cannot read properties of undefined (reading 'a1')` four
   times during Linux boot, and `cx.run` returned `CheerpException:
   Program exited with code 71` even before Linux was usable. `tree` and
   `cargo run` were therefore observable as broken from the deployed page.
2. The repository had unit tests under `web/tests/`, but no test ever
   actually drove the rendered workbench in a browser, on the dev server
   *or* on the live Pages URL. A regression in vendoring, in COOP/COEP
   serving, or in CheerpX itself could ship to production unobserved.

The fix bumps CheerpX to **1.3.0** (which is the version where the
upstream `'a1'` regression is fixed), threads a real browser through both
locally-built artifacts and the live Pages deployment using
[`browser-commander`](https://github.com/link-foundation/browser-commander),
and adds two new test suites:

- `web/tests/e2e/local-pages-e2e.test.mjs` — runs against the freshly
  built `web/` artifact via `web/build/dev-server.mjs`. Wires up to the
  `local-e2e` job in `.github/workflows/pages.yml` so PRs catch
  regressions before deploy.
- `web/tests/e2e/live-pages-e2e.test.mjs` — runs against the URL that
  GitHub Pages just published. Wires up to the `e2e` job after `deploy`
  so production breakage is loud, not silent.

Both suites share one harness (`web/tests/helpers/cheerpx-page-harness.mjs`)
that wraps `browser-commander`, mirrors COOP/COEP, waits for stage-1
shim and stage-2 Linux, and drives `cx.run('/bin/sh', …)` directly to
verify the three commands the issue calls out: `tree --version`,
`tree /workspace`, and the pre-built `/workspace/target/release/hello`.

## Evidence Collected

All evidence captured for this investigation is stored in this
directory:

| File | Purpose |
|------|---------|
| [`evidence/issue.json`](./evidence/issue.json) | Full GitHub issue payload captured with `gh issue view`. |
| [`evidence/issue-comments.json`](./evidence/issue-comments.json) | Issue comments from the GitHub API (empty at time of capture). |
| [`evidence/pr-16.json`](./evidence/pr-16.json) | Draft PR metadata before finalizing this fix. |
| [`screenshots/01-live-after-12s.png`](./screenshots/01-live-after-12s.png) | Live Pages site after 12s — VS Code shell up, terminal not yet attached. |
| [`screenshots/02-live-after-30s-stuck.png`](./screenshots/02-live-after-30s-stuck.png) | Same site at 30s, before the CheerpX bump — terminal still stuck after the boot phase that was supposed to leave Linux ready. |
| [`playwright-logs/01-console-errors.log`](./playwright-logs/01-console-errors.log) | Console errors from a 30s recording of the live site with Playwright MCP, dominated by the four CheerpX 1.2.11 `'a1'` reads and the `Program exited with code 71` follow-up. |
| [`playwright-logs/01-console-warnings.log`](./playwright-logs/01-console-warnings.log) | Console warnings from the same session (CheerpX boot noise, COEP probes, etc.). |
| [`playwright-logs/01-network-cheerpx.txt`](./playwright-logs/01-network-cheerpx.txt) | Network timeline for `cx.esm.js`, `cxcore*.js`, `cxcore*.wasm`, the warm-disk chunks, and the WSS Debian fallback. |
| [`playwright-logs/01-runtime-state.json`](./playwright-logs/01-runtime-state.json) | Snapshot of `globalThis.__rustWebBox` taken from the live site at the time of capture (`vmPhase: 'starting Linux'`, no `vm.run`). |
| [`playwright-logs/02-console-errors-after-30s.log`](./playwright-logs/02-console-errors-after-30s.log) | Continuation of the error stream — confirms the `'a1'` fault recurs every CheerpX boot attempt rather than being a one-time race. |
| [`playwright-logs/03-cx-130-load-test.json`](./playwright-logs/03-cx-130-load-test.json) | First in-browser sanity check of CheerpX 1.3.0: import succeeds, the documented exports (`Linux`, `GitHubDevice`, `DataDevice`, `CloudDevice`, `OverlayDevice`, etc.) are all present. |
| [`playwright-logs/04-cx-130-run-test.json`](./playwright-logs/04-cx-130-run-test.json) | First successful `cx.run`: `sh -c "echo HELLO_FROM_RWB; tree --version 2>&1; uname -a"` returns `status: 0` and the expected output, in 1.2 s after Linux create. This is the direct counter-evidence to the 1.2.11 `'Program exited with code 71'`. |
| [`playwright-logs/06-cx-130-tree-test.json`](./playwright-logs/06-cx-130-tree-test.json) | `tree /workspace` and `ls Cargo.toml` against the warm Alpine disk: both succeed and the Cargo project is present exactly as on Pages. |
| [`playwright-logs/07-cx-130-prebuilt-hello.json`](./playwright-logs/07-cx-130-prebuilt-hello.json) | Final proof: `/workspace/target/release/hello` returns `status: 0` with `"Hello from rust-web-box!"`. |

## Timeline

| Time (UTC) | Event |
|------------|-------|
| 2026-04-30 | Issue #15 opened: terminal showed `Linux.run terminal not implemented` and `tree` / `cargo run` did not work on the deployed page. |
| 2026-04-30 | Live Pages site driven from Playwright MCP. Captured `screenshots/01-live-after-12s.png`, the network timeline, and the runtime snapshot — `vmPhase: 'starting Linux'` with `vm` set, never advancing to `ready`. |
| 2026-04-30 | Console error stream classified: `Cannot read properties of undefined (reading 'a1')` (×4) followed by `CheerpException: Program exited with code 71`. The first error came from `cxcore-mlx-9020-prefetch-flush.js` inside CheerpX 1.2.11. |
| 2026-04-30 | Imported CheerpX 1.3.0 from the CDN inside the same browser tab (no source changes). `Linux.create` returned cleanly; `cx.run sh -c …` returned `status: 0`. Captured in `playwright-logs/03..07`. |
| 2026-04-30 | `web/build/build-workbench.mjs` re-vendored CheerpX 1.3.0; `web/glue/cheerpx-bridge.js` and `web/sw.js` updated to point at it. All 150 unit tests still passed. |
| 2026-05-01 | `web/tests/helpers/cheerpx-page-harness.mjs`, `web/tests/e2e/local-pages-e2e.test.mjs`, `web/tests/e2e/live-pages-e2e.test.mjs` added. Local-only debug subprocess (`experiments/e2e-debug-bootstrap.mjs`) verified the harness wires up COOP/COEP, base-prefix, and the stage-1 shim. |
| 2026-05-01 | `web/build/dev-server.mjs` learned to redirect `/rust-web-box` (no trailing slash) to `/rust-web-box/`, mirroring how GitHub Pages canonicalises sub-path URLs. Without this, the dev server returned 200 for the bare prefix and the browser then resolved `glue/boot.js` to `/glue/boot.js`. |
| 2026-05-01 | `.github/workflows/pages.yml` extended with `local-e2e` (PRs + main) and `e2e` (post-deploy) jobs. The `build` job now stages the warm disk on PRs too, with `STAGE_WARM_DISK_REQUIRED=0` so a missing release asset on a fresh fork is a soft skip. |
| 2026-05-01 | Local e2e suite passes in soft-skip mode without the warm disk; in `RUST_WEB_BOX_E2E=1` mode it produces an actionable error pointing to `web/build/stage-pages-disk.mjs`. |
| 2026-05-01 | First CI run with the warm disk staged: `Local e2e (built artifact)` failed with `page.waitForFunction: Timeout 180000ms exceeded` after 213 s (run 25205846856). Logs surfaced only the timeout — no diagnostics. |
| 2026-05-01 | Diagnosed: `globalThis.__rustWebBox.vmPhase` was wired to `cheerpx-bridge.bootLinux`'s `onProgress` only, which stops at `'starting Linux'`. The terminal `'ready'` phase originates inside `web/glue/webvm-server.js` and was emitted on the BroadcastChannel but never propagated to the page-level shim. The harness keys `vmPhase === 'ready'` on that shim, so the wait could never complete. Threaded an `onPhase` callback through `startWebVMServer` and routed both stages through a single `setPhase` helper in `boot.js`. Added regression test in `web/tests/webvm-server.test.mjs` and rich timeout-context capture (snapshot + console + network) in the harness so future stalls surface their cause directly in CI logs. |

## Requirements From The Issue

1. Real end-to-end tests must run **after** GitHub Pages publishes
   (`https://link-foundation.github.io/rust-web-box`), not only against
   a local copy.
2. Local end-to-end tests must exist too, so PRs catch regressions
   before deploy.
3. Use the [`browser-commander`](https://github.com/link-foundation/browser-commander)
   library to drive the browser; report missing capabilities upstream.
4. Verify that the WebVM terminal supports `cargo run` and `tree`
   (these were broken from the deployed page when the issue was filed).
5. Compile the investigation, evidence, and decisions into
   `docs/case-studies/issue-15`.
6. Where the root cause is upstream, file an issue at the responsible
   project with a reproducible example.
7. Use Playwright MCP for manual inspection, then encode every finding
   into a CI-executed end-to-end test so future regressions are caught
   automatically.

## Root Causes

1. **CheerpX 1.2.11 had a regression in its boot path.** The
   `cxcore-mlx-9020-prefetch-flush.js` chunk dereferenced `undefined.a1`
   four times while initialising the i386 emulator, and `cx.run` aborted
   with `CheerpException: Program exited with code 71`. CheerpX 1.3.0
   ships the fix; the project shipped 1.2.11.
2. **No test ever exercised the rendered workbench in a real browser.**
   The unit suite covered the Node-side glue (workspace FS, BroadcastChannel
   bus, COI bootstrap) but not "does the page actually boot Linux and
   run a command end to end." A 1.2.11 → 1.3.0 fix would not have been
   noticed by any existing test.
3. **The dev server and Pages were not byte-identical.** Pages
   canonicalises `/rust-web-box` → `/rust-web-box/` (so document-relative
   URLs resolve under the prefix); the dev server returned 200 for the
   bare prefix. A test that visited `/rust-web-box` locally hit a
   different code path than one that visited the live URL. Visible only
   when an end-to-end test is running.
4. **CI never proved that the deployed Pages URL actually worked after
   `actions/deploy-pages@v4`.** The deploy step succeeded as long as the
   tarball uploaded; nothing checked that the page actually booted.
5. **`globalThis.__rustWebBox.vmPhase` could never reach `'ready'`.**
   The page-level shim was only updated from CheerpX's `onProgress`
   callback in `cheerpx-bridge.bootLinux`, which stops at the
   `'starting Linux'` phase. The final `'ready'` transition originates
   inside `web/glue/webvm-server.js` after workspace priming completes
   and was emitted on the BroadcastChannel only — invisible to the
   page-level shim. The e2e harness (correctly) keys `vmPhase ===
   'ready'` on `globalThis.__rustWebBox.vmPhase`, so once the warm disk
   was actually staged in CI, the boot-wait would deadlock at 180 s
   waiting for a transition that the page never made. Symptom looked
   like "CheerpX is slow"; root cause was a wiring gap between the bus
   and the shim.

## Solution

1. **Bump CheerpX to 1.3.0.**
   - `web/build/build-workbench.mjs`: `CHEERPX_VERSION = '1.3.0'` with a
     comment pointing at issue #15.
   - `web/glue/cheerpx-bridge.js`: `CHEERPX_VERSION` bumped to keep the
     runtime check in sync with the vendored bundle.
   - `web/sw.js`: `CACHE_VERSION = 'rust-web-box-v3-vscode1.91.1-cheerpx1.3.0'`
     so the service-worker cache invalidates on first deploy.
   - Re-vendor with `node web/build/build-workbench.mjs` (downloads
     CheerpX 1.3.0 from the CDN into `web/cheerpx/`).
2. **Reusable browser-commander harness.**
   - `web/tests/helpers/cheerpx-page-harness.mjs` exports
     `tryLoadBrowserCommander`, `startDevServer`, `withWorkbench`,
     `waitForLinux`, `runInVM`, and `isWarmDiskStaged`.
   - Soft-skips when `browser-commander` / Chromium / the warm disk are
     missing, hard-fails when `RUST_WEB_BOX_E2E=1`.
   - Honours `RUST_WEB_BOX_E2E_NO_SANDBOX=1` for containerised CI
     environments without seccomp/userns access.
3. **Local e2e suite.**
   - `web/tests/e2e/local-pages-e2e.test.mjs` boots the dev server with
     `--base=/rust-web-box`, navigates a real Chromium to the workbench,
     waits for stage-2 Linux, runs `tree --version`, `tree /workspace -L 2`,
     and `/workspace/target/release/hello`. Asserts no `CheerpException`
     leaked into `console.error`.
4. **Live e2e suite.**
   - `web/tests/e2e/live-pages-e2e.test.mjs` performs the same flow
     against `RUST_WEB_BOX_LIVE_URL`. Default boot timeout is 180 s
     (override with `RUST_WEB_BOX_E2E_BOOT_MS`).
5. **CI integration in `.github/workflows/pages.yml`.**
   - `build` now stages the warm disk on PRs as well, with
     `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release asset.
     Uploads the built `web/` as a workflow artifact for the e2e job.
   - `local-e2e` (new): downloads the artifact, installs `browser-commander`
     and Playwright, runs the local e2e suite. Skips cleanly when no
     warm disk was staged.
   - `deploy` now waits on `local-e2e` so PR breakage cannot deploy.
   - `e2e` (new): runs after `deploy` against the live Pages URL.
6. **Dev server canonicalisation.**
   - `web/build/dev-server.mjs` redirects `/rust-web-box` → `/rust-web-box/`
     when a base prefix is set. Mirrors GitHub Pages so the local e2e
     test exercises the same URL shape as production.
7. **Single source of truth for `vmPhase`.**
   - `startWebVMServer` (`web/glue/webvm-server.js`) now accepts an
     `onPhase` callback and forwards every emitted phase
     (`'syncing-workspace'` → `'ready'`) through it as well as on the
     bus.
   - `boot.js` defines a single `setPhase` helper that mutates
     `globalThis.__rustWebBox.vmPhase`, emits on the bus, and is wired
     into both `bootLinux({ onProgress })` and `startWebVMServer({
     onPhase })`. After the change `vmPhase === 'ready'` is observable
     from the same shim the harness queries.
   - Regression test added in `web/tests/webvm-server.test.mjs` so a
     future refactor cannot silently disconnect the bus from the shim
     again.
8. **Actionable diagnostics on harness timeout.**
   - `web/tests/helpers/cheerpx-page-harness.mjs` now records every
     `vm.boot` payload (via a `BroadcastChannel` interceptor injected
     with `addInitScript`), every `console.*` line, every `pageerror`,
     and every failed network request. On stage-1 or stage-2 timeout
     the thrown error is re-formatted to include the in-page snapshot
     and these histories. CI failures now surface *why* the page
     stalled, rather than just `Timeout Xms exceeded`.

## Alternatives Considered

| Option | Result |
|--------|--------|
| Pin CheerpX 1.2.11 and patch the `'a1'` fault locally | Rejected. The fault is in the obfuscated `cxcore-mlx-9020-prefetch-flush.js` chunk; we cannot maintain a fork without breaking subsequent CheerpX updates. 1.3.0 is upstream's fix. |
| Drive the browser with raw Playwright instead of `browser-commander` | Rejected. Issue #15 explicitly asks for `browser-commander`. The harness still uses `commander.page.evaluate` (the documented escape hatch) for in-page work, and we'll file upstream issues for any wrapper gaps we hit. |
| Run the e2e suite against the deployed URL only | Rejected. Without a `local-e2e` job, regressions ship to Pages and a rollback is the only fix. The PR-time check pays for itself. |
| Make the local suite hard-fail when no warm disk is staged | Rejected for default mode. Forks and brand-new contributors should be able to run `node --test web/tests/` without first staging a 100MB+ disk. We hard-fail under `RUST_WEB_BOX_E2E=1` (CI's signal). |
| Use `actions/cache` instead of `actions/upload-artifact` to share the build between jobs | Rejected. Cache is stable across runs, but a stale cache that survives a CheerpX bump would mask exactly the kind of regression this work is supposed to catch. A scoped, single-run artifact is the right tool. |

## Upstream Issue Decision

The CheerpX 1.2.11 → 1.3.0 fault is upstream and is already fixed in
1.3.0. We do not file a bug there.

We may file `browser-commander` enhancement issues (the harness uses
`commander.page.evaluate` for fine-grained in-page work, and a
first-class wrapper for `console`/`pageerror` collection would shrink
the harness). When we do, the `docs/case-studies/issue-15/upstream-issues/`
directory is reserved for the cross-references.

## Verification Plan

Local verification:

```bash
# Unit tests (fast, offline).
node --test web/tests/

# Local e2e — soft-skips without browser-commander or warm disk.
cd web/tests && npm install
node --test e2e/local-pages-e2e.test.mjs

# Hard-fail mode: prove the harness produces the expected actionable
# error message when prerequisites are missing.
RUST_WEB_BOX_E2E=1 RUST_WEB_BOX_E2E_NO_SANDBOX=1 \
  node --test e2e/local-pages-e2e.test.mjs

# Drive the deployed site directly (no CI required).
RUST_WEB_BOX_E2E=1 \
  RUST_WEB_BOX_LIVE_URL=https://link-foundation.github.io/rust-web-box \
  node --test e2e/live-pages-e2e.test.mjs
```

CI verification: the `pages.yml` workflow runs the unit tests, builds
the artifact, runs the `local-e2e` job against the artifact, deploys,
then runs the `e2e` job against the deployed URL. Each step is in
TAP-formatted Node test output for easy log review.

## Related Files

- [`web/build/build-workbench.mjs`](../../../web/build/build-workbench.mjs)
- [`web/build/dev-server.mjs`](../../../web/build/dev-server.mjs)
- [`web/build/stage-pages-disk.mjs`](../../../web/build/stage-pages-disk.mjs)
- [`web/glue/cheerpx-bridge.js`](../../../web/glue/cheerpx-bridge.js)
- [`web/sw.js`](../../../web/sw.js)
- [`web/tests/boot-shell.test.mjs`](../../../web/tests/boot-shell.test.mjs)
- [`web/tests/helpers/cheerpx-page-harness.mjs`](../../../web/tests/helpers/cheerpx-page-harness.mjs)
- [`web/tests/e2e/local-pages-e2e.test.mjs`](../../../web/tests/e2e/local-pages-e2e.test.mjs)
- [`web/tests/e2e/live-pages-e2e.test.mjs`](../../../web/tests/e2e/live-pages-e2e.test.mjs)
- [`web/tests/package.json`](../../../web/tests/package.json)
- [`.github/workflows/pages.yml`](../../../.github/workflows/pages.yml)
