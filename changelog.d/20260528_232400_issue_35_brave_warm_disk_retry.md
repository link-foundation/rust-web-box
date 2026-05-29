---
bump: patch
---

### Fixed

- Brave users no longer see `WebAssembly.Module(): expected 1 elements on the stack for fallthru` plus `Uncaught TypeError: e is not a function` when a transient GitHub Pages 503 hits a warm-disk chunk. The page now retries 5xx/408/429 and network errors on `.c{6-hex}.txt` chunk fetches with capped exponential backoff and full jitter before CheerpX sees the bytes, so a single bad chunk no longer poisons the JIT (issue #35).
- The boot toast no longer prints `Linux VM failed to boot: undefined` when a CheerpX worker rejects with an opaque error; failures are categorised (disk-503 / wasm-compile / worker-missing-export / network-blocked) and rendered with browser-aware hints (e.g. the Brave V8-JIT workaround for upstream brave-browser#36187).

### Added

- `__rustWebBox.diskDiag.attempts` records the last 50 warm-disk chunk fetch attempts; `__rustWebBox.diagnostics.events` records boot-time `unhandledrejection`/`error` events with their categorisation. Both are intended for the e2e harness and post-mortem inspection.
- Case study at `docs/case-studies/issue-35/` (timeline, root causes RC1–RC5, options table, online research, upstream CheerpX issue draft).
