# Architecture: rust-web-box

This document tracks the implementation of the in-browser Rust sandbox
described in [issue #1](https://github.com/link-foundation/rust-web-box/issues/1).
It complements that issue rather than restating it: the issue captures the
*goal* and the *verified findings*; this document tracks the *current state*
and the *path from here to v1*.

## Top-level architecture

```
GitHub Pages (static)
├── web/index.html                       # boot shell  ✅ in repo
├── web/glue/                            # network shim, FS bridge   ✅ shim only
├── web/sw.js                            # Service Worker            ✅ skeleton
├── web/vscode-web/                      # full VS Code Web build   ⏳ placeholder
├── web/extensions/webvm-host/           # FS + terminal extension  ⏳ placeholder
├── web/extensions/rust-analyzer-web/    # rust-analyzer WASM       ⏳ placeholder
├── web/cheerpx/                         # CheerpX engine            ⏳ placeholder
└── web/disk/                            # rust-debian.ext2 manifest ⏳ placeholder
```

Legend:

- ✅ implemented in this repo at the level needed to verify the design
- 🟡 partial — interface defined, implementation incomplete
- ⏳ placeholder only — directory and README in place, code not written

## Component status

### 1. Page-level network shim — ✅

The architecture assumes `cargo` inside CheerpX cannot open raw TCP, so its
network calls are intercepted and re-issued from the page using `fetch`.
`web/glue/network-shim.js` implements this.

Routing rules, derived from CORS-headers verified against live origins (see
issue #1 → "Why this is feasible"):

| Host                  | Route        | Reason                                       |
| --------------------- | ------------ | -------------------------------------------- |
| `static.crates.io`    | direct fetch | CORS-open, serves crate tarballs             |
| `crates.io` (api)     | direct fetch | CORS-open, serves the JSON API               |
| `index.crates.io`     | proxy chain  | sparse index does not send CORS headers      |
| anything else         | blocked      | Tailscale opt-in is a future issue           |

The proxy chain (in fallback order, by measured latency):

1. `https://cors.eu.org/` — fastest (~470 ms in issue #1's test)
2. `https://api.codetabs.com/v1/proxy/?quest=…` — ~580 ms
3. `https://api.allorigins.win/raw?url=…` — works but ~12 s

Tests in `web/tests/network-shim.test.mjs` cover routing, fallback ordering,
short-circuit on first success, error aggregation, init-forwarding, and
the blocked-host failure mode. Run with `node --test web/tests/`.

### 2. Service worker — 🟡

`web/sw.js` is wired up but does two things at a draft level:

- Caches the static shell on install. Once VS Code Web and CheerpX are
  vendored, the cache list expands to include them so second-visit load
  meets the <10 s acceptance criterion.
- Synthesizes `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` on same-origin responses.
  GitHub Pages doesn't set those headers, but CheerpX's threaded path
  needs `SharedArrayBuffer`, which needs cross-origin isolation.

This follows the well-known SW-shim pattern used by `webcontainer.io`. The
header values are static; once we have cross-origin assets (e.g. CheerpX
hosted on an LT CDN) we'll need to opt them in via the `?coep` query
hack or proxy them through.

### 3. CheerpX runtime — ⏳

Not vendored yet. Open question 2 in issue #1: vendored vs LT-hosted CDN.
Expected interface from the page:

```js
const cx = await CheerpX.Linux.create({
  mounts: [
    { type: 'ext2', path: '/', dev: 'rust-debian.ext2' },
    { type: 'idbkv', path: '/workspace' },  // persistence overlay
  ],
  networkInterface: { fetch: vmFetch },     // <- our shim
});
await cx.run('/bin/bash', ['-l'], { ... });
```

### 4. WebVM disk image — ⏳

Pre-baked `rust-debian.ext2` with rustup + the warm crate set listed in
issue #1. The image is multi-hundred-MB and cannot live on GitHub Pages
(~100 MB per-file soft limit), so it ships as a Release asset. `web/disk/`
will hold the build script and a manifest pointing the boot shell at the
latest published image.

### 5. VS Code Web bundle — ⏳

Static build of `microsoft/vscode` at the `web` target. The CI will:

1. Clone `microsoft/vscode` at a pinned tag (open question 1 in issue #1).
2. Run `yarn` and `yarn gulp vscode-web-min`.
3. Copy the build output into `web/vscode-web/`.
4. Patch `product.json` to preinstall our two web extensions.

Pinning a specific upstream tag is mandatory because the web-extension API
isn't frozen between releases.

### 6. `webvm-host` web extension — ⏳

The extension that bridges VS Code to CheerpX. Four pieces, in order of
implementation:

1. `FileSystemProvider` with the `webvm:` URI scheme. Powers Explorer,
   search, and editor tabs.
2. `Pseudoterminal` over CheerpX bash. Wires `handleInput` to stdin,
   `setDimensions` to `TIOCSWINSZ`, exit codes to `onDidClose`. Uses
   `postMessage` + transferable `ArrayBuffer`s for the byte streams across
   the page <-> Web Worker boundary.
3. Tasks: `cargo run`, `cargo build`, `cargo test`, `cargo add`, `cargo new`.
4. Status-bar Run button bound to `cargo run --release`.

### 7. `rust-analyzer` WASM web extension — ⏳

Same artifact the Rust Playground uses, packaged as a VS Code web
extension. Drops in via LSP-over-postMessage; entirely client-side.

### 8. Workspace persistence — ⏳

CheerpX's IndexedDB-backed overlay for user files. VS Code's own
`globalState` / `workspaceState` already use standard browser storage.

## Acceptance criteria → status

| #   | Criterion                                                              | Status |
| --- | ---------------------------------------------------------------------- | ------ |
| 1   | Open the site anonymously                                              | ✅ shell loads |
| 2   | Full VS Code Web shell, indistinguishable from `vscode.dev`            | ⏳ pending bundle |
| 3   | Built-in terminal opens working `bash` inside WebVM                    | ⏳ pending CheerpX + extension |
| 4   | First load <2 min on 50 Mbps                                           | ⏳ pending bundle/disk |
| 5   | Edit `src/main.rs`, run "Cargo: Run", see output in <30 s              | ⏳ pending tasks impl |
| 6   | `rust-analyzer` provides completion/hover/diagnostics                  | ⏳ pending RA extension |
| 7   | Pre-baked crate compiles with no network (airplane test)               | ⏳ pending warm cache |
| 8   | Non-pre-baked crate installs via proxy chain in <60 s                  | 🟡 shim ready, no e2e |
| 9   | Reload preserves user files (IndexedDB overlay)                        | ⏳ pending CheerpX |
| 10  | Second-visit load <10 s (SW caching)                                   | 🟡 SW skeleton present |
| 11  | CI builds VS Code Web + image + extensions, publishes Pages on `main`  | 🟡 Pages deploy in place; build steps not yet wired |

## Constraints carried forward from issue #1

- **CheerpX license** — free for personal/educational/open-source use;
  verify with Leaning Technologies before publishing widely.
- **Cold start** — 30 s – 2 min depending on connection. SW + IndexedDB
  caching makes second visits fast.
- **RAM** — budget 1.5–2.5 GB for VS Code + WebVM + cargo. Mobile is
  mostly out of scope.
- **Public CORS proxies are best-effort** — they break, get rate-limited,
  or disappear. The shim fails over sequentially and reports per-proxy
  errors; the in-page boot shell will surface this clearly when the chain
  empties.
- **GitHub Pages 100 MB per-file soft limit** — disk image must live as a
  Release asset.

## What this PR includes

- `web/` directory with the static shell, network shim, service worker,
  and placeholder READMEs for every directory the architecture calls for.
- `web/tests/network-shim.test.mjs` — 11 tests of the shim's routing and
  proxy-fallback behaviour, runnable with `node --test`.
- `.github/workflows/pages.yml` — runs the shim tests, packages `web/`,
  and deploys to GitHub Pages on push to `main`.
- This document.

What it deliberately does **not** include: the VS Code Web bundle,
CheerpX, the disk image, and either web extension. Each is a substantial
project on its own and is tracked as a separate placeholder above with a
README describing its expected build pipeline.
