# extensions/rust-analyzer-web/

VS Code Web extension that contributes Rust language support, with a
hook for the rust-analyzer WASM language server.

Ships:

- `rust` language ID, `.rs` extension binding, bracket and auto-close
  configuration via `language-configuration.json`.
- A loader that reads `rust-analyzer.wasm` from the extension URI when
  CI bundles it. While the WASM artifact isn't bundled, the extension
  still contributes lightweight diagnostics so the channel is wired and
  the editor surfaces meaningful feedback.

Vendoring the official rust-analyzer WASM build (and switching the
extension over to the full LSP wiring) is a follow-up: the rust-analyzer
project does not currently publish a ready-to-use VS Code Web
distribution, so the artifact has to be built from source.
