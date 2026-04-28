---
bump: minor
---

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.
