# Experiment: attribute the in-browser rebuild time (issue #41)

Goal: turn "it takes 6 minutes" into a per-phase breakdown so any future
optimization (faster linker, in-memory `target/`, re-enabled incremental)
can be validated with **before/after numbers** instead of guesses.

Run every command **inside the app's integrated terminal** at
<https://link-foundation.github.io/rust-web-box/> (the real CheerpX VM).
Copy the output back into this folder when you measure.

> This is the **manual, in-browser** recipe. Two automated counterparts
> exist: the native i386 docker rig in
> [`experiments/issue-41/`](./issue-41/) (emulation-invariant syscall and
> linker measurements — the basis for the shipped `lld` fix), and the
> in-VM `vm.benchCargo` bus method / `__RWB_DEBUG_VM_TIMING` flag, which
> run the same real `cargo run` and emit structured per-phase timing. Use
> this manual recipe for a quick eyeball; use those for repeatable numbers.

## 0. Confirm the environment (proves it's a real VM)

```sh
uname -a            # expect: Linux … i686  → 32-bit x86 guest under CheerpX
nproc               # expect: 1            → single-core: parallel codegen buys nothing
cat /etc/os-release # expect: Alpine Linux → our pre-baked rust-alpine.ext2
rustc --version && cargo --version
```

## 1. Baseline: the two-run pattern from the screenshot

```sh
cd /workspace
cargo run                                   # warm/no-op — expect "Finished" only, ~tens of s
sed -i 's/Hello, world!/Hello, rust world!/' src/main.rs
time cargo run                              # the real rebuild — the number the issue is about
```

## 2. Split the rebuild into front-end vs codegen vs link

`-v` prints the actual `rustc` and linker invocations with their own
timing; `--timings` writes an HTML report (`target/cargo-timings/`).

```sh
touch src/main.rs
time cargo build -v 2>&1 | tee /tmp/build-v.log   # see rustc + cc/ld invocations
touch src/main.rs
cargo build --timings 2>&1 | tee /tmp/build-timings.log
```

Read `/tmp/build-v.log`: the wall-clock gap between the `Running 'rustc …'`
line and the linker (`cc … -o … hello`) line attributes time to
front-end+codegen vs link.

## 3. Verify the shipped `lld` linker fix (S1)

The disk now links with `lld` (issue #41, the measured fix). Confirm the
linker on the shipped artifact and that the warm cache survived the swap:

```sh
readelf -p .comment target/debug/hello | grep -i lld   # expect: Linker: LLD …
cargo build                                             # expect: Finished in ~0.0s (warm, no rebuild)
```

To re-measure the win, compare the link-time syscall count of a one-line
rebuild against GNU `ld` (the docker rig `experiments/issue-41/` does this
automatically: 14,736 → 2,157 filesystem syscalls, −85 %).

## 4. (Complementary, C1) the `cargo check` edit→error loop

```sh
touch src/main.rs
time cargo check        # no codegen, no link — much faster than `cargo build`
```

Record the ratio `time(cargo build) / time(cargo check)`. `cargo check`
is a faster *error-feedback* loop, but it produces no binary — it does
**not** speed up `cargo run` itself. It is complementary to S1, not the
fix.

## 5. (Proposed, S2/S3) in-memory `target/` + re-enabled incremental

Prototype mounting a writable in-memory device at `/workspace/target`
(or `CARGO_TARGET_DIR`), then:

```sh
CARGO_INCREMENTAL=1 cargo build      # only valid once target/ is off the IDB overlay
sed -i 's/rust world/RUST WORLD/' src/main.rs
CARGO_INCREMENTAL=1 time cargo build # incremental one-line rebuild — the target to beat
```

If this completes in seconds without the `a1`/exit-71 wedge, S2 is
validated and incremental (S3) can be re-enabled by default.

## What to capture

For each step, save the `time` output and the relevant log lines next to
this file (e.g. `issue-41-perf-bench-results.md`) with the date, disk
version, and browser, so the case study can cite real measurements.
