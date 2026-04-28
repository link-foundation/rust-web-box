# extensions/rust-analyzer-web/

VS Code web extension that runs `rust-analyzer.wasm` as a language server
entirely client-side, no involvement from the VM.

**Not implemented yet.** This is the same WASM artifact the Rust Playground
uses. Packaging it as a VS Code web extension gives completion, hover,
go-to-def, rename, and diagnostics without round-tripping to CheerpX, which
keeps the edit-time UX responsive.
