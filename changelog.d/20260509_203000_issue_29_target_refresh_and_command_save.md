---
bump: patch
---

### Fixed
- Refreshed `target/` metadata from the WebVM on demand when VS Code reads target directories, so Cargo build artifacts can be expanded in the Explorer without scanning the full build tree after every prompt.
- Saved dirty VS Code editor buffers before forwarding terminal Enter or Cargo task commands, so the next real `cargo run` uses the latest editor content.
- Marked saved Rust/Cargo inputs newer than existing target artifacts, with a fingerprint invalidation fallback, so warm-disk Cargo runs rebuild after browser-side edits.

### Added
- Regression coverage for scoped target snapshots, on-demand target directory refreshes, and edited-source `cargo run` e2e verification.
