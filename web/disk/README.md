# disk/

The Debian + Rust disk image (`rust-debian.ext2`) does not ship in this
directory. GitHub Pages has a per-file soft limit of ~100 MB, so the image
will be hosted as a Release asset (or external CDN) and fetched at runtime.

This directory exists to hold:

- The build script that produces `rust-debian.ext2` (Debian Bookworm slim
  base + rustup stable + the warm crate set listed in issue #1).
- A manifest pointing the boot shell at the latest released image URL.

Both are **not implemented yet.**

Warm crate set (target): `serde`, `serde_json`, `tokio`, `anyhow`, `clap`,
`regex`, `rand`, `reqwest`, `chrono`, `itertools`, `rayon`, `thiserror`,
`tracing`, `bytes`, `futures`, `log`, `env_logger`, `uuid`, `once_cell`,
`parking_lot`.
