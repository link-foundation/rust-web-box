# web/

Static-site root for the in-browser Rust sandbox described in
[issue #1](https://github.com/link-foundation/rust-web-box/issues/1).

GitHub Pages publishes this directory after the build step at
`.github/workflows/pages.yml` runs `web/build/build-workbench.mjs` to
vendor the upstream `vscode-web` bundle, the CheerpX runtime, and our
extensions.

## Layout

```
web/
├── index.html                          # workbench entry + boot overlay
├── sw.js                               # SW: cache + COOP/COEP shim
├── glue/                               # page-level integration JS
│   ├── boot.js                         # orchestrator
│   ├── boot.css                        # boot overlay styling
│   ├── network-shim.js                 # cargo network mediator
│   ├── cheerpx-bridge.js               # CheerpX loader + Linux boot
│   ├── webvm-bus.js                    # transport-agnostic RPC
│   └── webvm-server.js                 # page-side FS + process server
├── build/                              # build & dev tooling
│   ├── build-workbench.mjs             # vendors vscode-web + CheerpX
│   ├── index.template.html             # workbench entry template
│   └── dev-server.mjs                  # COOP/COEP-aware dev server
├── extensions/
│   ├── webvm-host/                     # FS provider, pseudoterminal, cargo tasks
│   └── rust-analyzer-web/              # Rust language config + WASM loader
├── tests/                              # unit + smoke tests (`node --test`)
├── cheerpx/                            # vendored CheerpX runtime (CI populates)
├── vscode-web/                         # vendored VS Code Web bundle (CI populates)
└── disk/                               # disk image build script + manifest
```

## Local development

```bash
# All tests (no deps; 35 tests):
node --test web/tests/

# Build the workbench bundle (needs npm + network):
node web/build/build-workbench.mjs

# Local dev server with COOP/COEP headers (CheerpX boots successfully):
node web/build/dev-server.mjs 8080
# then open http://localhost:8080
```

## Component status

See [`docs/architecture.md`](../docs/architecture.md) for the
component-by-component table and the mapping to issue #1's acceptance
criteria.
