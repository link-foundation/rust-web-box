# disk/

Disk image for the WebVM (CheerpX) runtime.

This directory holds the build script + manifest, **not** the image
itself: the binary is several hundred MB, well over GitHub's regular
repository file limit. CI uploads the full `.ext2` to the rolling
`disk-latest` GitHub Release, then the Pages workflow downloads that
asset server-side and splits it into small same-origin CheerpX
GitHubDevice chunks under `web/disk/`.

Files:

- `Dockerfile.disk` — i386 Alpine base with bash, tree, rustc, cargo,
  and a pre-built hello-world Cargo project rooted at `/workspace` so
  the first `cargo run` works offline.
- `build.sh` — converts the Docker image's rootfs into an ext2 image
  CheerpX can mount. Requires Docker + `e2fsprogs` and runs
  `mount -o loop` (sudo).
- `manifest.json` — records the public WebVM Debian development
  fallback and the warm disk release source. The Pages staging script
  fills `warm.url` only after the chunk set exists in the artifact; a
  production Pages build now fails if the warm disk cannot be staged.

The committed default path still references CheerpX's hosted Debian
image at `wss://disks.webvm.io/debian_large_...ext2`, but that path is
only a development fallback. Production Pages staging must publish the
same-origin warm disk chunks so `tree`, `cargo`, and the root Cargo
workspace are available by default.

Do not point browser runtime code directly at the GitHub Release asset.
The release download redirects to `release-assets.githubusercontent.com`
without CORS headers, which makes it unusable for CheerpX's browser-side
XHR/block-device reads. Use `web/build/stage-pages-disk.mjs` to create
the Pages-hosted chunk layout and rewrite `warm.url` instead.
