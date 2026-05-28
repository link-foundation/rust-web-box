---
bump: patch
---

### Fixed

- Confirmed the in-browser build is real (a genuine `rustc`/`cargo` invocation inside the CheerpX x86 Linux VM, not a faked transcript) and documented the proof in `docs/case-studies/issue-33/`.
- Removed the injected per-command branding (`This binary was compiled inside CheerpX.` / `Compiled by Rust inside the browser via CheerpX.`) that made a real build look faked, and made the prebuilt disk binary and the editable workspace seed byte-for-byte identical to the canonical `cargo new` program so the first run matches every later run.
- Migrated existing browser workspaces that still hold the untouched branded seed to the plain `cargo new` program on next open, while preserving any user edits.

### Changed

- The disk-image smoke test and workspace/boot unit tests now assert the plain `Hello, world!` greeting and the absence of the removed branding.
- Browser e2e Stage C/D assert the greeting printed by `cargo run` equals the literal in the source on disk (a stronger anti-fake check) on disks built from current source, while staying version-independent against the still-published warm disk.
