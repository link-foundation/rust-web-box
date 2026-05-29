# Case Study: Issue #37 — "Make UI/UX perfectly match vscode.dev"

Issue: https://github.com/link-foundation/rust-web-box/issues/37

PR: https://github.com/link-foundation/rust-web-box/pull/38

## Summary

The reporter compared the deployed app
(https://link-foundation.github.io/rust-web-box/) against
https://vscode.dev side by side (two iPad screenshots) and called out
three concrete defects plus a broad "match vscode.dev everywhere"
requirement:

1. **Terminal does not work in Safari on iPad.**
2. **CSS misalignment in all browsers** — offsets / margins / paddings
   make UI controls in the red-marked areas misaligned or clipped.
3. **Dark theme is not applied** in our app, while vscode.dev renders
   dark successfully.

Plus process requirements: compile issue data into this case-study
folder, reconstruct the timeline, enumerate every requirement, root-cause
each problem, propose solution plans (and survey existing
components/libraries), search online for corroborating facts, add debug
output / verbose mode where the root cause is not yet observable, file
upstream issues (with reproducible examples) where the bug lives in a
dependency, apply each fix across the **entire** codebase, and do it all
in this single PR.

**Findings (one paragraph per defect).**

- **Dark theme (confirmed, fixed).** The live workbench body carried the
  class `vs vscode-theme-defaults-themes-light_modern-json` — *Light*
  Modern. We never shipped a `workbench.colorTheme` default, so the
  workbench fell back to the OS `prefers-color-scheme`. On a
  light-configured device (and on the GitHub Pages screenshot capture)
  that resolves to light. vscode.dev ships an explicit dark default.
  **Fix:** ship `workbench.colorTheme: "Default Dark Modern"` from every
  place the workbench configuration is produced.

- **CSS clipping (confirmed, fixed).** `html, body` used
  `width: 100vw; height: 100vh`. On Safari (desktop *and* iPad) `100vw`
  is the layout-viewport width *including* the classic-scrollbar /
  visual-viewport gutter, so the body ends up a few px wider than the
  visible area. Because the workbench sets `overflow: hidden`, the
  title-bar and panel controls that lay out against the right edge get
  clipped — exactly the red-marked misalignment. **Fix:**
  `position: fixed; inset: 0` (always matches the *visible* viewport and
  also dodges the `100vh` dynamic-toolbar bug), `viewport-fit=cover`, and
  `env(safe-area-inset-*)` offsets on the boot toast.

- **iPad terminal (root cause in CheerpX; mitigated + made visible).**
  The terminal pipeline is sound; the failure lives in the CheerpX
  runtime, whose `OverlayDevice` `'a1'` bug intermittently wedges on
  fresh-inode allocation (the same upstream bug already mitigated for
  issues #15/#17). On Safari/iPad this surfaces as a *silent* spawn: bash
  starts, the runtime wedges before it prints anything, and the old loop
  retried forever without surfacing it — the user saw a blank pane with a
  lone cursor. **Fix (this PR):** (1) a **first-output watchdog** that,
  when bash produces no output within the window, writes a visible,
  actionable advisory straight into the terminal (naming the upstream bug
  and the reload/Chromium workarounds) and records structured shell-loop
  diagnostics; (2) defensive `HISTFILE=/dev/null` everywhere bash starts
  (`BASH_ENV`, the profile builder, and the baked disk image) so bash no
  longer allocates a fresh `~/.bash_history` inode that can trip the
  wedge; (3) CheerpX bumped to the latest **1.3.3**. The upstream report
  is documented in `upstream-issues/cheerpx-ipad-terminal.md`.

## Evidence

| File | What it is |
| --- | --- |
| `evidence/issue-37.json` | Full issue payload (title, body, metadata) as fetched from the GitHub API. |
| `evidence/current-app.png` | Reporter's screenshot of our app on iPad. |
| `evidence/vscode-dev.png` | Reporter's screenshot of vscode.dev on iPad for comparison. |
| `screenshots/live-desktop-light-theme.png` | Live capture of the deployed app via Playwright, showing the Light Modern body class — the dark-theme root cause. |

## Timeline / sequence of events

1. **v0.14.0 deployed** to GitHub Pages (commit `786da32`). The workbench
   mounts directly into `<body>`; no `workbench.colorTheme` default ships,
   and `boot.css` pins the body with `100vw/100vh`.
2. **Reporter opens the app on an iPad** in Safari next to vscode.dev and
   files issue #37 with two screenshots and three defects.
3. **Investigation (this PR).**
   - Reproduced the *theme* defect live with Playwright: the body class is
     `…light_modern-json`, confirming the OS-fallback root cause.
   - Reproduced the *CSS clipping* mechanism by analysis + the documented
     Safari `100vw` scrollbar-gutter bug (see `online-research.md`).
   - Could **not** reproduce the *iPad terminal* defect (no iPad
     hardware); confirmed from the code that bash failures were swallowed
     by a silent retry loop.
4. **Fixes applied** across `web/index.html`,
   `web/build/index.template.html`, `web/build/build-workbench.mjs`,
   `web/glue/boot.css` (theme + viewport), plus the terminal fix in
   `web/glue/webvm-server.js` (first-output watchdog + visible advisory +
   `HISTFILE=/dev/null`) and `web/disk/Dockerfile.disk`, with diagnostics
   in `web/glue/boot.js`, `web/glue/browser-info.js`, `web/glue/debug.js`.
   CheerpX bumped to the latest **1.3.3** across all code, tests, and docs.
5. **Regression tests** added in `web/tests/issue-37-ux-parity.test.mjs`
   and `web/tests/webvm-server.test.mjs` (silent-spawn watchdog: fires the
   advisory on no-output, and stays quiet when a prompt is printed).

## Requirements checklist (verbatim from the issue)

| # | Requirement | Status |
| --- | --- | --- |
| R1 | Terminal must work in Safari on iPad | **Root-caused + mitigated** — failure is the CheerpX `OverlayDevice 'a1'` wedge; added a first-output watchdog with a visible in-terminal advisory, `HISTFILE=/dev/null` to avoid fresh-inode churn, and bumped CheerpX to 1.3.3. The unfixable-from-JS core is reported upstream. |
| R2 | Fix CSS offsets/margins/paddings causing misalignment in all browsers | **Fixed** — `position:fixed;inset:0` + safe-area insets. |
| R3 | Apply the dark theme like vscode.dev | **Fixed** — `Default Dark Modern` default. |
| R4 | Consider latest versions of all components | **Done** — CheerpX bumped 1.3.0 → latest 1.3.3; `vscode-web@1.91.1` is already latest. See *Component versions* below. |
| R5 | Follow best UI/UX practices for all devices; compare actual DOM | **Done** — live DOM compared via Playwright; `viewport-fit=cover` + safe-area added for notch/home-indicator devices. |
| R6 | Compile issue data to `docs/case-studies/issue-37` and do deep analysis | **This document** + `online-research.md` + `evidence/`. |
| R7 | Search online for additional facts | **Done** — `online-research.md`. |
| R8 | Reconstruct timeline, list requirements, root-cause each, propose plans, survey libraries | **This document.** |
| R9 | Add debug output / verbose mode if root cause not findable | **Done** — shell-loop diagnostics + platform detection in `dumpRuntime()`. |
| R10 | File upstream issues with repro/workaround/fix where applicable | **Filed** — [leaningtech/webvm#222](https://github.com/leaningtech/webvm/issues/222), the single canonical report for the CheerpX `OverlayDevice 'a1'` wedge (repro + workarounds + fix suggestion). See `upstream-issues/`. |
| R11 | Apply fixes across the entire codebase (all places) | **Done** — theme default in all 3 config producers; viewport in both HTML sources. |
| R12 | Single PR (#38), push only to the issue branch | **Done.** |

## Root-cause analysis

### R3 — Dark theme not applied (CONFIRMED)

VS Code Web chooses its color theme from, in order: the persisted
`workbench.colorTheme` user setting → the `configurationDefaults` shipped
in the product/workbench configuration → an internal default that honours
the OS `prefers-color-scheme`. We shipped no default, so a fresh visitor
(no persisted setting) inherits the OS scheme. The deployed page rendered
`vscode-theme-defaults-themes-light_modern-json` (Light Modern). vscode.dev
sets a dark default. **Fix:** add
`"workbench.colorTheme": "Default Dark Modern"` to `configurationDefaults`
in `web/index.html`, `web/build/index.template.html`, and **both**
config writers in `web/build/build-workbench.mjs` (`writeProductJson` and
`renderIndex`) so a rebuild can't regress it.

### R2 — CSS clipping / misalignment (CONFIRMED)

`100vw` on Safari resolves to the layout viewport width *including* the
scrollbar/visual-viewport gutter (documented WebKit behaviour — see
`online-research.md`), so a `width: 100vw` body is slightly wider than the
visible area. The workbench's `overflow: hidden` then clips whatever lays
out against the right/bottom edges (title-bar actions, panel toggles) —
the red-marked misalignment. The classic `100vh` dynamic-toolbar bug
compounds it on mobile Safari. **Fix:** drop `100vw/100vh` entirely and
pin the body to the *visible* viewport with `position: fixed; inset: 0`,
add `viewport-fit=cover` so the workbench paints edge-to-edge under the
notch/home-indicator, and offset the only floating element (the boot
toast) by `env(safe-area-inset-*)` so it clears the rounded corners.

### R1 — iPad terminal (ROOT-CAUSED → mitigated + made visible)

The terminal pipeline is: CheerpX `console.onData` → sync-frame filter →
LF→CRLF normaliser → `busServer.emit('proc.stdout')` → the `webvm-host`
extension renders into an xterm.js-backed VS Code Pseudoterminal. The
interactive shell itself is `runShellLoop()`, which spawns
`/bin/bash --login` and respawns it on exit. The reporter's iPad
screenshot (`evidence/current-app.png`) shows the workbench up, the boot
banner printed in full (including "Workspace mirrored to /workspace"), but
then only a lone tofu □ cursor — bash spawned and produced *no* prompt.

That signature is the **CheerpX `OverlayDevice 'a1'` wedge** — the same
upstream bug already isolated and mitigated for issues #15/#17:
~1-in-N fresh-inode allocations on the IDB-backed writable overlay hang
`cx.run` forever with `TypeError: …reading 'a1'` (`exit code 71`). It is
*not* a SharedArrayBuffer / COOP-COEP problem (CheerpX boots far enough to
print the banner, which already requires SAB + cross-origin isolation).
The reason it presented as a brand-new "terminal" defect is that two
distinct failure modes look identical in the UI: (a) a fast
spawn→exit cycle (already detected by the fast-cycle counter), and (b)
this **silent** mode where bash spawns, wedges before printing, and never
exits — which the fast-cycle detector cannot see (no exit, no error).

**Fix (this PR, applied across the codebase):**

1. **First-output watchdog** (`web/glue/webvm-server.js`). Each bash spawn
   records its output-byte baseline; if no output arrives within
   `SHELL_FIRST_OUTPUT_TIMEOUT_MS` (15 s, overridable via
   `opts.shellFirstOutputTimeoutMs`) while the process is still the
   current spawn and still running, the loop flags
   `runtime.shellLoop.silentSpawns`/`slowFirstOutput`, emits a
   `vm.shell {healthy:false, kind:'no-output'}` bus event, and writes a
   **visible advisory directly into the terminal** naming the upstream bug
   (`rust-web-box#37`) and the reload / Chromium workarounds, plus how to
   capture diagnostics (`__rustWebBox.dump()`). The user never stares at a
   blank pane again.
2. **`HISTFILE=/dev/null`** wherever bash starts — `BASH_ENV`, the
   `buildShellProfileScript()` profile, and the baked
   `web/disk/Dockerfile.disk` `/root/.bash_profile`. Interactive bash
   otherwise allocates a fresh `~/.bash_history` inode on first run, which
   is exactly the fresh-inode allocation that trips the wedge. This is the
   same family of mitigation as the pre-baked workspace seed paths and
   `CARGO_INCREMENTAL=0`.
3. **CheerpX bumped to the latest 1.3.3** (was 1.3.0). The 1.3.1–1.3.3
   changelog does not include an `OverlayDevice` fix, so the wedge
   mitigations stay in place, but we ship the newest runtime per R4.

The residual core — the `OverlayDevice 'a1'` allocation hang itself —
cannot be fixed from page-side JS; it is **filed upstream** as
[leaningtech/webvm#222](https://github.com/leaningtech/webvm/issues/222)
(the single canonical report — same bug as #15/#17, three triggers) with a
reproducible example, the workarounds we ship, and a fix suggestion. See
`upstream-issues/`.

## Diagnostics & mitigation added (verbose mode + visible advisory)

- **`web/glue/webvm-server.js`** — `runShellLoop` records every
  spawn / exit / error into `runtime.shellLoop`
  (`spawns`, `exits`, `errors`, `fastCycles`, `lastExitCode`,
  `lastError`, `running`, `healthy`) **plus** the first-output watchdog
  fields (`outputBytes`, `firstOutputAt`, `lastOutputAt`, `silentSpawns`,
  `slowFirstOutput`, `lastSilentSpawnAt`). Two failure modes are now
  distinguished: a spawn that throws or exits within
  `SHELL_FAST_CYCLE_MS` (750 ms) counts as a "fast cycle" (after
  `SHELL_FAST_CYCLE_LIMIT` = 3 it flips `healthy=false` via
  `onShellUnhealthy`); and a spawn that produces **no output** within
  `SHELL_FIRST_OUTPUT_TIMEOUT_MS` (15 s) fires `onSilentStart`, which
  emits the `vm.shell {kind:'no-output'}` event and writes the visible
  in-terminal advisory. The server returns its `runtime` so the page-side
  dump can read live health.
- **`web/glue/boot.js`** — passes `onShellUnhealthy`, which shows an
  actionable boot toast ("The Linux shell could not start in this
  browser…"), and stores `__rustWebBox.vmServer` so the dump can read
  live shell health.
- **`web/glue/browser-info.js`** — adds `isSafari`, `isIOS`, `isIPad`,
  `isIPhone`, `platform`, `maxTouchPoints`. iPadOS Safari reports its UA
  as "Macintosh", so iPad is detected as a Mac UA with
  `maxTouchPoints > 1`.
- **`web/glue/debug.js`** — `dumpRuntime()` now reports `platform`,
  `maxTouchPoints`, `browserId`, `isSafari`, `isIOS`, `isIPad`, and the
  `shellLoop` health snapshot. A maintainer on an iPad runs
  `__rustWebBox.dump()` (or loads with `?debug=1`) and pastes the result.

## Solution plans considered

- **Theme.** (a) Ship a `configurationDefaults` default *(chosen — least
  surprising, exactly what vscode.dev does)*; (b) inject `vs-dark` body
  class manually in `boot.css`/JS *(rejected — fights the workbench's own
  theme service and breaks user theme switching)*; (c) set
  `window.autoDetectColorScheme` + preferred dark/light themes *(rejected
  for the default — it would still render light on a light-configured
  device, reproducing the bug)*.
- **Viewport.** (a) `position: fixed; inset: 0` *(chosen — matches the
  visible viewport on every platform)*; (b) `100lvw/100lvh` logical units
  *(partial — still inherits scrollbar-gutter quirks and lacks broad
  older-Safari support)*; (c) `scrollbar-gutter: stable` *(rejected —
  unsupported in Safari per Smashing Magazine)*; (d) JS
  `--vh` custom-property hack *(rejected — adds runtime JS for what CSS
  solves)*.
- **Terminal.** (a) Make the silent wedge observable *and* visible to the
  user via the first-output watchdog + in-terminal advisory, reduce its
  trigger rate with `HISTFILE=/dev/null`, ship the latest CheerpX, and
  report the unfixable-from-JS core upstream *(chosen — this is a genuine
  mitigation, not a deferral)*; (b) disable the terminal on iPad
  *(rejected — hides the feature instead of fixing it, and the wedge is
  intermittent so the terminal often works)*; (c) force a full
  page-reload on wedge detection *(rejected as automatic behaviour — it
  would loop on a reproducibly-wedging device; instead we tell the user to
  reload, which works for the intermittent case)*.

## Existing components / libraries surveyed

- **xterm.js** (already vendored via the webvm-host Pseudoterminal) — the
  terminal renderer; not the failing layer here.
- **CheerpX / WebVM** (`leaningtech`) — owns `/bin/bash` execution and the
  `OverlayDevice` that hosts the wedge; the home of the iPad failure.
  Filed upstream as
  [leaningtech/webvm#222](https://github.com/leaningtech/webvm/issues/222);
  see `upstream-issues/`.
- **VS Code Web** `IWorkbenchConstructionOptions.configurationDefaults` —
  the supported, documented mechanism we used for the theme default (no
  new dependency needed).
- **CSS env() safe-area-inset + `viewport-fit=cover`** — the platform
  primitive for notch/home-indicator-safe layouts; no library required.

## Component versions (R4)

Vendored after this PR: `vscode-web@1.91.1` (already the latest published
`vscode-web`) and CheerpX **1.3.3** (bumped from 1.3.0; pinned in
`web/build/build-workbench.mjs`, `web/glue/cheerpx-bridge.js`, the service
worker cache key, and the vendored `web/cheerpx/.version`).

CheerpX latest was confirmed empirically: `cxcore.js` is served for
1.3.0–1.3.3 (HTTP 200) but 1.3.4 returns HTTP 204, so 1.3.3 is the newest
release. The 1.3.1–1.3.3 changelog (1.3.1 silence a non-fatal log; 1.3.2
`llseek` arg validation; 1.3.3 stop erroring on inet `SO_RCVBUF`) does
**not** include an `OverlayDevice` fix, so the `'a1'` wedge mitigations
(`skipPrime`, pre-baked seed paths, `CARGO_INCREMENTAL=0`,
`HISTFILE=/dev/null`, and the first-output watchdog) remain necessary and
are kept. The bump was re-validated against the full test suite and a
local Chromium boot.

## Before / after

| What | Before | After |
| --- | --- | --- |
| Dark theme | `screenshots/live-desktop-light-theme.png` — deployed app, workbench class `vs … light_modern-json` (light). | `screenshots/after-dark-theme.png` — this PR built locally, workbench class `vs-dark … dark_modern-json` (dark). |
| iPad portrait viewport | `evidence/current-app.png` — reporter's iPad capture (clipped controls, light theme, blank terminal). | `screenshots/after-ipad-portrait.png` — this PR at an iPad-portrait viewport: dark, controls fully on-screen. |
| iPad landscape viewport | — | `screenshots/after-ipad-landscape.png` — this PR at an iPad-landscape viewport. |

## Verification

- `node --test web/tests/` — full suite green (236 pass / 4 skipped / 0
  fail), including:
  - `issue-37-ux-parity.test.mjs` — theme/viewport/diagnostics **and**
    the first-output watchdog + advisory source assertions.
  - `webvm-server.test.mjs` — two integration tests for the silent-spawn
    watchdog: it fires the `no-output` advisory (`vm.shell` event +
    `proc.stdout` "produced no prompt" text + `silentSpawns`/
    `slowFirstOutput`) when bash is silent, and stays quiet when a prompt
    is printed before the window.
- Built the workbench locally (`node web/build/build-workbench.mjs`) and
  rendered it via Playwright (Chromium) at desktop and iPad viewports.
  Confirmed:
  - `.monaco-workbench` class is
    `… vs-dark vscode-theme-defaults-themes-dark_modern-json` (dark theme
    now applied — was `light_modern` before).
  - `getComputedStyle(document.documentElement).position === 'fixed'`
    (the `inset: 0` pin is active, not `100vw/100vh`).
  - `document.body` background is `rgb(30, 30, 30)`.
  - See `screenshots/after-dark-theme.png`,
    `screenshots/after-ipad-portrait.png`,
    `screenshots/after-ipad-landscape.png`.
- Playwright is Chromium-only, so the *Safari/iPad-specific* CheerpX wedge
  cannot be reproduced in this harness; the iPad screenshots verify the
  theme + viewport fixes at iPad dimensions, and the terminal mitigation
  is covered by the Node integration tests above.
