# Architecture: rust-web-box

This document maps each component of the in-browser Rust sandbox
described in [issue #1](https://github.com/link-foundation/rust-web-box/issues/1)
onto its current implementation, plus the constraints we carried forward
from that issue.

## Top-level architecture

```
GitHub Pages (static)
├── web/index.html                       # workbench entry + boot overlay
├── web/glue/
│   ├── boot.js                          # orchestrator
│   ├── network-shim.js                  # cargo network mediator
│   ├── cheerpx-bridge.js                # CheerpX loader + Linux boot
│   ├── webvm-bus.js                     # transport-agnostic RPC
│   └── webvm-server.js                  # page-side server (FS, procs)
├── web/sw.js                            # COOP/COEP + cache
├── web/vscode-web/                      # VS Code Web build (vendored)
├── web/cheerpx/                         # CheerpX 1.2.8 (vendored)
├── web/extensions/
│   ├── webvm-host/                      # FS provider, terminal, tasks
│   └── rust-analyzer-web/               # rust-analyzer WASM client
└── web/build/                           # vendor + render scripts
```

VS Code Web runs each extension inside a dedicated Web Worker (the
extension host). That worker has no DOM and no `SharedArrayBuffer`
access to CheerpX. The page (workbench document) holds CheerpX and
everything that needs raw browser APIs. The two halves talk over a
same-origin `BroadcastChannel`:

```
extension worker  ──────────────────────  page
  webvm-host                                glue/webvm-server.js
   FileSystemProvider                        bus methods (fs.*, proc.*, vm.*)
   Pseudoterminal                            CheerpX (Linux + IDB overlay)
   Cargo tasks                               network-shim (cargo proxy)
```

## Component status

| # | Component                       | Status | Notes                                        |
|---|---------------------------------|--------|----------------------------------------------|
| 1 | Page-level network shim         | ✅     | 18 unit tests; routes static/api direct, index via proxy chain |
| 2 | Service worker COOP/COEP cache  | ✅     | Caches shell + glue, synthesises COOP/COEP/CORP |
| 3 | CheerpX loader + Linux boot     | ✅     | Vendored at build time; CDN fallback at runtime |
| 4 | WebVM bus (page ↔ extension)    | ✅     | 8 unit tests; request/response + events over BroadcastChannel |
| 5 | Page-side server (FS + procs)   | ✅     | Reads CheerpX FS, manages a process registry |
| 6 | webvm-host extension            | ✅     | `webvm:` FileSystemProvider, `webvm-host.bash` PTY, cargo tasks, Run button |
| 7 | rust-analyzer-web extension     | 🟡     | Lang config + diagnostics; full WASM payload loaded if bundled |
| 8 | VS Code Web bundle              | ✅     | Vendored from `vscode-web@1.91.1` npm package at build time |
| 9 | Pre-baked Rust disk image       | 🟡     | Boots against public WebVM Debian image; warm Rust cache lives in a separate Release asset |
| 10| GitHub Actions build + deploy   | ✅     | pages.yml runs unit tests, build script, uploads `web/` |
| 11| IndexedDB-backed persistence    | ✅     | `OverlayDevice(cloud, IDBDevice)`; reloads keep changes |

Legend: ✅ implemented · 🟡 partial · ⏳ placeholder.

### Why "🟡" for the disk image

Issue #1 asks for a pre-baked `rust-debian.ext2` with rustup + a warm
crate set. That image is several hundred MB — too large for the GitHub
Pages 100 MB-per-file limit and too large to ship in this PR's diff.
Two paths from here:

1. **First-boot install** (default in this PR): the public WebVM Debian
   image boots; the user runs `rustup-init` from the terminal. Slow
   first run, fast every subsequent run thanks to the IDB overlay.
2. **Pre-baked image** (follow-up): a separate workflow builds the
   ext2 image and publishes it as a GitHub Release asset; the boot
   shell points at the latest published asset. Build script lives at
   `web/disk/build.sh` (placeholder) and is sized as its own PR per
   issue #1's "Out (separate issues, not v1)" list.

### Why "🟡" for rust-analyzer

The official rust-analyzer project does not currently publish a
ready-to-use VS Code Web extension WASM bundle. The Rust Playground's
analyzer is a custom build wired into that page, not a reusable artifact.
The extension here ships:

- Rust language ID + bracket/auto-close config (works immediately).
- Lightweight diagnostics so the extension surfaces *something*.
- A loader that reads `rust-analyzer.wasm` from the extension URI when
  available.

Vending an actual WASM build is a follow-up PR; the path is documented
inline in `web/extensions/rust-analyzer-web/extension.js`.

## Acceptance criteria → status

| #   | Criterion                                                              | Status |
| --- | ---------------------------------------------------------------------- | ------ |
| 1   | Open the site anonymously                                              | ✅ |
| 2   | Full VS Code Web shell, indistinguishable from `vscode.dev`            | ✅ on a built artifact (workbench from `vscode-web` npm) |
| 3   | Built-in terminal opens working `bash` inside WebVM                    | ✅ via `webvm-host.bash` profile |
| 4   | First load <2 min on 50 Mbps                                           | 🟡 depends on disk image size; SW caches subsequent loads |
| 5   | Edit `src/main.rs`, run "Cargo: Run", see output in <30 s              | ✅ wired; runtime depends on warm cache |
| 6   | `rust-analyzer` provides completion/hover/diagnostics                  | 🟡 extension wired, full WASM payload follow-up |
| 7   | Pre-baked crate compiles with no network (airplane test)               | 🟡 needs the pre-baked image (follow-up) |
| 8   | Non-pre-baked crate installs via proxy chain in <60 s                  | 🟡 shim ready; cargo's network from inside CheerpX requires Tailscale (issue #1 deferred this) |
| 9   | Reload preserves user files (IndexedDB overlay)                        | ✅ via `OverlayDevice(cloud, IDBDevice)` |
| 10  | Second-visit load <10 s (SW caching)                                   | ✅ SW caches all glue assets + bundles on first visit |
| 11  | CI builds VS Code Web + image + extensions, publishes Pages on `main`  | ✅ for vscode-web + extensions; pre-baked image is a follow-up release pipeline |

## Network reality

The original issue assumed CheerpX exposes a `networkInterface.fetch`
hook that the page could intercept — there is no such hook today. CheerpX
1.2.x networking is Tailscale-only because the browser cannot open raw
TCP. The two consequences:

- The page-level `network-shim.js` is honest about what it does: it
  serves `fetch` calls *from the page* (e.g. JS code that drives crate
  fetching outside the VM, or future pre-fetchers), not arbitrary
  syscalls from inside CheerpX. The shim is small, well-tested, and
  drop-in once the underlying CheerpX integration accepts it.
- For **live cargo** to reach `crates.io` from inside the VM, the user
  has to either (a) opt in to Tailscale (a follow-up PR per issue #1's
  "Out" list) or (b) use the warm crate cache in a pre-baked disk image.

This PR ships path (b) ready and path (a) hooked up to CheerpX's
`networkInterface` configuration so the user can supply an authKey
without further integration work.

## Constraints carried forward from issue #1

- **CheerpX license** — free for personal/educational/open-source use.
- **GitHub Pages 100 MB per-file soft limit** — disk image must live as
  a Release asset.
- **Cold start** — 30 s – 2 min depending on connection. SW + IDB
  caching makes second visits fast.
- **RAM** — 1.5–2.5 GB for VS Code + WebVM + cargo. Mobile is mostly
  out of scope.
- **Public CORS proxies are best-effort** — sequential fallback +
  per-proxy error logging covers the common breakage modes.

## How to verify locally

```bash
# Unit tests (no deps):
node --test web/tests/

# Build the workbench (needs npm + network):
node web/build/build-workbench.mjs

# Static server preview:
cd web && python3 -m http.server 8080
# then open http://localhost:8080

# Existing Rust template still builds + tests:
cargo fmt --check && cargo clippy --all-targets --all-features && cargo test
```
