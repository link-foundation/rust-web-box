#!/usr/bin/env bash
# Issue #41 — verify the disk-image.yml smoke-test lld guard is correctly quoted.
#
# THE BUG (commit b52fcd2, fixed here)
# -----------------------------------
# The smoke-test step runs the in-VM checks inside a single-quoted chroot:
#
#     sudo chroot "$MNT" /bin/bash -lc '
#       ... cargo run / edit / rebuild ...
#       # so assert that binary carries lld's signature: lld stamps ...
#       comment=$(readelf -p .comment target/debug/hello ...)
#       ... | grep -qi '\''LLD'\'' || (echo "...regressed" && exit 1)
#     '
#
# The apostrophe in the comment word "lld's" CLOSES the single-quoted string
# early. Everything after it ran in the OUTER runner shell, where
# `target/debug/hello` is a relative path that does not exist (cwd = repo
# root). readelf returned nothing, grep found no "LLD", and the guard printed
# a FALSE "issue #41 fix regressed" and exited 1 — even though the binary on
# the image was correctly lld-linked. CI log build-disk-27467245451 lines
# 917-920 are exactly this: edited output, a blank line, "regressed", exit 1.
#
# THE FIX
# -------
# Remove the in-chroot readelf guard (deleting the apostrophe), and run the
# guard on the HOST after the chroot, using the runner's native readelf
# against the mounted image. The chroot body is now apostrophe-free, so the
# single-quoted string spans the intended lines.
#
# This script proves the fix four ways, all re-runnable on any Linux host:
#   1. `bash -n` parses the real extracted run block (no unterminated string).
#   2. The chroot single-quoted body contains no apostrophe (the exact
#      property whose violation caused the bug).
#   3. Sandboxed execution of the real run block (external commands stubbed)
#      proves control flow: the chroot receives the FULL body, the host-side
#      guard runs readelf for BOTH binaries, the block exits 0 on lld
#      binaries and exits 1 when a binary is not lld-linked.
#   4. Real readelf on real linker output (GNU ld vs lld) classifies
#      .comment correctly — the guard's underlying logic is sound.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
YML="$REPO_ROOT/.github/workflows/disk-image.yml"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

note() { printf '\n=== %s ===\n' "$1"; }
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; exit 1; }

# ---------------------------------------------------------------------------
# Extract the smoke-test step's `run:` script with a real YAML parser, so we
# test the exact bytes CI executes — not a hand-copied approximation.
# ---------------------------------------------------------------------------
python3 - "$YML" > "$WORK/runblock.sh" <<'PY'
import sys, yaml
doc = yaml.safe_load(open(sys.argv[1]))
for s in doc['jobs']['build']['steps']:
    if str(s.get('name', '')).startswith('Smoke-test the image'):
        sys.stdout.write(s['run'])
        break
else:
    sys.exit('smoke-test step not found in disk-image.yml')
PY
[ -s "$WORK/runblock.sh" ] || fail "could not extract smoke-test run block"

# ---------------------------------------------------------------------------
# 1. Syntax check. An apostrophe that re-opened an unbalanced string would
#    surface here as "unexpected EOF while looking for matching quote".
# ---------------------------------------------------------------------------
note "1. bash -n syntax check"
if bash -n "$WORK/runblock.sh" 2>"$WORK/syntax.err"; then
  pass "run block parses cleanly"
else
  cat "$WORK/syntax.err"; fail "bash -n reported a syntax error"
fi

# ---------------------------------------------------------------------------
# 2. The chroot single-quoted body must contain no apostrophe. This is the
#    precise invariant the bug violated.
# ---------------------------------------------------------------------------
note "2. chroot body apostrophe check"
python3 - "$WORK/runblock.sh" <<'PY'
import sys, re
src = open(sys.argv[1]).read()
# chroot opens with `-lc '` at end of a line and closes with a line that is
# only whitespace + a lone apostrophe.
m = re.search(r"-lc '\n(.*?)\n[ \t]*'\n", src, re.S)
if not m:
    sys.exit("FAIL  could not locate the chroot -lc '...' body")
body = m.group(1)
if "'" in body:
    i = body.index("'")
    ctx = body[max(0, i-45):i+45].replace("\n", "\\n")
    sys.exit("FAIL  apostrophe inside chroot body near: ...%s..." % ctx)
print("PASS  chroot body is apostrophe-free (%d lines)" % (body.count("\n") + 1))
PY

# ---------------------------------------------------------------------------
# 3. Sandboxed execution of the REAL run block. We stub every external
#    command the step calls (sudo/mount/umount/chroot/cp/readelf), populate a
#    fake mounted image, and run the block verbatim. This exercises the
#    actual shell control flow: if the apostrophe bug were present, the
#    host-side guard would not run (it would be absorbed into the chroot
#    string) and the chroot body would be truncated.
# ---------------------------------------------------------------------------
note "3. sandboxed execution of the real run block"

cat > "$WORK/stubs.sh" <<'STUBS'
# --- stubs: intercept the external commands the smoke step shells out to ---
sudo() { while [ "${1:-}" = "-E" ] || [ "${1:-}" = "-n" ]; do shift; done; "$@"; }

cp() { : > "${@: -1}"; }                       # pretend we copied the .ext2

mount() {                                       # populate the "mounted" image
  local mnt="${@: -1}"
  mkdir -p "$mnt/workspace/src" "$mnt/workspace/target/release" \
           "$mnt/workspace/target/debug/.fingerprint" "$mnt/usr/bin" "$mnt/bin"
  printf 'fn main(){}\n' > "$mnt/workspace/src/main.rs"
  printf '[package]\n'    > "$mnt/workspace/Cargo.toml"
  local x
  for x in usr/bin/cargo usr/bin/tree bin/bash; do
    printf '#!/bin/sh\n' > "$mnt/$x"; chmod +x "$mnt/$x"
  done
  printf 'LLDMARK\n' > "$mnt/workspace/target/release/hello"
  chmod +x "$mnt/workspace/target/release/hello"
  printf 'LLDMARK\n' > "$mnt/workspace/target/debug/hello"
  chmod +x "$mnt/workspace/target/debug/hello"
}
umount() { :; }

chroot() {                                      # record the body; simulate rebuild
  local mnt="$1"; shift
  local body=""
  while [ $# -gt 0 ]; do
    [ "$1" = "-lc" ] && { body="$2"; break; }
    shift
  done
  printf '%s' "$body" > "$CHROOT_BODY_FILE"
  # The chroot recompiles target/debug/hello from the edited source. Simulate
  # the linker the rebuild would use: lld (marker) normally; GNU ld (no
  # marker) when NEG=1, i.e. the lld config was reverted in the VM.
  if [ "${NEG:-0}" = "1" ]; then
    printf 'gcc-only\n' > "$mnt/workspace/target/debug/hello"
  else
    printf 'LLDMARK\n'  > "$mnt/workspace/target/debug/hello"
  fi
}

readelf() {                                     # emit a .comment for the file
  local f="${@: -1}"
  echo "String dump of section '.comment':"
  echo "  [     1]  rustc version 1.78.0"
  if grep -q LLDMARK "$f" 2>/dev/null; then
    echo "  [    46]  Linker: LLD 17.0.6"
  fi
  echo "  [    59]  GCC: (Alpine 13.2.1) 13.2.1"
  echo "$f" >> "$READELF_LOG"
}
STUBS

run_sandbox() {                                 # $1=NEG value -> echoes exit code
  local neg="$1"
  export CHROOT_BODY_FILE="$WORK/chroot-body.$neg.txt"
  export READELF_LOG="$WORK/readelf-calls.$neg.log"
  : > "$READELF_LOG"
  set +e
  NEG="$neg" bash -c 'source "$1"; source "$2"' _ "$WORK/stubs.sh" "$WORK/runblock.sh" \
    > "$WORK/run.$neg.out" 2>&1
  local rc=$?
  set -e
  echo "$rc"
}

# 3a. POSITIVE: every binary lld-linked -> the step must succeed (exit 0).
rc_pos="$(run_sandbox 0)"
[ "$rc_pos" = "0" ] || { sed 's/^/    /' "$WORK/run.0.out"; fail "positive run exited $rc_pos (expected 0)"; }
pass "lld-linked image: run block exits 0"

# The chroot must have received the full body (not truncated at an apostrophe).
grep -q 'cargo check' "$WORK/chroot-body.0.txt" \
  || fail "chroot body is truncated — missing the cargo check guard"
grep -q 'export HOME=/root' "$WORK/chroot-body.0.txt" \
  || fail "chroot body is truncated — missing export HOME=/root"
grep -q 'edited smoke output from disk image' "$WORK/chroot-body.0.txt" \
  || fail "chroot body is truncated — missing the edit step"
pass "chroot received the complete body (HOME + cargo run + edit + cargo check)"

# The host-side guard must have run readelf against BOTH staged binaries.
grep -q 'target/release/hello' "$WORK/readelf-calls.0.log" \
  || fail "host guard did not inspect the release pre-bake"
grep -q 'target/debug/hello' "$WORK/readelf-calls.0.log" \
  || fail "host guard did not inspect the recompiled debug binary"
pass "host-side guard inspected both the release pre-bake and the recompiled debug binary"

# 3b. NEGATIVE: the in-VM rebuild reverted to GNU ld -> the guard must catch
#     it and fail the step (exit 1).
rc_neg="$(run_sandbox 1)"
[ "$rc_neg" = "1" ] || fail "negative run exited $rc_neg (expected 1 — guard failed to catch a revert)"
grep -q 'not linked with lld — issue #41 fix regressed' "$WORK/run.1.out" \
  || fail "negative run did not emit the regression message"
pass "non-lld rebuild: guard fails the step with the regression message"

# ---------------------------------------------------------------------------
# 4. Real readelf on real linker output. readelf parses .comment identically
#    regardless of the ELF's target arch, so host x86-64 fixtures validate the
#    same check the guard applies to the image's i386 binaries.
# ---------------------------------------------------------------------------
note "4. real readelf classifies real GNU-ld vs lld output"
printf 'int main(void){return 0;}\n' > "$WORK/h.c"
gnu_ok=0
if gcc "$WORK/h.c" -o "$WORK/hello-gnu" 2>/dev/null; then
  if readelf -p .comment "$WORK/hello-gnu" | grep -qi 'LLD'; then
    fail "GNU-ld binary unexpectedly reports LLD in .comment"
  fi
  pass "GNU-ld fixture: .comment has NO 'LLD' (guard would flag a revert)"
  gnu_ok=1
else
  echo "SKIP  gcc unavailable — cannot build GNU-ld fixture"
fi
if [ "$gnu_ok" = "1" ] && gcc "$WORK/h.c" -fuse-ld=lld -o "$WORK/hello-lld" 2>/dev/null; then
  readelf -p .comment "$WORK/hello-lld" | grep -qi 'LLD' \
    && pass "lld fixture: .comment has 'LLD' (guard passes a real lld link)" \
    || fail "lld binary missing 'LLD' in .comment"
else
  echo "SKIP  -fuse-ld=lld unavailable on host — skipping lld fixture"
fi

# 4b. If the real i386 image binaries from the measurement harness are present,
#     classify them too (the actual artifact arch the guard runs against).
if [ -d /tmp/smoke-out ]; then
  note "4b. real i386 image binaries (from measure harness)"
  for b in release-prebake debug-prebake debug-recompiled; do
    f="/tmp/smoke-out/$b"; [ -f "$f" ] || continue
    readelf -p .comment "$f" 2>/dev/null | grep -qi 'LLD' \
      && pass "i386 $b: lld-linked (guard passes)" \
      || fail "i386 $b expected lld-linked but .comment has no LLD"
  done
  if [ -f /tmp/smoke-out/debug-noconfig ]; then
    readelf -p .comment /tmp/smoke-out/debug-noconfig 2>/dev/null | grep -qi 'LLD' \
      && fail "i386 debug-noconfig unexpectedly lld-linked" \
      || pass "i386 debug-noconfig (lld config reverted): NOT lld-linked (guard catches it)"
  fi
fi

note "ALL CHECKS PASSED"
