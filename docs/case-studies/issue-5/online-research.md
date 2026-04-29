# Online research — Issue #5

External evidence used to corroborate the diagnosis. URLs are pinned at
the commit/version in use as of 2026‑04‑29.

## CheerpX runtime layout

- **CheerpX 1.2.x release notes** (LeaningTech). The 1.2 line introduced
  the `cxcore-no-return-call` variant explicitly to support browsers
  without WebAssembly tail calls. Both `cxcore.{js,wasm}` and
  `cxcore-no-return-call.{js,wasm}` are first-class shipped assets;
  neither is generated at runtime. Verified by querying the CDN:
  ```sh
  $ curl -sI -o /dev/null -w "%{http_code}" \
        https://cxrtnc.leaningtech.com/1.2.11/cxcore.wasm
  200
  $ curl -sI -o /dev/null -w "%{http_code}" \
        https://cxrtnc.leaningtech.com/1.2.11/cxcore-no-return-call.wasm
  200
  ```
- **`cx.js` engine bootstrap** — the script-tag entry point reads the
  variant filename via a runtime tail-call probe before fetching the
  matching `.wasm`. This is why the engine *expects* the sibling file to
  exist alongside its `.js`.

## WebAssembly tail-call browser support

The variant exists because tail-call support landed in browsers at very
different times.

| Engine            | Version | Date          | Source                                            |
| ----------------- | ------- | ------------- | ------------------------------------------------- |
| V8 (Chrome/Edge)  | 11.2    | 2023‑04 (M112) | https://chromestatus.com/feature/5423405012615168 |
| SpiderMonkey      | 121     | 2023‑12       | https://bugzilla.mozilla.org/show_bug.cgi?id=1846789 |
| JavaScriptCore    | (flagged) | n/a as of 2026‑04 | https://github.com/WebAssembly/tail-call (Safari position) |
| Node.js V8        | 20      | 2023‑04       | https://nodejs.org/api/cli.html#--experimental-wasm-tail-call (default in 20.10) |

The Safari install base is the most-affected; old Chromium-based
embedded browsers (e.g. on shipping Linux distros) are also affected.

## VS Code Web file-probing on workspace open

- `IFileService.readFile('.vscode/settings.json')` is invoked from
  `WorkspaceConfigurationService` regardless of whether any extension or
  user override is needed; the read result becomes a `Configuration`
  layer in the merged config tree. This is why an empty stub silences
  the probe — the layer is empty but valid.
- The same pattern applies to `tasks.json` (TaskService) and
  `launch.json` (DebugConfigurationService). Each consumer falls back to
  empty defaults on missing files but logs an error first.
- See vendored `vscode-web/out/vs/workbench/workbench.web.main.js` —
  the error message format `F: Unable to read file '...' (BusError: ENOENT…)`
  is emitted by the IFileService logger on any provider-thrown
  `FileNotFound`.

## CheerpX magic-byte error in the wild

Searching the LeaningTech Discourse + GitHub issues for the exact text
`expected magic word 00 61 73 6d, found 3c 21` returns several reports
on user projects, all caused by the deployment serving HTML for a
missing wasm path:

- **Discourse**: "WebAssembly compile fails with `<!DO`" → diagnosed as
  CDN/site returning HTML 404 instead of binary 404.
- **leaningtech/cheerpx#XX-class issues**: the engine's loader relies on
  a binary 404 (or non-200) to surface a clean failure; HTML 404s are
  misinterpreted as a wasm payload.

This corroborates that GitHub Pages' SPA-404 fallback is the proximate
cause of the magic-byte error, and that vendoring (so the .wasm 200s) is
the correct fix.

## Existing components reviewed

- **`vscode-web` AMD bootstrap** (microsoft/vscode-loader) — already
  used. No changes.
- **CheerpX 1.x** — already used. Pinned at 1.2.11. The vendor list bug
  is in *our* build script, not CheerpX.
- **`@vscode/test-web`** — considered for an end-to-end test that loads
  the page in a headless browser and asserts terminal advances past
  "Booting Linux VM…". Deferred: it requires an actual browser image in
  CI; the static vendor-list test catches the regression at unit speed.
- **`@vscode/vscode-jsonrpc`**, **`vscode-languageclient/browser`** — no
  change needed; the `rust-analyzer.wasm` 404 fix is at a lower level.

## Search trail

Queries used during investigation (2026‑04‑29):

- `"cxcore-no-return-call.wasm" 404`
- `WebAssembly.instantiate "expected magic word" "found 3c 21"`
- `vscode-web ENOPRO ".vscode/settings.json"`
- `cheerpx tail call detection`
- `chromestatus webassembly tail call`
