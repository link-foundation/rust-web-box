---
bump: patch
---

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.
