# Experiment: attribute the in-browser rebuild time (issue #41)

Goal: turn "it takes 6 minutes" into a per-phase breakdown so any future
optimization (faster linker, in-memory `target/`, re-enabled incremental)
can be validated with **before/after numbers** instead of guesses.

Run every command **inside the app's integrated terminal** at
<https://link-foundation.github.io/rust-web-box/> (the real CheerpX VM).
Copy the output back into this folder when you measure.

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

## 3. Measure the `cargo check` win (this PR's shipped lever, S1)

```sh
touch src/main.rs
time cargo check        # no codegen, no link — should be a large fraction faster than `cargo build`
```

Record the ratio `time(cargo build) / time(cargo check)`. That ratio is
the size of the edit→error feedback win S1 delivers today.

## 4. (Proposed, S2) faster linker — only after pre-baking lld on the disk

Do **not** run ad-hoc on the shipped disk: changing `RUSTFLAGS`/linker
invalidates the warm fingerprints and can re-trigger the wedge (issue
#31). Measure this in `disk-image.yml` CI against a disk rebuilt with
`apk add lld` + the matching `~/.cargo/config.toml`, comparing the
`cc … -o hello` link duration from step 2 before vs after.

## 5. (Proposed, S4) in-memory `target/` + re-enabled incremental

Prototype mounting a writable in-memory device at `/workspace/target`
(or `CARGO_TARGET_DIR`), then:

```sh
CARGO_INCREMENTAL=1 cargo build      # only valid once target/ is off the IDB overlay
sed -i 's/rust world/RUST WORLD/' src/main.rs
CARGO_INCREMENTAL=1 time cargo build # incremental one-line rebuild — the target to beat
```

If this completes in seconds without the `a1`/exit-71 wedge, S4 is
validated and incremental can be re-enabled by default.

## What to capture

For each step, save the `time` output and the relevant log lines next to
this file (e.g. `issue-41-perf-bench-results.md`) with the date, disk
version, and browser, so the case study can cite real measurements.
