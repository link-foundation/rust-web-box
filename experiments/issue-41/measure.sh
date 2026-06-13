#!/bin/bash
# Measurement harness for issue #41 — runs INSIDE the i386 Alpine image
# built from Dockerfile.measure. Writes results to /out (bind-mounted).
#
# Goal: attribute the in-browser 6m04s one-line-edit rebuild. We cannot run
# CheerpX here, but we CAN run the *identical compile work* on the same i386
# userspace, natively, and measure:
#   1. How fast the actual compile is when nothing artificial slows it down
#      (this is the "<1s on a local machine" the reporter cites).
#   2. The exact cost of each deliberately-slow knob the project set to dodge
#      the CheerpX OverlayDevice wedge (CARGO_INCREMENTAL=0, codegen-units=1,
#      debug=0) — i.e. how much build speed those workarounds cost.
#   3. The front-end / codegen / link split (via -Z time-passes) so we know
#      which phase a faster linker (lld) or incremental actually helps.
set -u

OUT=/out
mkdir -p "$OUT"
SUMMARY="$OUT/summary.md"
: > "$SUMMARY"

SRC=/workspace/src/main.rs
baseline_src() { printf 'fn main() {\n    println!("Hello, world!");\n}\n' > "$SRC"; }
edited_src()   { printf 'fn main() {\n    println!("Hello, rust world!");\n}\n' > "$SRC"; }

# High-resolution wall-clock timer around a command. Echoes seconds (2dp) to
# stdout; full command output is appended to $1 (a log file).
timeit() {
  local log="$1"; shift
  local start end
  start=$(date +%s.%N)
  "$@" >>"$log" 2>&1
  local rc=$?
  end=$(date +%s.%N)
  awk -v s="$start" -v e="$end" 'BEGIN{printf "%.2f", e-s}'
  return $rc
}

log_env() {
  {
    echo "## Environment"
    echo
    echo '```'
    echo "uname -m : $(uname -m)   (host kernel arch; the userspace is i386)"
    echo "nproc    : $(nproc)"
    echo "rustc    : $(rustc --version)"
    echo "cargo    : $(cargo --version)"
    echo "musl/gcc : $(gcc --version | head -1)"
    echo "lld      : $(ld.lld --version 2>/dev/null | head -1 || echo 'not present')"
    echo '```'
    echo
  } >> "$SUMMARY"
}

# run_scenario <name> <description> [env KEY=VAL ...]
# Measures: cold build, no-op rebuild, one-line-edit rebuild, cargo check.
run_scenario() {
  local name="$1"; shift
  local desc="$1"; shift
  local log="$OUT/$name.log"
  : > "$log"

  local td="/tmp/target-$name"
  rm -rf "$td"
  export CARGO_TARGET_DIR="$td"

  # Reset every knob this harness touches, then apply the scenario's.
  unset CARGO_INCREMENTAL RUSTFLAGS CARGO_BUILD_JOBS
  unset CARGO_PROFILE_DEV_DEBUG CARGO_PROFILE_DEV_CODEGEN_UNITS CARGO_PROFILE_DEV_INCREMENTAL
  for kv in "$@"; do export "$kv"; done

  {
    echo "=== scenario: $name ==="
    echo "desc: $desc"
    echo "env knobs: $*"
    echo "CARGO_TARGET_DIR=$td"
    echo
  } >> "$log"

  baseline_src
  local t_cold t_noop t_rebuild t_check
  t_cold=$(timeit "$log" cargo build)
  t_noop=$(timeit "$log" cargo build)        # nothing changed -> freshness fast-path
  edited_src
  t_rebuild=$(timeit "$log" cargo build)     # THE one-line-edit rebuild (issue's 6m04s)
  baseline_src                               # change again so check has work
  t_check=$(timeit "$log" cargo check)

  printf '| %-22s | %6ss | %6ss | %8ss | %7ss |\n' \
    "$name" "$t_cold" "$t_noop" "$t_rebuild" "$t_check" >> "$SUMMARY"

  echo "$name done: cold=$t_cold noop=$t_noop rebuild=$t_rebuild check=$t_check"
}

# Split the one-line-edit rebuild into front-end / codegen / link using
# -Z time-passes (RUSTC_BOOTSTRAP=1 unlocks the unstable flag on the stable
# Alpine rustc). Run for the given scenario knobs.
split_passes() {
  local name="$1"; shift
  local log="$OUT/passes-$name.log"
  : > "$log"
  local td="/tmp/target-passes-$name"
  rm -rf "$td"
  export CARGO_TARGET_DIR="$td"
  unset CARGO_INCREMENTAL RUSTFLAGS CARGO_BUILD_JOBS
  unset CARGO_PROFILE_DEV_DEBUG CARGO_PROFILE_DEV_CODEGEN_UNITS CARGO_PROFILE_DEV_INCREMENTAL
  for kv in "$@"; do export "$kv"; done

  baseline_src
  cargo build >>"$log" 2>&1     # prime
  edited_src
  echo "=== cargo rustc -- -Z time-passes ($name) ===" >> "$log"
  RUSTC_BOOTSTRAP=1 cargo rustc --bin hello -- -Z time-passes >>"$log" 2>&1
  echo "(time-passes split captured in $(basename "$log"))"
}

echo "# Issue #41 — real compile-work measurement (i386 Alpine, native)" >> "$SUMMARY"
echo >> "$SUMMARY"
log_env

{
  echo "## One-line-edit rebuild cost by profile configuration"
  echo
  echo "All times are wall-clock for the SAME single-file zero-dependency crate"
  echo "the in-browser disk ships. \`rebuild\` is the issue's 6m04s case (edit one"
  echo "line, \`cargo build\`). Native i386 here; CheerpX emulation is NOT included."
  echo
  echo "| scenario               | cold   | no-op  | rebuild  | check   |"
  echo "|------------------------|--------|--------|----------|---------|"
} >> "$SUMMARY"

# Cargo's out-of-the-box dev profile — what you get from `cargo new` on a
# local machine (incremental ON, debuginfo ON, many codegen units). This is
# the "<1 second" reference the reporter cites.
run_scenario stock-default \
  "cargo dev defaults (incremental on, debug=2, codegen-units=256)" \
  CARGO_INCREMENTAL=1 CARGO_PROFILE_DEV_DEBUG=2 CARGO_PROFILE_DEV_CODEGEN_UNITS=256

# Exactly the knobs the shipped disk sets today (issues #17/#31 workarounds).
run_scenario shipped-slowknobs \
  "shipped workarounds (incremental OFF, debug=0, codegen-units=1)" \
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_CODEGEN_UNITS=1

# The single most-cited real fix: re-enable incremental, keep the lean knobs.
run_scenario incremental-on \
  "re-enable incremental (incremental ON, debug=0, codegen-units=1)" \
  CARGO_INCREMENTAL=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_CODEGEN_UNITS=1

# Incremental + the LLD linker (the other real, no-trade-off accelerator).
run_scenario incremental-lld \
  "incremental ON + lld linker" \
  CARGO_INCREMENTAL=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_CODEGEN_UNITS=1 \
  RUSTFLAGS="-C link-arg=-fuse-ld=lld"

# Single-core approximation of the CheerpX guest: one cargo job. (codegen-units
# parallelism is already 1 in the shipped/incremental scenarios, so this isolates
# cargo's job-level parallelism.)
run_scenario shipped-1job \
  "shipped knobs, single cargo job (single-core guest approximation)" \
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_CODEGEN_UNITS=1 \
  CARGO_BUILD_JOBS=1
run_scenario incremental-1job \
  "incremental ON, single cargo job" \
  CARGO_INCREMENTAL=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_CODEGEN_UNITS=1 \
  CARGO_BUILD_JOBS=1

{
  echo
  echo "## Front-end / codegen / link split (rustc -Z time-passes)"
  echo
  echo "Captured for the shipped knobs and the incremental fix. See the"
  echo "\`passes-*.log\` files for the full pass list; the phases that matter:"
  echo "\`*_module_codegen\` / \`LLVM_passes\` (codegen) and \`link_binary*\` (link)."
  echo
} >> "$SUMMARY"

split_passes shipped \
  CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_CODEGEN_UNITS=1
split_passes incremental \
  CARGO_INCREMENTAL=1 CARGO_PROFILE_DEV_DEBUG=0 CARGO_PROFILE_DEV_CODEGEN_UNITS=1

# Pull the headline pass timings into the summary for at-a-glance reading.
for n in shipped incremental; do
  {
    echo "### $n"
    echo '```'
    grep -E 'time:.*(codegen|LLVM|link_binary|finish_ongoing|type_check|total)' \
      "$OUT/passes-$n.log" 2>/dev/null | tail -25
    echo '```'
    echo
  } >> "$SUMMARY"
done

echo "ALL DONE — summary at $SUMMARY"
