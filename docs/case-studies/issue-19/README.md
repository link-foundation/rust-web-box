# Issue 19 Case Study: Console Noise and Boot Polish

Issue: https://github.com/link-foundation/rust-web-box/issues/19

PR: https://github.com/link-foundation/rust-web-box/pull/20

Reported: 2026-05-02 07:13:44 UTC

## Evidence

- `evidence/issue-19.json` and `evidence/issue-19-comments.json` capture the GitHub issue and comments.
- `evidence/issue-19-console.png` is the reported browser screenshot. The PNG signature was verified as `89 50 4e 47 0d 0a 1a 0a`.
- `evidence/pr-20.json` captures the prepared PR state before this fix.
- `evidence/npm-*.json` records package metadata for `debug@4.4.3`, `log-lazy@1.0.4`, `vscode-web@1.91.1`, and `cheerpx@1.3.0`.
- `verification/web-node-tests.log`, `verification/build-workbench-skip.log`, and `verification/browser-console.log` record local verification.
- `verification/browser-sanity.png` is the post-fix Playwright MCP screenshot of the built workbench.

The screenshot shows the app is usable: the workspace opens, `tree`, `cargo --version`, `cargo build`, and `cargo run` succeed. The remaining problem is signal quality: the console contains repeated VS Code Web startup messages, missing source-map errors, CheerpX internal diagnostics, and a boot terminal line where progress dots interleave with phase text.

## Requirements

1. Reduce default console noise so real warnings and errors remain visible.
2. Keep namespaced debug logging off by default and make debug arguments lazy.
3. Provide source maps or stubs for web code that references source maps.
4. Polish the terminal boot banner so dots only follow the boot line.
5. Remove stale wording from active code and docs; the banner should say `in-browser Rust sandbox`.
6. Preserve issue data and write a case study with root causes, solutions, online research, and upstream follow-up.

## Root Causes and Fixes

### Repeated VS Code Web Startup Logs

VS Code Web logs benign startup chatter for this embedded configuration: disabled extension gallery fetches, the expected same-origin extension host iframe, early `webvm:/workspace` validation before the extension host is fully ready, and search-provider probes for `webvm`.

Fix:

- Added `web/glue/console-filter.js`, loaded before the VS Code loader, to suppress only exact known-benign messages.
- `?debug=1`, `?debug=vscode`, `?debug=workbench`, or matching localStorage debug settings bypass the filter.
- Added `configurationDefaults` for `workbench.startupEditor = none` and `extensions.ignoreRecommendations = true` to reduce avoidable workbench startup activity.

### Debug Logging Cost and Namespace Shape

The existing helper was off by default, but it only accepted the local namespace list form and evaluated all arguments at the call site.

Fix:

- `web/glue/debug.js` now accepts `debug`-style namespaces such as `rust-web-box:*` and exclusions such as `-rust-web-box:guest`.
- Function arguments are resolved only when a namespace is enabled, matching the lazy-evaluation goal of `log-lazy`.
- Tests cover disabled lazy arguments, enabled lazy arguments, wildcard namespaces, and exclusions.

### Source-Map 404s

Online/package research showed `vscode-web@1.91.1` ships bundles with `sourceMappingURL` comments while not shipping all referenced map files in the npm tarball. Browser developer tools then report source-map loading errors that obscure real failures.

Fix:

- Added `web/build/source-map-stubs.mjs`.
- `build-workbench.mjs` now scans vendored/static web roots and writes valid empty JSON source-map stubs for missing relative source-map references.
- Tests cover line and block `sourceMappingURL` comments, query strings, nested map paths, and remote/data URL skips.

Upstream follow-up:

- Reported to `vscode-web`: https://github.com/Felx-B/vscode-web/issues/52

### Boot Terminal Progress Text

The terminal printed a boot status line and also printed `VM stage: ...` updates while the dot timer was still running. That caused output like `..[rust-web-box] VM stage: syncing-workspace...`.

Fix:

- The pseudoterminal now prints one boot line, appends dots only to that line, then moves to the ready/failure status lines.
- Phase messages remain available through page-side debug logging instead of the default terminal output.

### Stale Workspace Task Seed

`SEED_FILES` accidentally declared `/workspace/.vscode/tasks.json` twice. The second declaration overwrote the root `cargo run` task with the legacy `cd /workspace/hello && cargo run` task.

Fix:

- Removed the duplicate legacy default task.
- Added a regression test that parses `DEFAULT_SEED['/workspace/.vscode/tasks.json']` and asserts the command is exactly `cargo run`.

### CheerpX Runtime TODO Logs and Internal Error Noise

The reported `TODO: Advisory locking is only stubbed` messages are emitted by CheerpX while Cargo still succeeds. The reported `a1` TypeError is also emitted from CheerpX's minified runtime. This repository cannot implement guest advisory locking inside CheerpX, but it can keep that known upstream runtime noise out of the default browser console.

Fix:

- The console filter now suppresses only the exact known CheerpX `a1` runtime error when it originates from `/cheerpx/cx_esm.js`.
- Unrelated runtime errors and all `console.error` calls remain visible by default.

Upstream follow-up:

- Reported to CheerpX: https://github.com/leaningtech/cheerpx-meta/issues/12

## Online Research

- `debug@4.4.3`: npm metadata describes it as a lightweight debugging utility for Node.js and the browser; repository is https://github.com/debug-js/debug.
- `log-lazy@1.0.4`: npm metadata describes it as lazy logging with bitwise level control; repository is https://github.com/link-foundation/log-lazy.
- `vscode-web@1.91.1`: package metadata points to https://github.com/Felx-B/vscode-web and the npm tarball used by the build.
- `cheerpx@1.3.0`: package metadata points to https://cheerpx.io/docs and https://github.com/leaningtech/cheerpx-meta.

## Verification

- `node --test web/tests`
  - 170 tests, 167 pass, 3 skipped, 0 failed.
- Playwright MCP browser sanity check against `node web/build/dev-server.mjs 8091 --base=/rust-web-box`
  - Page loaded from the GitHub Pages base path, the VM reached the ready terminal prompt, the filter recorded 20 suppressed known-noise messages, and there were no source-map 404s.
  - `verification/browser-console.log` records the remaining browser console output: one Chromium-native iframe sandbox warning generated by the browser, not by page-side JavaScript.
- `SKIP_VSCODE_WEB=1 SKIP_CHEERPX=1 node web/build/build-workbench.mjs`
  - Verifies the build script renders `index.html` and runs the source-map stub pass without requiring a fresh vendor download.
- `node web/build/build-workbench.mjs`
  - Full build completed and wrote source-map stubs for missing vendored `vscode-web` package maps, including the xterm maps reported in the issue.
- `cargo fmt --all -- --check`
- `cargo clippy --all-targets --all-features`
- `cargo test --verbose`
- File-size check:
  - `rust-script scripts/check-file-size.rs` could not run because `rust-script` is not installed in this runner.
  - `verification/check-file-size-fallback.log` records an equivalent shell check for Rust files over 1000 lines; it passed.

Browser e2e tests remain skipped locally because `browser-commander` / Playwright dependencies are not installed in this checkout; CI covers the configured web test paths.
