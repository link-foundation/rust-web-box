#!/usr/bin/env bash
# Build the rust-debian.ext2 disk image used by the CheerpX runtime.
#
# Output: web/disk/rust-debian.ext2
#
# This script is invoked by CI (or manually). The output is uploaded as
# a GitHub Release asset and referenced from web/disk/manifest.json. We
# do not commit the binary itself because GitHub Pages rejects files
# above ~100 MB and the image is several hundred MB.
#
# Requirements: docker, e2fsprogs (mkfs.ext2 + tune2fs).

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMG="$HERE/rust-debian.ext2"
SIZE_MB="${IMG_SIZE_MB:-1024}"

echo "==> building docker image (rust-web-box-disk)"
docker buildx build \
  -f "$HERE/Dockerfile.disk" \
  -t rust-web-box-disk \
  --load \
  "$ROOT"

echo "==> exporting container filesystem"
CID=$(docker create rust-web-box-disk /bin/true)
TARFILE="$(mktemp -d)/rootfs.tar"
docker export "$CID" -o "$TARFILE"
docker rm "$CID" >/dev/null

echo "==> creating ${SIZE_MB} MiB ext2 image"
rm -f "$IMG"
truncate -s "${SIZE_MB}M" "$IMG"
mkfs.ext2 -F -L rust-web-box "$IMG" >/dev/null

echo "==> populating image (requires loopback mount)"
MOUNT="$(mktemp -d)"
sudo mount -o loop "$IMG" "$MOUNT"
trap 'sudo umount "$MOUNT" || true; rmdir "$MOUNT" || true; rm -rf "$(dirname "$TARFILE")"' EXIT
sudo tar -xf "$TARFILE" -C "$MOUNT"
sudo umount "$MOUNT"
trap - EXIT

echo "==> done: $IMG ($(du -h "$IMG" | cut -f1))"
