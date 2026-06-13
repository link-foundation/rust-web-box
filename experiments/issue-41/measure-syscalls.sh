#!/bin/bash
# Syscall + process-spawn census for issue #41 — runs INSIDE the i386 image.
#
# Wall-clock on a fast 6-core host is misleading: a hello-world build is
# 0.07s natively, so nothing the slow-knobs touch is visible. But CheerpX
# does NOT multiply wall-clock uniformly — its cost scales with two things
# that ARE measurable here and are emulation-INVARIANT:
#
#   1. execve count  — every process start (cargo->rustc->cc->ld->...) pays
#      CheerpX's cold-start: a brand-new binary's code begins in the SLOW
#      interpreter and only hot paths get JIT-promoted. A one-shot compiler
#      invocation barely amortises, so process count is a direct cost driver.
#   2. syscall count — every guest syscall crosses the WASM/JS boundary and,
#      for anything touching the filesystem, goes through the IndexedDB-backed
#      OverlayDevice. File syscalls are the expensive ones in the browser.
#
# Counting these for `cargo build` (rebuild) vs `cargo check` tells us, in an
# emulation-independent way, WHY check is faster under CheerpX and exactly how
# much work the link step and its child processes add. Writes to /out.
set -u

OUT=/out
mkdir -p "$OUT"
REPORT="$OUT/syscalls.md"
: > "$REPORT"

SRC=/workspace/src/main.rs
baseline_src() { printf 'fn main() {\n    println!("Hello, world!");\n}\n' > "$SRC"; }
edited_src()   { printf 'fn main() {\n    println!("Hello, rust world!");\n}\n' > "$SRC"; }

# census <name> <prime-cmd> <edit?> <measured-cmd...>
# Strace-counts the measured command (following forks). Emits: total syscalls,
# execve count (process spawns), and the top file-touching syscalls.
census() {
  local name="$1"; shift
  local td="/tmp/st-$name"
  rm -rf "$td"; export CARGO_TARGET_DIR="$td"
  local raw="$OUT/strace-$name.log"

  baseline_src
  # prime so we measure a one-line-edit rebuild, not a cold build
  cargo build >/dev/null 2>&1
  edited_src

  # -f follow children, -c summary. In strace -c output the 'calls' column is
  # always field 4, and the aggregate row's last field is the literal 'total'.
  strace -f -c -o "$raw" "$@" >/dev/null 2>&1

  local execve total fileio
  execve=$(awk '$NF=="execve"{print $4}' "$raw")
  total=$(awk '$NF=="total"{print $4}' "$raw")
  # Sum every syscall that touches the filesystem — these are the ones that hit
  # the IndexedDB OverlayDevice in the browser and dominate emulated cost.
  fileio=$(awk '$NF ~ /^(open|openat|read|readv|pread64|write|writev|pwrite64|_llseek|lseek|close|statx|stat64|fstat64|lstat64|newfstatat|getdents64|mkdir|unlink|unlinkat|rename|renameat|fcntl64|fcntl|utimensat|chmod|readlink|readlinkat)$/{s+=$4} END{print s+0}' "$raw")
  : "${execve:=0}" "${total:=0}"

  {
    echo "### $name — \`$*\`"
    echo
    echo "- **process spawns (execve): $execve**"
    echo "- **total syscalls: $total**"
    echo "- **filesystem syscalls: $fileio** (these hit the IndexedDB overlay in-browser)"
    echo
    echo "Top syscalls by call count (strace -c):"
    echo '```'
    head -2 "$raw"
    # rows sorted by the 'calls' column (field 4), descending, top 15
    awk 'NR>2 && $NF!="total" && $4+0>0' "$raw" | sort -k4 -rn | head -15
    echo '```'
    echo
  } >> "$REPORT"

  echo "$name: execve=$execve total=$total fileio=$fileio"
}

{
  echo "# Issue #41 — syscall & process-spawn census (i386, native, emulation-invariant)"
  echo
  echo "CheerpX cost scales with process spawns (cold-start JIT) and syscalls"
  echo "(WASM/JS boundary + IndexedDB overlay), NOT with native wall-clock. These"
  echo "counts are the same whether run natively or under CheerpX — only their"
  echo "per-unit cost changes. They explain the in-browser slowdown."
  echo
} >> "$REPORT"

# proc_chain <name> <edit?> <cmd...> — list the binaries actually exec'd, so we
# can name the process tree CheerpX has to cold-start.
proc_chain() {
  local name="$1"; shift
  local td="/tmp/pc-$name"; rm -rf "$td"; export CARGO_TARGET_DIR="$td"
  baseline_src; cargo build >/dev/null 2>&1; edited_src
  {
    echo "### process tree — \`$*\`"
    echo '```'
    strace -f -e trace=execve -qq "$@" 2>&1 \
      | grep -oE 'execve\("[^"]+"' | sed 's/execve("//;s/"$//' \
      | grep -vE '\b(No such file|ENOENT)\b' | sort | uniq -c | sort -rn
    echo '```'
    echo
  } >> "$REPORT"
}

# The issue's case: one-line edit then a full debug rebuild (cargo build/run).
census rebuild-build cargo build
# The shipped fast-path: same edit, cargo check (no codegen, no link).
census rebuild-check cargo check

{
  echo "## Process trees (binaries CheerpX must cold-start)"
  echo
  echo "Each distinct binary begins execution in CheerpX's slow interpreter."
  echo "\`cargo build\` spawns the whole GNU link toolchain (\`cc\`→\`collect2\`→\`ld\`)"
  echo "that \`cargo check\` never touches. Repeated paths below are PATH-search"
  echo "misses — themselves wasted \`execve\` syscalls across the WASM/JS boundary."
  echo
} >> "$REPORT"
proc_chain build cargo build
proc_chain check cargo check

{
  echo "## Takeaway"
  echo
  echo "The delta in **execve** between \`cargo build\` and \`cargo check\` is the"
  echo "set of link-stage child processes (\`cc\`, \`collect2\`, \`ld\`/\`ld.lld\`) that"
  echo "check skips. Under CheerpX each of those is a fresh cold-start. The delta"
  echo "in **file syscalls** is the codegen + link I/O against the IndexedDB"
  echo "overlay. Both deltas are what a faster linker (fewer/cheaper link procs)"
  echo "and an off-overlay \`target/\` (cheaper file syscalls) directly reduce."
  echo
} >> "$REPORT"

echo "SYSCALL CENSUS DONE — $REPORT"
