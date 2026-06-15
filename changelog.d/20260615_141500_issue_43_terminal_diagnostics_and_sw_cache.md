---
bump: patch
---

### Fixed
- Reach the user: the v0.16.0 native-notification UI from issue #39 was already shipped but iPads kept showing the old red-toast HTML widget. Root cause: the service worker was cache-first for the **app shell** with a `CACHE_VERSION` that hadn't been bumped through #39 / #41, so iPads pinned the v0.15.0 `glue/boot.js` forever. `web/sw.js` now uses **network-first for the app shell** (HTML, glue, extensions) and **cache-first only for the huge immutable assets** (`/vscode-web/`, `/cheerpx/`, `/disk/`); `CACHE_VERSION` gains an `-app2` epoch so every device evicts the stale shell exactly once on activate (issue #43).

### Changed
- Diagnostics now print **into the VS Code terminal**, not the browser console, because iPadOS Safari has no easy developer console. The silent-shell advisory (issue #37) no longer points users at a dead-end `__rustWebBox.dump()` invocation; it inlines a compact `--- rust-web-box diagnostics ---` block directly in the pseudoterminal, with browser tells, isolation flags, `vmPhase`, and shell-loop stats. `web/glue/boot.js`'s shell-unhealthy notification points at the new VS Code command instead of the console (issue #43).

### Added
- `formatDiagnosticsForTerminal(dump, {ansi, eol})` in `web/glue/debug.js` — renders a `dumpRuntime()` snapshot as a terminal-friendly block with optional ANSI dim styling and `\r\n` line endings for a pty (issue #43).
- `dumpRuntime()` now surfaces the iPad-Safari silent-shell signals (`outputBytes`, `silentSpawns`, `slowFirstOutput`) so a terminal screenshot is enough to triage a blank-prompt report (issue #43).
- New `vm.diagnostics` bus method returns `{dump, terminalText}` so any extension can render diagnostics on demand without re-implementing the formatter (issue #43).
- New VS Code command **WebVM: Show Diagnostics in Terminal** (`webvm-host.showDiagnostics`) opens a throwaway pseudoterminal that prints the diagnostics block on demand — the surface the user is already looking at when something fails (issue #43).
- Regression tests `web/tests/sw-cache-strategy.test.mjs` (13 tests covering the network-first/cache-first split, COOP/COEP synthesis, range-request bypass, activate-evicts-old-caches, and the `-app{N}` epoch) and `web/tests/diagnostics-in-terminal.test.mjs` (8 tests covering the terminal formatter, the `vm.diagnostics` bus method, the extension command registration, and the boot.js advisory rewrite). `web/tests/webvm-server.test.mjs`'s silent-shell test updated to assert the new in-terminal block instead of the dead-end console hint.
- Case study `docs/case-studies/issue-43/` with timeline, requirements coverage table, deep root-cause analysis (stale SW cache + iPadOS console dead-end), online-research notes, and the iPad Pro evidence screenshot.
