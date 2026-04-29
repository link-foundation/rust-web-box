---
bump: minor
---

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.
