# disk/

Disk image for the WebVM (CheerpX) runtime.

This directory holds the build script + manifest, **not** the image
itself: the binary is several hundred MB, well over GitHub's regular
repository file limit. CI uploads the full `.ext2` to the rolling
`disk-latest` GitHub Release, then the Pages workflow downloads that
asset server-side and splits it into small same-origin CheerpX
GitHubDevice chunks under `web/disk/`.

Files:

- `Dockerfile.disk` — i386 Alpine base with bash, rustc, cargo, and a
  pre-built hello-world Cargo project so the first `cargo run` works
  offline.
- `build.sh` — converts the Docker image's rootfs into an ext2 image
  CheerpX can mount. Requires Docker + `e2fsprogs` and runs
  `mount -o loop` (sudo).
- `manifest.json` — points the boot shell at the public WebVM Debian
  image by default and records the warm disk release source. The Pages
  staging script fills `warm.url` only after the chunk set exists in the
  artifact.

The default boot path uses CheerpX's hosted Debian image at
`wss://disks.webvm.io/debian_large_…ext2`. It is a fallback for local
development and for deploys where the warm chunks have not been staged
yet.

Do not point browser runtime code directly at the GitHub Release asset.
The release download redirects to `release-assets.githubusercontent.com`
without CORS headers, which makes it unusable for CheerpX's browser-side
XHR/block-device reads. Use `web/build/stage-pages-disk.mjs` to create
the Pages-hosted chunk layout and rewrite `warm.url` instead.
