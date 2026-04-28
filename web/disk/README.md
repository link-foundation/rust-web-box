# disk/

Disk image for the WebVM (CheerpX) runtime.

This directory holds the build script + manifest, **not** the image
itself: the binary is several hundred MB and GitHub Pages enforces a
~100 MB per-file soft limit, so the image is uploaded to GitHub Releases
(or a similar CDN) and fetched at runtime.

Files:

- `Dockerfile.disk` — Debian Bookworm slim base, rustup stable, plus a
  warm crate set (`serde`, `tokio`, `anyhow`, `clap`, `regex`, etc.) so
  first-build is fast and works fully offline.
- `build.sh` — converts the Docker image's rootfs into an ext2 image
  CheerpX can mount. Requires Docker + `e2fsprogs` and runs
  `mount -o loop` (sudo).
- `manifest.json` — points the boot shell at either the public WebVM
  Debian image (default) or a pre-baked rust-debian.ext2 (when published).

The default boot path uses CheerpX's hosted Debian image at
`wss://disks.webvm.io/debian_large_…ext2`. Users install Rust on first
boot via `curl https://sh.rustup.rs | sh`. The IndexedDB overlay
preserves their toolchain across reloads.

Switching to the pre-baked image is a follow-up workflow: build with
`web/disk/build.sh`, upload to a GitHub Release, then fill the `warm`
entry of `manifest.json` and bump the build's `cheerpx-bridge.js`
default URL.

Warm crate set (target): `serde`, `serde_json`, `tokio`, `anyhow`,
`clap`, `regex`, `rand`, `reqwest`, `chrono`, `itertools`, `rayon`,
`thiserror`, `tracing`, `bytes`, `futures`, `log`, `env_logger`, `uuid`,
`once_cell`, `parking_lot`.
