---
bump: patch
---

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).
