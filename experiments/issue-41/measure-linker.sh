#!/bin/bash
# Linker comparison for issue #41 — runs INSIDE the i386 image.
#
# The native wall-clock of a hello-world link is ~0.05s either way (see
# summary.md), so wall-clock cannot tell us whether a faster linker helps in
# the browser. CheerpX cost is driven by two emulation-invariant counts:
#   1. execve  — every process CheerpX must cold-start in its interpreter.
#   2. file syscalls — every one crosses the WASM/JS boundary to the IndexedDB
#      OverlayDevice.
# The GNU link step spawns the cc -> collect2 -> ld chain. A different linker
# (lld) changes BOTH the process tree and the link-time I/O. This script counts
# them for the SAME one-line-edit rebuild under three linker configurations so
# we can say, with measured numbers, whether switching the linker reduces the
# CheerpX cost — and by how much. Writes to /out.
set -u

OUT=/out
mkdir -p "$OUT"
REPORT="$OUT/linker.md"

SRC=/workspace/src/main.rs
baseline_src() { printf 'fn main() {\n    println!("Hello, world!");\n}\n' > "$SRC"; }
edited_src()   { printf 'fn main() {\n    println!("Hello, rust world!");\n}\n' > "$SRC"; }

# census <name> <rustflags> — prime a build with the given RUSTFLAGS, edit one
# line, then strace-count the rebuild. Emits execve + file-syscall counts.
census() {
  local name="$1"; local flags="$2"
  local td="/tmp/lk-$name"; rm -rf "$td"
  export CARGO_TARGET_DIR="$td"
  export RUSTFLAGS="$flags"
  local raw="$OUT/strace-linker-$name.log"

  baseline_src
  cargo build >/dev/null 2>&1 || { echo "$name: PRIME FAILED (flags=$flags)"; return; }
  edited_src

  strace -f -c -o "$raw" cargo build >/dev/null 2>&1
  local execve total fileio
  execve=$(awk '$NF=="execve"{print $4}' "$raw"); : "${execve:=0}"
  total=$(awk '$NF=="total"{print $4}' "$raw"); : "${total:=0}"
  fileio=$(awk '$NF ~ /^(open|openat|read|readv|pread64|write|writev|pwrite64|_llseek|lseek|close|statx|stat64|fstat64|lstat64|newfstatat|getdents64|mkdir|unlink|unlinkat|rename|renameat|fcntl64|fcntl|utimensat|chmod|readlink|readlinkat)$/{s+=$4} END{print s+0}' "$raw")

  # Distinct binaries CheerpX must cold-start during the rebuild.
  local tree="$OUT/tree-linker-$name.log"
  rm -rf "$td"; cargo build >/dev/null 2>&1; edited_src
  strace -f -e trace=execve -qq cargo build 2>&1 \
    | grep -oE 'execve\("[^"]+"' | sed 's/execve("//;s/"$//' \
    | grep -vE '\b(No such file|ENOENT)\b' | sort | uniq -c | sort -rn > "$tree"
  local procs; procs=$(wc -l < "$tree")

  {
    echo "### $name"
    echo
    echo "- RUSTFLAGS: \`${flags:-<none>}\`"
    echo "- **process spawns (execve): $execve**"
    echo "- distinct binaries cold-started: $procs"
    echo "- **total syscalls: $total**"
    echo "- **filesystem syscalls: $fileio**"
    echo
    echo "Binaries exec'd during the rebuild:"
    echo '```'
    cat "$tree"
    echo '```'
    echo
  } >> "$REPORT"
  echo "$name: execve=$execve procs=$procs total=$total fileio=$fileio"
  unset RUSTFLAGS CARGO_TARGET_DIR
}

{
  echo "# Issue #41 — linker comparison (i386, native, emulation-invariant)"
  echo
  echo "Process-spawn and syscall counts for a one-line-edit \`cargo build\`"
  echo "rebuild under three linker configurations. Lower execve/file-syscall"
  echo "counts mean less CheerpX cold-start and less IndexedDB traffic in the"
  echo "browser — the two things that actually make the in-VM build slow."
  echo
  echo "lld version: $(ld.lld --version 2>/dev/null | head -1)"
  echo
} > "$REPORT"

# 1. The shipped default: GNU ld via cc -> collect2 -> ld.
census default ""
# 2. lld driven through gcc: cc -> collect2 -> ld.lld.
census fuse-ld-lld "-C link-arg=-fuse-ld=lld"
# 3. lld as the direct linker, bypassing the gcc/collect2 driver entirely:
#    rustc -> ld.lld. This is the configuration that removes the most
#    cold-start processes, if it links cleanly on musl.
census direct-lld "-C linker=ld.lld -C linker-flavor=ld.lld"

echo "LINKER COMPARISON DONE — $REPORT"
