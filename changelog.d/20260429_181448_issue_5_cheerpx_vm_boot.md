---
bump: patch
---

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).
