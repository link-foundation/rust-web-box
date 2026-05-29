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

- **iPad terminal (not yet root-caused — diagnostics added).** We cannot
  reproduce this without an iPad, and the existing code *silently*
  retried a failed `/bin/bash --login` every 500 ms, so nothing surfaced
  the failure. Per the issue's explicit instruction ("If there is not
  enough data to find actual root cause, add debug output and verbose
  mode … that will allow us to find root cause on next iteration") we
  added interactive-shell health diagnostics and Apple-platform
  detection (see *Diagnostics* below). A prepared upstream report for
  CheerpX is staged in `upstream-issues/` to be filed once a real iPad
  produces a diagnostic dump.

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
   `web/glue/boot.css`, plus diagnostics in `web/glue/webvm-server.js`,
   `web/glue/boot.js`, `web/glue/browser-info.js`, `web/glue/debug.js`.
5. **Regression tests** added in `web/tests/issue-37-ux-parity.test.mjs`.

## Requirements checklist (verbatim from the issue)

| # | Requirement | Status |
| --- | --- | --- |
| R1 | Terminal must work in Safari on iPad | **Diagnostics added** — root cause not yet observable without an iPad; verbose mode now captures it. |
| R2 | Fix CSS offsets/margins/paddings causing misalignment in all browsers | **Fixed** — `position:fixed;inset:0` + safe-area insets. |
| R3 | Apply the dark theme like vscode.dev | **Fixed** — `Default Dark Modern` default. |
| R4 | Consider latest versions of all components | **Reviewed** — see *Component versions* below. |
| R5 | Follow best UI/UX practices for all devices; compare actual DOM | **Done** — live DOM compared via Playwright; `viewport-fit=cover` + safe-area added for notch/home-indicator devices. |
| R6 | Compile issue data to `docs/case-studies/issue-37` and do deep analysis | **This document** + `online-research.md` + `evidence/`. |
| R7 | Search online for additional facts | **Done** — `online-research.md`. |
| R8 | Reconstruct timeline, list requirements, root-cause each, propose plans, survey libraries | **This document.** |
| R9 | Add debug output / verbose mode if root cause not findable | **Done** — shell-loop diagnostics + platform detection in `dumpRuntime()`. |
| R10 | File upstream issues with repro/workaround/fix where applicable | **Prepared** — `upstream-issues/cheerpx-ipad-terminal.md` (pending an iPad diagnostic dump for a real repro). |
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

### R1 — iPad terminal (NOT REPRODUCED → diagnostics)

The terminal pipeline is: CheerpX `console.onData` → sync-frame filter →
LF→CRLF normaliser → `busServer.emit('proc.stdout')` → the `webvm-host`
extension renders into an xterm.js-backed VS Code Pseudoterminal. The
interactive shell itself is `runShellLoop()`, which spawns
`/bin/bash --login` and respawns it on exit. The reporter's iPad
screenshot shows the workbench up but no shell prompt. Two facts blocked a
confident root cause: (a) no iPad hardware to reproduce on, and (b) the
old `runShellLoop` swallowed every spawn error with
`console.warn(...) + 500 ms retry`, so a bash-never-starts condition was
invisible. CheerpX *does* support Safari/iPadOS in principle (it needs
SharedArrayBuffer + cross-origin isolation, both available in modern
Safari — see `online-research.md`), so the failure is most likely
device/version-specific (memory pressure, a WASM/JIT limitation, or a
SAB/COOP-COEP edge under Safari). **Action:** make it observable (below)
and file upstream once a real dump exists.

## Diagnostics added (verbose mode)

- **`web/glue/webvm-server.js`** — `runShellLoop` now records every
  spawn / exit / error into `runtime.shellLoop`
  (`spawns`, `exits`, `errors`, `fastCycles`, `lastExitCode`,
  `lastError`, `running`, `healthy`). A spawn that throws or exits within
  `SHELL_FAST_CYCLE_MS` (750 ms) counts as a "fast cycle"; after
  `SHELL_FAST_CYCLE_LIMIT` (3) in a row it flips `healthy=false`, emits a
  `vm.shell` bus event, and invokes `opts.onShellUnhealthy`. The server
  now also returns its `runtime`.
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
- **Terminal.** Without a repro, the only correct first step is
  observability, then an upstream report with the captured dump. We did
  not ship a "disable terminal on iPad" workaround — that would hide the
  bug rather than fix it.

## Existing components / libraries surveyed

- **xterm.js** (already vendored via the webvm-host Pseudoterminal) — the
  terminal renderer; not the failing layer here.
- **CheerpX / WebVM** (`leaningtech`) — owns `/bin/bash` execution; the
  most likely home of the iPad failure. Prepared upstream report in
  `upstream-issues/`.
- **VS Code Web** `IWorkbenchConstructionOptions.configurationDefaults` —
  the supported, documented mechanism we used for the theme default (no
  new dependency needed).
- **CSS env() safe-area-inset + `viewport-fit=cover`** — the platform
  primitive for notch/home-indicator-safe layouts; no library required.

## Component versions (R4)

Vendored today: `vscode-web@1.91.1`, CheerpX `1.3.0`. Both are pinned in
`web/build/build-workbench.mjs`. A blanket bump is **out of scope for this
PR** because (a) CheerpX 1.3.0 carries a known boot-wedge workaround
(`skipPrime`, see `webvm-server.js`) that a version bump would need to be
re-validated against on real hardware, and (b) none of the three
confirmed defects is fixed by a version bump — they are our own
configuration/CSS. We note the consideration here and leave the upgrade to
a dedicated PR with its own e2e validation.

## Before / after (dark theme)

| Before | After |
| --- | --- |
| `screenshots/live-desktop-light-theme.png` — deployed app, workbench class `vs … light_modern-json` (light). | `screenshots/after-dark-theme.png` — this PR built locally, workbench class `vs-dark … dark_modern-json` (dark). |

## Verification

- `node --test web/tests/` — full suite green (incl. the new
  `issue-37-ux-parity.test.mjs`, 9 assertions covering theme/viewport/
  diagnostics).
- Built the workbench locally (`node web/build/build-workbench.mjs`) and
  rendered it via Playwright at 1024×768. Confirmed:
  - `.monaco-workbench` class is
    `… vs-dark vscode-theme-defaults-themes-dark_modern-json` (dark theme
    now applied — was `light_modern` before).
  - `getComputedStyle(document.documentElement).position === 'fixed'`
    (the `inset: 0` pin is active, not `100vw/100vh`).
  - `document.body` background is `rgb(30, 30, 30)`.
  - See `screenshots/after-dark-theme.png`.
