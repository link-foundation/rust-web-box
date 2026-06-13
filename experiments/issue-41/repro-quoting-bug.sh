#!/usr/bin/env bash
# Issue #41 — reproduce the CI failure the quoting fix addresses.
#
# This runs the smoke-test step EXACTLY as it was committed at b52fcd2 (the
# buggy version) through the same sandbox verify-quoting.sh uses, and shows it
# fails with a FALSE "issue #41 fix regressed" + exit 1 even though every
# binary in the (fake) image is correctly lld-linked. That false failure is
# the CI red the fix turns green.
#
# We extract the buggy text from git rather than inlining it, so the
# problematic apostrophe stays as data and never has to be escaped here (which
# would hide the very bug we are reproducing).
set -u

BUGGY_REV="b52fcd2"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

note() { printf '\n=== %s ===\n' "$1"; }

# 1. Pull the buggy smoke-test run block straight out of the commit.
git -C "$REPO_ROOT" show "$BUGGY_REV:.github/workflows/disk-image.yml" > "$WORK/buggy.yml"
python3 - "$WORK/buggy.yml" > "$WORK/runblock.sh" <<'PY'
import sys, yaml
doc = yaml.safe_load(open(sys.argv[1]))
for s in doc['jobs']['build']['steps']:
    if str(s.get('name', '')).startswith('Smoke-test the image'):
        sys.stdout.write(s['run']); break
else:
    sys.exit('smoke-test step not found')
PY

note "buggy run block contains the apostrophe (the root cause)"
grep -n "lld's" "$WORK/runblock.sh" && echo "-> apostrophe present in the single-quoted chroot body"

# 2. Same stubs as verify-quoting.sh: a fake mounted image whose binaries are
#    all correctly lld-linked. A correct guard MUST pass on this input.
cat > "$WORK/stubs.sh" <<'STUBS'
sudo() { while [ "${1:-}" = "-E" ] || [ "${1:-}" = "-n" ]; do shift; done; "$@"; }
cp()   { : > "${@: -1}"; }
mount() {
  local mnt="${@: -1}"
  mkdir -p "$mnt/workspace/src" "$mnt/workspace/target/release" \
           "$mnt/workspace/target/debug/.fingerprint" "$mnt/usr/bin" "$mnt/bin"
  printf 'fn main(){}\n' > "$mnt/workspace/src/main.rs"
  printf '[package]\n'    > "$mnt/workspace/Cargo.toml"
  local x
  for x in usr/bin/cargo usr/bin/tree bin/bash; do
    printf '#!/bin/sh\n' > "$mnt/$x"; chmod +x "$mnt/$x"
  done
  printf 'LLDMARK\n' > "$mnt/workspace/target/release/hello"; chmod +x "$mnt/workspace/target/release/hello"
  printf 'LLDMARK\n' > "$mnt/workspace/target/debug/hello";   chmod +x "$mnt/workspace/target/debug/hello"
}
umount() { :; }
chroot() {
  local mnt="$1"; shift; local body=""
  while [ $# -gt 0 ]; do [ "$1" = "-lc" ] && { body="$2"; break; }; shift; done
  printf '%s' "$body" > "$CHROOT_BODY_FILE"
  printf 'LLDMARK\n' > "$mnt/workspace/target/debug/hello"   # rebuild IS lld-linked
}
readelf() {
  local f="${@: -1}"
  echo "String dump of section '.comment':"
  if grep -q LLDMARK "$f" 2>/dev/null; then echo "  Linker: LLD 17.0.6"; fi
  echo "  GCC: (Alpine 13.2.1) 13.2.1"
}
STUBS

# 3. Run from a clean dir so the relative path `target/debug/hello` in the
#    LEAKED guard code resolves to nothing — exactly as it does on the runner
#    (cwd = repo root, which has no target/debug/hello).
export CHROOT_BODY_FILE="$WORK/chroot-body.txt"
cd "$WORK"
set +e
bash -c 'source "$1"; source "$2"' _ "$WORK/stubs.sh" "$WORK/runblock.sh" > "$WORK/run.out" 2>&1
rc=$?
set -e

note "result of running the BUGGY step against an all-lld-linked image"
sed 's/^/    /' "$WORK/run.out"
echo "    exit=$rc"

note "diagnosis"
if grep -q 'cargo check' "$WORK/chroot-body.txt"; then
  echo "UNEXPECTED: chroot body was complete — bug did not reproduce"
  exit 2
fi
echo "- chroot body was TRUNCATED at the apostrophe (no 'cargo check' guard present)"
if [ "$rc" -ne 0 ] && grep -q 'regressed' "$WORK/run.out"; then
  echo "- step exited $rc with a FALSE 'regressed' message, despite every binary being lld-linked"
  echo
  echo "BUG REPRODUCED — this is the CI failure on PR #42 (build-disk run 27467245451)."
  echo "verify-quoting.sh confirms the fixed step passes the same sandbox."
else
  echo "bug did NOT reproduce (rc=$rc) — unexpected"
  exit 2
fi
