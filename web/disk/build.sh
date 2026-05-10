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
#   IMG_FREE_MB      free MiB preserved after shrinking (default 128)
#   IMG_NAME         output basename (default rust-alpine.ext2)
#   PLATFORM         buildx --platform value (default linux/386)

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMG_NAME="${IMG_NAME:-rust-alpine.ext2}"
IMG="$HERE/$IMG_NAME"
SIZE_MB="${IMG_SIZE_MB:-1024}"
FREE_MB="${IMG_FREE_MB:-128}"
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
# later stages this file as raw chunks, so sparse free space becomes real
# artifact bytes if we leave the initial allocation intact. After the
# shrink, grow by a small reserve so edited `cargo run` has room to write
# fresh debug artifacts inside the guest filesystem.
e2fsck -fy "$IMG" >/dev/null || true
resize2fs -M "$IMG" >/dev/null
e2fsck -fy "$IMG" >/dev/null || true
if [ "$FREE_MB" -gt 0 ]; then
  echo "==> reserving ${FREE_MB} MiB writable filesystem space"
  current_bytes="$(stat -c %s "$IMG")"
  truncate -s "$((current_bytes + FREE_MB * 1024 * 1024))" "$IMG"
  resize2fs "$IMG" >/dev/null
  e2fsck -fy "$IMG" >/dev/null || true
fi

echo "==> done: $IMG ($(du -h "$IMG" | cut -f1))"
