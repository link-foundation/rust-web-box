#!/usr/bin/env bash
# Build the rust-alpine.ext2 disk image used by the CheerpX runtime.
#
# Output: web/disk/rust-alpine.ext2
#
# This script is invoked by CI (or manually). The output is uploaded as
# a GitHub Release asset. The Pages workflow downloads that release
# asset server-side, splits it into CheerpX GitHubDevice chunks, and
# deploys the chunks with the static site. We do not commit the binary
# itself because GitHub blocks regular repository files above 100 MiB
# and the image is several hundred MB.
#
# Requirements: docker (with buildx), e2fsprogs (mkfs.ext2 + tune2fs),
#               sudo for the loopback mount step.
#
# Environment variables:
#   IMG_SIZE_MB      ext2 image size in MiB (default 1024)
#   IMG_NAME         output basename (default rust-alpine.ext2)
#   PLATFORM         buildx --platform value (default linux/386)

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMG_NAME="${IMG_NAME:-rust-alpine.ext2}"
IMG="$HERE/$IMG_NAME"
SIZE_MB="${IMG_SIZE_MB:-1024}"
PLATFORM="${PLATFORM:-linux/386}"

echo "==> building docker image (rust-web-box-disk, $PLATFORM)"
docker buildx build \
  --platform="$PLATFORM" \
  -f "$HERE/Dockerfile.disk" \
  -t rust-web-box-disk \
  --load \
  "$ROOT"

echo "==> exporting container filesystem"
CID=$(docker create --platform="$PLATFORM" rust-web-box-disk /bin/true)
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

# Shrink the image to the minimum filesystem size before upload. Pages
# later stages this file as raw chunks, so sparse free space would become
# real artifact bytes if we left the initial allocation intact.
e2fsck -fy "$IMG" >/dev/null || true
resize2fs -M "$IMG" >/dev/null
e2fsck -fy "$IMG" >/dev/null || true

echo "==> done: $IMG ($(du -h "$IMG" | cut -f1))"
