# Issue #41 — the decisive in-VM A/B: `lld` regresses the real rebuild

This is the measurement that **overturned** the native syscall result in
[`linker.md`](./linker.md) / [`summary.md`](./summary.md). Read those for
the native numbers; read this for what actually happens in the browser.

## Why native strace was the wrong proxy

`measure-linker.sh` counts the *guest's* filesystem syscalls. It does
**not** count what CheerpX pays to **execute the linker binary itself**.
CheerpX x86→WASM-JITs guest code on first use, and `lld` (the LLVM linker)
is a far larger binary than GNU `ld`. So "fewer syscalls" (a real native
win, −85 %) can still be a net **loss** in the VM if the larger binary's
cold-JIT cost exceeds the syscall saving. The only way to know is to
measure in the real VM.

## The measurement: the project's own e2e, run by CI

`.github/workflows/disk-image.yml` builds the `rust-alpine.ext2`, boots it
in a headless Chromium via CheerpX, and runs
`web/tests/e2e/local-pages-e2e.test.mjs`. **Subtest 2** ("workbench boots
… and CheerpX 1.3.3 runs `tree --version`") includes **Stage G**: it edits
`/workspace/src/main.rs` and runs a **real** `cargo run`, gated on the
lean dev profile being present, with a **180 s** ceiling
(`runInVM(..., { timeoutMs: 180_000 })`).

Three disk builds, **the linker the only variable** between them:

| disk build | linker | CI run | subtest 2 `duration_ms` | result |
|------------|--------|--------|-------------------------|--------|
| `b861a2f` (pre-swap) | GNU `ld` | [27462524216](https://github.com/link-foundation/rust-web-box/actions/runs/27462524216) | **58458.9** (~58.5 s) | ✅ `ok 2` |
| `7c66bc7` | `lld` | [27467098552](https://github.com/link-foundation/rust-web-box/actions/runs/27467098552) | **221306.5** (~221.3 s) | ❌ `not ok 2` (timed out) |
| `766eece` (lld + guard fix) | `lld` | [27468491003](https://github.com/link-foundation/rust-web-box/actions/runs/27468491003) | **220807.7** (~220.8 s) | ❌ `not ok 2` (timed out) |

Raw log lines (saved under `ci-logs/` in the repo root at capture time):

```
# b861a2f (GNU ld) — run 27462524216
ok 2 - local e2e: workbench boots with COOP/COEP and CheerpX 1.3.3 runs `tree --version`
  duration_ms: 58458.892393
# pass 4

# 7c66bc7 (lld) — run 27467098552
not ok 2 - local e2e: workbench boots with COOP/COEP and CheerpX 1.3.3 runs `tree --version`
  duration_ms: 221306.530601
# pass 3

# 766eece (lld + guard fix) — run 27468491003
not ok 2 - local e2e: workbench boots with COOP/COEP and CheerpX 1.3.3 runs `tree --version`
  duration_ms: 220807.702775
# pass 3
```

## Reading the numbers

- GNU `ld`: the edited `cargo run` completes; subtest 2 finishes at
  **~58 s** (boot + earlier stages + the Stage-G rebuild).
- `lld`: subtest 2 hits **~221 s**. The preceding stages take ~41 s, so
  the edited `cargo run` consumed the **full 180 s Stage-G ceiling and was
  killed** — i.e. it did not finish. (221 − 180 ≈ 41 s of boot/earlier
  stages.)
- It reproduces: **two independent `lld` commits** both time out; the one
  `ld` commit passes. The only build difference is the linker.

So the native **−85 % syscalls** is **more than erased** in the VM by the
cold-JIT cost of the larger linker. Net in-VM effect of `lld`: **+163 s
or worse** (≥ 116 s → ≥ 180 s, ceiling-clamped) on the real rebuild.

## Conclusion

`lld` was **reverted** in commit `5fa7df3`; the disk keeps GNU `ld`. The
load-bearing speedup remains the lean dev profile + warm pre-bakes
(issues #17/#31), which is what gets the GNU-`ld` rebuild to ~58 s.

**Lesson:** validate every optimization on the **real VM**, not on a
native proxy. The native syscall census is a good *diagnosis* of where
native time goes, but a poor *predictor* of in-VM wall-clock because it
ignores CheerpX's per-binary translation cost. This is the concrete payoff
of the issue's "double check that our solution is not fake, and we actually
use [a] virtual machine to execute commands" requirement: the in-VM test
caught a change that every native metric called a win.

## Revisit conditions

Re-run this A/B before adopting `lld` (or any larger fast linker) if
either changes:

1. CheerpX gains a **persistent JIT/translation cache** (S4) so the linker
   is JIT-compiled once and reused across runs.
2. A **smaller** fast linker with musl/i386 support (e.g. `mold`/`wild`)
   becomes available — small enough that its cold-JIT cost stays below the
   syscall saving.
