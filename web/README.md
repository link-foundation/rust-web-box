# web/

Static-site root for the in-browser Rust sandbox described in
[issue #1](https://github.com/link-foundation/rust-web-box/issues/1).

GitHub Pages publishes this directory after the build step at
`.github/workflows/pages.yml` runs `web/build/build-workbench.mjs` to
vendor the upstream `vscode-web` bundle, the CheerpX 1.2.11 runtime,
and our two web extensions.

## Layout

```
web/
├── index.html                          # workbench entry (no custom UI)
├── sw.js                               # SW: cache + COOP/COEP shim
├── glue/                               # page-level integration JS
│   ├── boot.js                         # 2-stage orchestrator
│   ├── boot.css                        # bottom-right toast styling
│   ├── network-shim.js                 # cargo network mediator
│   ├── cheerpx-bridge.js               # CheerpX loader + Linux boot
│   ├── webvm-bus.js                    # transport-agnostic RPC
│   ├── workspace-fs.js                 # IDB-backed JS workspace store
│   ├── workspace-server.js             # stage-1 fs.* methods (pre-VM)
│   └── webvm-server.js                 # stage-2 server (workspace + VM)
├── build/                              # build & dev tooling
│   ├── build-workbench.mjs             # vendors vscode-web + CheerpX
│   ├── stage-pages-disk.mjs            # release asset -> Pages disk chunks
│   ├── index.template.html             # workbench entry template
│   └── dev-server.mjs                  # COOP/COEP-aware dev server
├── extensions/
│   ├── webvm-host/                     # FS provider, pseudoterminal, cargo tasks
│   └── rust-analyzer-web/              # Rust language config + WASM loader
├── tests/                              # unit + smoke tests (`node --test`)
├── cheerpx/                            # vendored CheerpX runtime (CI populates)
├── vscode-web/                         # vendored VS Code Web bundle (CI populates)
└── disk/                               # Alpine + Rust ext2 image build
    ├── Dockerfile.disk                 # i386 Alpine + bash + rustc + cargo
    ├── build.sh                        # docker → ext2 export
    └── manifest.json                   # disk URL + metadata
```

## Local development

```bash
# All tests (no deps):
node --test web/tests/

# Build the workbench bundle (needs npm + network):
node web/build/build-workbench.mjs

# Local dev server with COOP/COEP headers (CheerpX boots successfully):
node web/build/dev-server.mjs 8080
# then open http://localhost:8080

# Build the Alpine + Rust disk image (needs docker + sudo):
./web/disk/build.sh
# produces web/disk/rust-alpine.ext2

# Stage a release-hosted disk into Pages chunks (CI normally does this):
node web/build/stage-pages-disk.mjs
```

## What you should see

A workbench identical to vscode.dev, with a `WebVM bash` terminal pane
already open. The terminal shows a `[rust-web-box] Booting Linux VM…`
status while CheerpX boots; once the VM is ready the message becomes
`Linux VM ready ✓` and bash takes over. Type `cargo run` from
`/workspace` to compile and run the pre-baked Rust hello-world. The
default workspace is a minimal Cargo project with `Cargo.toml` and
`src/main.rs` at the root.

## Component status

See [`docs/architecture.md`](../docs/architecture.md) for the
component-by-component table and the mapping to issue #1's 11
acceptance criteria.
