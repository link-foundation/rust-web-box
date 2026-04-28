# web/

Static-site root for the in-browser Rust sandbox described in
[issue #1](https://github.com/link-foundation/rust-web-box/issues/1).

This is what gets published to GitHub Pages. The CI workflow at
`.github/workflows/pages.yml` deploys this directory verbatim on every push to
`main`.

## Layout

```
web/
├── index.html              # boot shell (visible to users)
├── glue/                   # page-level JS that wires CheerpX <-> fetch
│   ├── boot.js             # entrypoint: registers SW, runs shim self-check
│   ├── boot.css            # boot screen styling
│   └── network-shim.js     # cargo network -> JS fetch (with proxy fallback)
├── sw.js                   # service worker (caching + COOP/COEP shim)
├── cheerpx/                # vendored CheerpX engine — placeholder, not vendored yet
├── vscode-web/             # full VS Code Web build — placeholder, not built yet
├── extensions/
│   ├── webvm-host/         # FS provider + pseudoterminal — placeholder
│   └── rust-analyzer-web/  # rust-analyzer WASM web extension — placeholder
└── disk/                   # `rust-debian.ext2` is fetched from a Release asset at runtime
```

Everything outside `index.html`, `glue/`, and `sw.js` is currently a
placeholder describing the eventual occupant. Each placeholder directory
has its own README describing what is expected to live there and the build
pipeline that will produce it.

## Status of the MVP slice

Implemented in this commit:

- Static shell + boot screen.
- Network shim with verifiable host-routing rules and a sequential CORS-proxy
  fallback for `index.crates.io`.
- Service worker with cache-first behaviour and a COOP/COEP shim so the page
  becomes cross-origin-isolated even when GitHub Pages doesn't set the
  headers itself.
- Automated test of the shim's routing logic and proxy fallback (in
  `web/tests/`, runnable with `node --test`).
- GitHub Actions workflow that publishes `web/` to GitHub Pages on push.

Not yet implemented (tracked in `docs/architecture.md`):

- Vendored CheerpX runtime and the WebVM disk image.
- Vendored VS Code Web build.
- The `webvm-host` extension (FS provider, pseudoterminal, tasks).
- The `rust-analyzer` WASM web extension.
