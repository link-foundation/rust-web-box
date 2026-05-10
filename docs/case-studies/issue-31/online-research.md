# Online Research

Date: 2026-05-10

## Sources

- CheerpX filesystem documentation: https://cheerpx.io/docs/guides/File-System-support
  - CheerpX exposes a virtual Unix-style filesystem with mount points.
  - `IDBDevice` is the persistent read-write backing store.
  - `OverlayDevice` combines an initial ext2 image with a persistent writable overlay.
- CheerpX Linux API reference: https://cheerpx.io/docs/reference/CheerpX.Linux
  - `CheerpX.Linux.run` executes commands inside the Linux environment.
  - `setCustomConsole` is the documented hook for custom command output handling.
- Cargo profiles: https://doc.rust-lang.org/cargo/reference/profiles.html
  - `cargo run` uses the `dev` profile by default.
  - The default dev profile includes full debug info and incremental compilation unless overridden.
  - The `debug` setting controls `-C debuginfo`; `debug = 0` emits no debug information.
  - `incremental = false` reduces incremental cache writes under `target`.
- Cargo configuration: https://doc.rust-lang.org/cargo/reference/config.html
  - Profile settings can be supplied in config files or through `CARGO_PROFILE_<name>_*` environment variables.
  - `profile.<name>.debug` maps to `CARGO_PROFILE_<name>_DEBUG`.
- Cargo build cache: https://doc.rust-lang.org/cargo/reference/build-cache.html
  - Cargo stores build outputs under profile directories like `target/debug`.
  - Cargo's internal build directories include `debug/deps`, `debug/incremental`, and related files. The layout is internal and can change.

## Findings

The failure path matches a CheerpX writable-overlay stress case rather than a Cargo semantic error. The published disk already pre-bakes debug and release artifacts so the first `cargo run` can use Cargo's up-to-date path. After `src/main.rs` changes, Cargo correctly enters a real dev rebuild. That rebuild writes debug-profile artifacts under the CheerpX OverlayDevice-backed `/workspace/target`, and the live browser eventually exits with code 71.

Cargo gives us a supported way to keep plain `cargo run` while reducing browser rebuild churn: pre-bake and run the workspace with a lean dev profile. The fix uses `debug = 0`, `codegen-units = 1`, and `incremental = false` for the dev profile. This keeps the command real and still uses the dev profile, but it avoids full debuginfo output and reduces generated object-file fanout for the tiny starter crate.

The runtime cannot blindly export those profile variables against the old published disk. A live probe showed that setting `CARGO_PROFILE_DEV_DEBUG=0` on the old disk invalidates the existing pre-bake and makes the first `cargo run` crash sooner. The page therefore applies the profile variables only after detecting matching settings in `/root/.cargo/config.toml`; the disk-image workflow now builds and e2e-tests a disk with those settings.
