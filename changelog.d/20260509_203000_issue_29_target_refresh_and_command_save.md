---
bump: patch
---

### Fixed
- Refreshed `target/` metadata from the WebVM on demand when VS Code reads target directories, so Cargo build artifacts can be expanded in the Explorer without scanning the full build tree after every prompt.
- Saved dirty VS Code editor buffers before forwarding terminal Enter or Cargo task commands, so the next real `cargo run` uses the latest editor content.

### Added
- Regression coverage for scoped target snapshots, on-demand target directory refreshes, and edited-source `cargo run --release` e2e verification.
