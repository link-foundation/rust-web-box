# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.
