# Case Study: Issue #41 — How can the performance of the in-browser VM be improved?

Issue: <https://github.com/link-foundation/rust-web-box/issues/41>

PR: <https://github.com/link-foundation/rust-web-box/pull/42>

## Summary

The reporter opened the deployed app
(<https://link-foundation.github.io/rust-web-box/>), ran `cargo run`
twice, and captured the timings
([`evidence/issue-screenshot.jpg`](./evidence/issue-screenshot.jpg),
transcribed in [`evidence/terminal-transcript.md`](./evidence/terminal-transcript.md)):

```text
root@rust-web-box:/workspace# cargo run
    Finished `dev` profile [unoptimized] target(s) in 23.96s    # no-op, nothing compiled
     Running `target/debug/hello`
Hello, world!
root@rust-web-box:/workspace# cargo run                          # after a one-line edit
   Compiling hello v0.1.0 (/workspace)
    Finished `dev` profile [unoptimized] target(s) in 6m 04s
     Running `target/debug/hello`
Hello, rust world!
```

**A one-line edit to a single-file, zero-dependency crate takes 6 min
04 s to rebuild**, and even a *no-op* `cargo run` takes 24 s. The same
build is `<0.3 s` natively.

This document was **redone from measurement, not assumption.** Every
claim below is backed by a number from a reproducible experiment on the
*exact* i386 Alpine toolchain the disk ships
([`experiments/issue-41/`](../../../experiments/issue-41/)), plus
opt-in tracing added to the WebVM itself so the same numbers can be taken
in the browser, on the real VM
([How to measure it in the browser](#how-to-measure-it-in-the-browser-the-tracing-we-added)),
plus the project's own end-to-end CI, which boots the real CheerpX VM and
times a real edited `cargo run`
([Measurement 4](#measurement-4--the-decisive-test-the-real-vm-overturns-the-native-proxy)).

**The short answer to "what can we actually do to speed up the real
build, with no workaround or hack?"**

> The 6 minutes is **filesystem-syscall** time, not CPU time: under
> CheerpX every syscall crosses the WASM/JS boundary into the IndexedDB
> overlay, and a hello-world rebuild issues ~14,700 of them. The **lean
> dev profile + warm pre-bakes already shipped for issues #17/#31**
> (`debug = 0`, `codegen-units = 1`, `incremental = false`, plus a
> baked debug *and* release `target/`) are what already cut the **real**
> in-browser rebuild from the reported minutes to **~58 s** — proven, not
> assumed, by the end-to-end CI below. On top of that this PR ships a
> **`cargo check` fast-feedback path** (sub-second error checking, baked
> and surfaced as a task) and the **in-VM tracing** the review asked for.

> **The one change that looked like the headline fix — swapping the
> linker from GNU `ld` to `lld` — was investigated, measured, and then
> *rejected*.** On native i386 it cuts the rebuild's filesystem syscalls
> by **85 %** (14,736 → 2,157), which is exactly the cost CheerpX
> multiplies, so it looked decisive. But when measured **in the real
> VM** (the issue's own "is it fake?" requirement, enforced by the e2e),
> `lld` *regressed* the edited `cargo run` from **~58 s to a >180 s
> timeout**: CheerpX must x86→WASM-JIT the much larger LLVM linker on
> first use, and that cold-JIT cost dwarfs the syscall saving. **Native
> syscall count was the wrong proxy for in-VM wall-clock.** This is the
> central lesson of the case study, and the in-VM test is what caught it.

The larger architectural win — moving `target/` off the IndexedDB overlay
(S2), which also unblocks re-enabling incremental compilation (S3) — is
specified and measured here as the recommended follow-up.

## What we can actually do to speed up the *real* build (direct answer)

Ranked by **measured in-VM effect** (the metric that matters is real
in-browser wall-clock on the live disk — see why native syscall count
alone is *not* sufficient in
[Measurement 4](#measurement-4--the-decisive-test-the-real-vm-overturns-the-native-proxy)):

| # | Change | What it does to the **real** `cargo run` | Measured effect | Status |
|---|--------|------------------------------------------|-----------------|--------|
| **S1** | **Lean dev profile + warm pre-bakes** (`debug = 0`, `codegen-units = 1`, `incremental = false`; baked debug *and* release `target/`) | Removes debug-info IO and extra codegen units, and lets cargo's freshness check finish without re-allocating overlay inodes | Real in-VM edited `cargo run` at **~58 s** (CI-measured), versus the reported minutes | ✅ Shipped in #17/#31; **verified in-VM here** |
| **C1** | **`cargo check` fast-feedback path** (baked fingerprint + `cargo check (fast)` task) | Skips codegen *and* linking, so errors surface in seconds; complements — does not replace — `cargo run` | **1,029** vs 14,736 filesystem syscalls | ✅ **NEW in this PR** |
| **S2** | **Move `target/` off the IndexedDB overlay** (in-memory/tmpfs build dir) | Makes every *remaining* artifact syscall RAM-fast instead of IndexedDB-slow, and stops allocating fragile overlay inodes | Removes Factor-1 IO and **unblocks S3** | Proposed (specified + measured rationale) |
| **S3** | **Re-enable incremental compilation** (`CARGO_INCREMENTAL=1`) | Restores the normal "I changed one line" accelerator that #17 had to disable for the wedge | Only safe **after S2** removes the fresh-inode wedge | Proposed (depends on S2) |
| **S4** | **Track CheerpX upstream** (JIT/FP-vector, persistent translation cache) | Lowers the per-syscall and cold-`rustc` interpretation cost at the engine layer | Free speed as the engine improves | Ongoing |
| **✗** | ~~**Link with `lld`** instead of GNU `ld`~~ | Fewer linker syscalls, but CheerpX must cold-JIT the much larger LLVM linker | **−85 % native syscalls but +163 s in-VM** (58 s → >180 s timeout) | ❌ **Investigated, measured, REJECTED** (see [below](#rejected-after-measurement--link-with-lld)) |

Everything else (cranelift backend, `wasm32-wasi` host `rustc`, boot
trims) is real but either blocked on our toolchain or orthogonal to the
6-minute rebuild — catalogued honestly in
[Solution catalogue](#solution-catalogue).

## Follow-up review responses (PR #42)

[konard's PR #42 review comment](https://github.com/link-foundation/rust-web-box/pull/42)
raised four follow-ups. Each is answered below to the same
measure-don't-assume standard as the rest of this study: two are questions
(IO, multithreading) answered from the architecture + code + the on-demand
probe, two are deliverables shipped in this PR (on-demand benchmarks, full
UI e2e).

### F1 — "Are we using the most efficient IO? Can we use RAM as a temporary cache for files, with a queue that flushes to local storage?"

**How IO actually works today (cited):**

- The root filesystem is `OverlayDevice(CloudDevice, IDBDevice)` — a
  read-only base disk unioned with a writable **IndexedDB** overlay
  (`web/glue/cheerpx-bridge.js:316-317`). `/web` is a `WebDevice`, `/data`
  a `DataDevice` for staging sync scripts (`:320-321`).
- **There is no RAM-backed mount anywhere.** No `tmpfs`/`ramfs`/`/dev/shm`
  is mounted in boot or in the disk image — a grep of `web/glue/boot.js`,
  `web/glue/webvm-server.js`, and `web/disk/Dockerfile.disk` finds none. So
  both `/tmp` *and* `/workspace/target` live on the same IndexedDB overlay
  (`web/glue/webvm-server.js:638-640`). Every `target/` write is therefore
  an IndexedDB write across the WASM/JS boundary — exactly the
  ~14,700-syscall cost [Measurement 2](#measurement-2--the-cost-is-filesystem-syscalls-over-the-overlay)
  isolates.
- A **write queue already exists**, but for *ordering*, not *buffering*:
  `runGuestScript` chains each guest write on a `tail` promise so saves
  serialize against the VM (`web/glue/webvm-server.js:413`, `:471`), and
  `fs.writeFile` writes the guest mirror **then** the JS store, both
  straight to IndexedDB (`:575`). CheerpX 1.3.3 exposes no `flush`/`sync`
  hook to splice a block-layer write-back cache underneath.

**Verdict — the instinct is right, applied where it pays.** A *generic*
RAM-cache-with-write-back in front of the **whole** overlay would trade
away durability (a reload or tab crash silently drops unflushed **source**
edits) for a saving that is dominated by **build artifacts**, not source.
The targeted, no-durability-risk form of exactly this idea is already
catalogued as [**S2 — move `target/` onto a RAM/tmpfs device**](#s2--move-target-off-the-indexeddb-overlay-in-memory-build-dir--the-big-architectural-win):
the build dir is ephemeral (safe to drop on reload), it is where ~all the
syscall churn happens, and keeping *source* on the persistent overlay
preserves "your edits survive reload". That is the honest version of "use
RAM as a temporary cache with a flush queue" — **RAM for the throwaway
artifacts, durable IndexedDB for the code** — and it needs no hack, only a
CheerpX device that 1.3.3 does not yet expose (tracked under S2/S4). This
PR adds the in-VM **storage probe** (`STORAGE_CPU_PROBE` in
`web/tests/bench/run-in-vm-bench.mjs`) that confirms the live mount table /
tmpfs availability on the real VM when the bench workflow (F3) is
dispatched, so the "no RAM mount" finding is verifiable, not asserted.

### F2 — "Can we use js + rust + wasm + web workers? Can we do it maximum multithreaded?"

**What is already multi-context (cited):** the app is *already*
js + wasm + web-workers + `SharedArrayBuffer`:

- **CheerpX (wasm)** runs on the page/main thread and owns the
  `SharedArrayBuffer` (`web/glue/webvm-server.js:3-7`).
- The **VS Code extension host** runs in a dedicated **Web Worker** — no
  DOM, no SAB — talking to the page over a same-origin BroadcastChannel
  (`web/glue/webvm-bus.js:1-12`, `web/extensions/webvm-host/extension.js:1-20`).
- **Cross-origin isolation** (the prerequisite for SAB) is synthesized by a
  service worker: `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp` (`web/sw.js:63`, `:69`;
  rationale in `web/glue/coi-bootstrap.js`). So the UI is *already* off the
  VM thread — typing and scrolling stay responsive while a build runs.

**The honest limit — the guest VM is single-core.** `CheerpX.Linux.create`
is given mount config only; there is **no SMP / `nproc` option**
(`web/glue/cheerpx-bridge.js:324`), and CheerpX 1.3.x JITs x86→WASM in a
**single execution context**. `nproc` inside the guest returns `1` (the
bench captures it: `web/glue/cargo-bench.js:105`). Therefore:

- `cargo -j4` / parallel codegen / `-Zthreads=N` **cannot fan out** —
  there is one core. The disk deliberately ships `codegen-units = 1` and
  `incremental = false` (`web/disk/Dockerfile.disk:148`); raising the job
  count buys nothing and only risks the fresh-inode wedge (#17).
- More Web Workers **cannot** speed the compile either: the bottleneck
  [Measurement 2](#measurement-2--the-cost-is-filesystem-syscalls-over-the-overlay)
  isolates is **serial filesystem-syscall IO over IndexedDB**, not
  parallelizable CPU. You can move *other* work off the VM thread (already
  done), but you cannot split one `rustc` invocation across cores that do
  not exist.

**Verdict:** "maximum multithreaded" is the right instinct for a native
multi-core box and the wrong lever here. The win is not *more threads* but
**less per-syscall IO** ([S2](#s2--move-target-off-the-indexeddb-overlay-in-memory-build-dir--the-big-architectural-win),
RAM-backed `target/`) and **a faster engine**
([S4](#s4--track-cheerpxs-own-performance-levers--upstream), tracking
CheerpX's JIT/threading upstream). The A/B knobs that *prove* extra jobs
don't help on a single core are wired into the bench as the `jobs1` vs
`jobs4` configs, runnable on demand (F3).

### F3 — "Keep all benchmarks runnable on demand (CI manual dispatch), usable via the gh tool, to reduce load on your machine."

Shipped: **`.github/workflows/perf-bench.yml`** — `workflow_dispatch`
**only** (no push / PR / schedule trigger). Two independent jobs:

- **native** — the i386 Alpine measurement rig (`experiments/issue-41/`),
  same compile work without CheerpX, per profile knob;
- **in-vm** — the user's *real* `cargo run` / `build` / `check` timed
  inside the live CheerpX VM (`web/tests/bench/run-in-vm-bench.mjs` driving
  the `vm.benchCargo` bus method), plus the F1/F2 storage + CPU probe.
  Configs: `shipped`, `incremental`, `jobs1`, `jobs4`.

Both publish a Markdown job-summary and upload artifacts; nothing runs on a
local machine. Dispatch (post-merge — see the availability note under F4):

```sh
gh workflow run perf-bench.yml --ref main \
  -f configs=shipped,jobs1,jobs4 -f run_native=true -f run_in_vm=true
```

### F4 — "Full e2e tests, also manual-dispatch, that verify exactly all steps: cargo run + output, file change (VS Code editor), cargo run + verify output (VS Code terminal)."

Shipped: **`web/tests/e2e/ui-driven-e2e.test.mjs`** +
**`.github/workflows/ui-e2e.yml`** (`workflow_dispatch` only). The test
drives the *real* UI a user touches — not the `cx.run`/bus shortcut the
other suites use — in exactly this order:

1. type `cargo run` in the **integrated terminal** (xterm) → assert the
   seed greeting (read off the guest, so it is version-skew safe);
2. edit `/workspace/src/main.rs` in the **Monaco editor** (select-all +
   `insertText` + Ctrl+S — the genuine `FileSystemProvider` save path) with
   a **unique per-run marker**;
3. type `cargo run` again → assert the **new marker** *and* `Compiling`.

Step 3 is the anti-fake gate the issue demands: a cached or pre-baked
binary cannot print a marker that did not exist until this run, and
`Compiling` proves CheerpX re-invoked `rustc` in the VM rather than
replaying a stale artifact. It uses the **real interactive bash + workspace
prime** (`skipBash:false`, `skipPrime:false`), so the workflow builds
`rust-alpine.ext2` **fresh by default** — only a disk whose seed inodes all
already exist is safe from the OverlayDevice 'a1' wedge. The terminal
readiness handshake echoes an arithmetic expansion (`$((21 * 2))`) so it
proves bash *executes*, not merely that the tty echoes keystrokes.
Dispatch:

```sh
gh workflow run ui-e2e.yml --ref main
```

> **Dispatch availability (verified, not assumed).** GitHub only lists and
> dispatches a `workflow_dispatch` workflow once its file is on the
> repository's **default branch**. While these two workflows live only on
> the PR branch, both `gh workflow run perf-bench.yml --ref issue-41-…` and
> the raw `POST …/actions/workflows/perf-bench.yml/dispatches` return
> `HTTP 404: … not found on the default branch` (confirmed during this
> work). They become dispatchable the moment PR #42 merges to `main`; the
> `--ref main` commands above are then exact. **No auto-trigger was added**,
> per the explicit on-demand-only request.

## Evidence collected

| File | Purpose |
|------|---------|
| [`evidence/issue.json`](./evidence/issue.json) | Full GitHub issue payload (`gh issue view`). Labels: `documentation`, `enhancement`, `question`. |
| [`evidence/issue-comments.json`](./evidence/issue-comments.json) | Issue comments via the API — empty at capture; the body + screenshot are the whole report. |
| [`evidence/issue-screenshot.jpg`](./evidence/issue-screenshot.jpg) | The reporter's screenshot: VS Code Web, `main.rs` edited to `"Hello, rust world!"`, terminal showing the 23.96 s no-op and 6 m 04 s rebuild. |
| [`evidence/terminal-transcript.md`](./evidence/terminal-transcript.md) | Verbatim transcription + the two-run analysis that anchors the root cause. |
| [`../../../experiments/issue-41/`](../../../experiments/issue-41/) | **The measurement rig.** `Dockerfile.measure` mirrors the shipped i386 disk; `measure.sh`/`measure-syscalls.sh`/`measure-linker.sh` produce the numbers in `results/` (wall-clock by profile, syscall census, the GNU `ld` vs `lld` comparison). `results/in-vm-ab.md` records the decisive in-VM e2e A/B. |
| [`online-research.md`](./online-research.md) | Cited online research on CheerpX overhead, single-core execution, and Rust compile-time levers. |

## Is the VM real? (anti-fake verification)

The issue explicitly asks us to "double check that our solution is not
fake, and we actually use [a] virtual machine to execute commands." The
evidence is conclusive on **both** directions — and this requirement did
real work: it is exactly the in-VM check that caught the `lld`
fake-good optimization
([Measurement 4](#measurement-4--the-decisive-test-the-real-vm-overturns-the-native-proxy)).

1. **The output tracks the edited source.** The editor shows line 2 as
   `println!("Hello, rust world!");` and the second run prints exactly
   `Hello, rust world!` — a *different* string from the first run's
   `Hello, world!`. A faked/mocked terminal would not recompile a
   changed string and emit the new value. A real `rustc` did.
2. **Cargo's own phase lines are present and internally consistent.**
   The first run shows **only** `Finished … in 23.96s` (no `Compiling`)
   — that is cargo's freshness fast-path on an unchanged crate. The
   second shows `Compiling hello v0.1.0 (/workspace)` → `Finished` →
   `Running target/debug/hello`. This is the real cargo state machine,
   not canned text.
3. **The slowness itself is the proof.** A fake would be *fast*. 6 m
   04 s is the unmistakable signature of a real `rustc` + LLVM + linker
   pipeline running under x86→WASM emulation. You cannot fake being this
   slow in a way that *also* produces correct, edited output.
4. **The architecture has no shortcut path.** `web/glue/webvm-server.js`
   runs the user's command through `cx.run('/bin/bash', …)` inside
   CheerpX (`docs/architecture.md`). There is no interception layer that
   could substitute output; the bytes come straight from the guest PTY.
   The new `vm.benchCargo` instrumentation reuses that **same** path — it
   measures real `cargo run`, it does not replace it.
5. **CI boots the real VM and runs a real edited `cargo run`.**
   `web/tests/e2e/local-pages-e2e.test.mjs` (run by `disk-image.yml`)
   loads the freshly built ext2 into a headless browser, boots CheerpX,
   edits `src/main.rs`, and times an actual `cargo run`. That is the test
   whose number flipped 58 s → timeout when `lld` was added — a faked
   pipeline could not have regressed.

**Recommended live re-verification** (anyone can run these in the app's
terminal to confirm it is a genuine Linux VM, not a shim):

```sh
uname -a            # Linux … i686  → 32-bit x86 guest under CheerpX
nproc               # expected: 1   → single-core (see root cause)
cat /etc/os-release # Alpine Linux  → our pre-baked rust-alpine.ext2
rustc --version     # the real toolchain doing the work
time cargo build -v # see the actual rustc + linker invocations + timing
```

Conclusion: **the VM is real.** The problem is genuine compiler work
running in a genuinely slow execution environment — which is precisely
why it is worth optimizing, and why an optimization has to be validated
*in that environment*, not just on native metrics.

## Root-cause analysis — measured, not assumed

The prior analysis *guessed* that CPU-bound emulation of `rustc`/LLVM was
the dominant cost. **Measurement says otherwise.** Four experiments — the
first three native+reproducible via
[`experiments/issue-41/`](../../../experiments/issue-41/), the fourth
taken in the real VM by CI — together tell a story whose punchline
overturns its own setup.

### Measurement 1 — native wall-clock is emulation-invariant noise

`measure.sh` runs the SAME one-line-edit rebuild on the SAME crate under
every profile configuration, natively on i386
([`results/summary.md`](../../../experiments/issue-41/results/summary.md)):

| scenario | cold | no-op | **rebuild** | check |
|----------|------|-------|-------------|-------|
| stock-default | 0.27s | 0.02s | **0.14s** | 0.08s |
| shipped slow-knobs (`codegen-units=1`, `debug=0`, `incremental=0`) | 0.25s | 0.03s | **0.14s** | 0.08s |
| incremental on | 0.26s | 0.03s | **0.15s** | 0.08s |
| incremental + lld | 0.25s | 0.03s | **0.15s** | 0.08s |

**Every config rebuilds in 0.14–0.27 s natively.** The knobs the prior
work tuned move the native number by *milliseconds*. So native CPU work
**cannot** explain the 6-minute browser cost — something the emulation
layer multiplies does. That rules out the entire "do less CPU codegen"
family as the lever and points at **per-syscall / per-process emulation
overhead**.

### Measurement 2 — the cost is filesystem syscalls over the overlay

`measure-syscalls.sh` straces the same rebuild
([`results/syscalls.md`](../../../experiments/issue-41/results/syscalls.md)):

| command | process spawns (`execve`) | total syscalls | **filesystem syscalls** |
|---------|---------------------------|----------------|-------------------------|
| `cargo build` (one-line-edit rebuild) | 12 | 16,812 | **14,736** |
| `cargo check` (same edit) | 5 | 1,645 | 1,029 |

A *zero-dependency hello-world rebuild* issues **~14,700 filesystem
syscalls**. Natively those are free page-cache hits. Under CheerpX each
one crosses the WASM/JS boundary and hits the
`OverlayDevice(cloud, IDBDevice)` IndexedDB layer — that boundary crossing,
multiplied ~14,700×, is the bulk of the 6 minutes. **The bottleneck is
I/O, not CPU.** (The 24 s no-op is the same cost in miniature: cargo
`stat()`-walks `target/` over the overlay to prove nothing changed.) This
is also why `cargo check`, at **1,029** filesystem syscalls, is a genuine
fast-feedback win (C1) — though it builds no binary, so it does not
replace `cargo run`.

### Measurement 3 — the linker is the dominant syscall source (the `lld` hypothesis)

`rustc -Z time-passes` shows `link_binary` is **0.049 s of 0.072 s total
(68 %)** — the single largest compile phase, and it is filesystem-bound.
`measure-linker.sh` then counts the rebuild's syscalls with GNU `ld` vs
`lld` ([`results/linker.md`](../../../experiments/issue-41/results/linker.md)):

| linker | process spawns | total syscalls | **filesystem syscalls** |
|--------|----------------|----------------|-------------------------|
| GNU `ld` (shipped default) | 12 | ~16,880 | **14,736** |
| `lld` (`-C link-arg=-fuse-ld=lld`) | 12 | ~6,860 | **2,157** |

**On native i386, switching the linker cuts filesystem syscalls by 85 %**
with the process count unchanged. GNU `ld` walks the libc archive with
thousands of `_llseek`/`readv` calls; `lld` mmaps it. Because file
syscalls are exactly the cost CheerpX multiplies, **this looked like the
single highest-leverage, no-hack fix** — and an earlier revision of this
PR shipped it. The native numbers are real and reproduce deterministically.
**They were also the wrong proxy.** Measurement 4 is why.

### Measurement 4 — the decisive test: the real VM overturns the native proxy

Native strace counts syscalls; it does **not** count what CheerpX pays to
*execute the linker itself*. CheerpX x86→WASM-JITs guest code on first
use, and `lld` is a far larger binary than GNU `ld`. The only way to know
the net effect is to measure **in the real VM** — which is exactly what
the project's end-to-end CI does. `disk-image.yml` builds the ext2, boots
it in a headless browser via CheerpX, and `local-pages-e2e.test.mjs`
subtest 2 edits `src/main.rs` and runs a **real** `cargo run` (Stage G,
gated on the lean dev profile being present, with a 180 s ceiling).

Holding everything else constant and changing **only** the linker:

| disk build | linker | CI run | subtest 2 (real edited `cargo run`) | result |
|------------|--------|--------|-------------------------------------|--------|
| `b861a2f` (pre-swap) | GNU `ld` | [27462524216](https://github.com/link-foundation/rust-web-box/actions/runs/27462524216) | **58.5 s** (`duration_ms: 58458.9`) | ✅ `ok 2` |
| `7c66bc7` | `lld` | [27467098552](https://github.com/link-foundation/rust-web-box/actions/runs/27467098552) | **221.3 s** (`duration_ms: 221306.5`) | ❌ `not ok 2` — timed out |
| `766eece` (lld + guard fix) | `lld` | [27468491003](https://github.com/link-foundation/rust-web-box/actions/runs/27468491003) | **220.8 s** (`duration_ms: 220807.7`) | ❌ `not ok 2` — timed out |

**The single variable across these three disk builds is the linker.**
GNU `ld` passes at ~58 s; `lld` blows through the 180 s ceiling, twice,
on two independent commits. (221 s ≈ ~41 s of boot/earlier stages + the
180 s Stage-G timeout.) So the native −85 % syscall win is **more than
erased** in the VM by the cold-JIT cost of the bigger linker. The
filesystem-syscall count was a good *diagnosis* of where native time goes
but a **bad predictor of in-VM wall-clock**, because it omits CheerpX's
per-binary translation cost entirely.

**`lld` was therefore reverted** (commit `5fa7df3`); the disk keeps GNU
`ld`. This is the case study's headline finding, and it is only knowable
because the issue insisted the solution be validated on the *real* VM.

### The meta-root-cause (unchanged, now quantified)

Several speed knobs were turned the *slow* way on purpose to dodge the
CheerpX `OverlayDevice` "`a1`" fresh-inode wedge (`CARGO_INCREMENTAL=0`
#17; `codegen-units=1`, `debug=0` #31). Measurement 1 shows those cost
almost nothing natively — but they exist *because* of the overlay, and
(per Measurement 4) they are already enough to get the real rebuild to
~58 s. So the highest-leverage architectural move that *remains* is
**getting build artifacts off the IndexedDB overlay** (S2): it makes the
remaining syscalls fast *and* removes the wedge that forced the slow
knobs, unblocking incremental (S3). Unlike `lld`, S2 reduces work CheerpX
must emulate rather than adding a large new binary for it to JIT.

## How to measure it in the browser (the tracing we added)

Native docker proves *where* the cost is in an emulation-invariant way,
and CI's e2e proves the *net* in-VM effect. To let a maintainer take the
same numbers ad-hoc **in the browser on the real VM** — and to keep us
honest about future changes — this PR adds opt-in tracing to the WebVM
command path (`web/glue/`), zero-overhead when off:

- **`globalThis.__RWB_DEBUG_VM_TIMING = true`** — records wall-clock for
  every `cx.run` the server issues (mirrors the existing
  `__RWB_DEBUG_TERMINAL_STREAM` pattern). Read it back with the server
  handle's `vmTimings.snapshot()`.
- **`vm.benchCargo` bus method** (`web/glue/cargo-bench.js`) — runs the
  user's **real** `cargo run` / `cargo build` / `cargo check` inside the
  guest across four phases (no-op run, one-line-edit run, edit build, edit
  check) plus an optional `rustc -Z time-passes` split, and ships per-phase
  wall-clock back over the same OSC-frame stdout channel `workspace-sync`
  uses. It only ever rewrites the existing `src/main.rs` inode and restores
  the baseline, so it never allocates fresh inodes (no `a1` wedge) and never
  touches the `target/`/fingerprint tree. `summarizeCargoBench` renders it
  the way the issue reports it (e.g. `cargo run (one-line edit) 6m04.1s`).

This is the in-browser counterpart to the docker rig: same real commands,
same real VM, structured timing out. It is how a maintainer reproduces
the Measurement-4 result by hand and validates any future S2/S3 change on
the live disk, by numbers rather than vibes. (Had this tracing existed
first, the `lld` regression would have shown up before CI did.)

## Requirements (every one, enumerated)

Parsed verbatim from the issue body and the PR-review follow-up ("explain
in detail what we can actually do to speed up the *actual* build, without
workarounds or hacks; add tracing if we lack it; use only real `cargo
run`"):

| # | Requirement | Where addressed |
|---|-------------|-----------------|
| R1 | "Explore **all possible ways** to improve performance of [the] virtual machine in the browser." | [Solution catalogue](#solution-catalogue) — ranked, measured, including one option measured then rejected. |
| R2 | "Simple `cargo run` executes too long (5–6 minutes on second rebuild)." — quantify & fix the **real** rebuild. | [Root-cause analysis](#root-cause-analysis--measured-not-assumed); the real rebuild is at ~58 s via the lean profile + pre-bakes (S1, verified in-VM), with S2/S3 the next lever and `lld` rejected. |
| R3 | "It is ok to also **optimize the WebVM itself** if you know how." | S2 (target off overlay), S4 (CheerpX upstream); plus the in-VM tracing we added. |
| R4 | "**Double check that our solution is not fake**, and we actually use [a] virtual machine to execute commands." | [Is the VM real?](#is-the-vm-real-anti-fake-verification) + live recipe; the bench reuses the real `cx.run` path; the e2e (Measurement 4) boots the real VM and caught the `lld` regression. |
| R5 | "Collect data related to the issue … compile that data to `./docs/case-studies/issue-41`." | This folder + [`experiments/issue-41/`](../../../experiments/issue-41/). |
| R6 | "Deep case study analysis." | This `README.md`, measurement-driven, including a measured rejection. |
| R7 | "Search online for additional facts and data." | [`online-research.md`](./online-research.md), fully cited. |
| R8 | "List of each and all requirements from the issue." | This table. |
| R9 | "Propose possible solutions and solution plans for each requirement." | [Solution catalogue](#solution-catalogue), per-requirement plans. |
| R10 | "Check known existing components/libraries that solve a similar problem or can help." | Each entry names concrete tools (lld/mold/wild, CheerpX devices, cranelift, `cargo check`). |
| R11 | "Plan and execute everything in this single pull request." | PR #42; branch `issue-41-…`. |
| R12 | **(PR review)** Redo the analysis from **measurement**; add **tracing** if missing; speed up the **actual** build, no workarounds/hacks; use only **real `cargo run`**. | The whole rewrite: docker syscall/linker measurement, the in-VM `vm.benchCargo`/`__RWB_DEBUG_VM_TIMING` tracing, the in-VM e2e A/B (Measurement 4), and the **honest rejection of `lld`** when the real `cargo run` regressed. |

## Solution catalogue

Each entry: **impact** (in-browser cost removed), **effort**, **risk**
(especially vs. the CheerpX wedge), the **existing component/library** it
uses, and a **plan**. Ranked by *measured value today*.

Legend — Impact/Effort/Risk: ⬤⬤⬤ high · ⬤⬤ medium · ⬤ low.

### S1 — Lean dev profile + warm pre-bakes ✅ (shipped #17/#31, verified in-VM here)

- **Maps to:** R1, R2, R3, R9, R10.
- **Impact ⬤⬤⬤ · Effort ⬤ · Risk ⬤⬤ (must match the pre-bake fingerprint — handled).**
- **Existing component:** Cargo profiles (`[profile.dev]`), Cargo's
  freshness/mtime check, and a baked `target/` (debug *and* release).
- **Why it is the real fix in place today:** Measurement 4 shows the
  current disk — lean dev profile (`debug = 0`, `codegen-units = 1`,
  `incremental = false`) plus a baked debug and release `target/` —
  rebuilds an edited `cargo run` **in ~58 s in the real VM**, versus the
  minutes the issue reported. It works by (a) not writing debug info and
  not splitting into extra codegen units (less artifact IO over the
  overlay) and (b) letting cargo's freshness check succeed against the
  pre-baked artifacts without allocating fresh inodes (dodging the `a1`
  wedge). It changes nothing the user runs.
- **Why it is safe vs. the wedge:** the profile is baked **before** the
  pre-bake `cargo build`, so the baked fingerprints already record it and
  the first in-browser build stays a verified no-op. The e2e's
  `hasLeanCargoDevProfile` gate asserts the baked
  `/root/.cargo/config.toml` still carries `debug = 0` + `codegen-units = 1`
  before it even runs the timed rebuild.
- **Status:** shipped in #17/#31; this PR's contribution is to **prove it
  in the real VM** (Measurement 4) and keep it as the load-bearing fix
  after `lld` was rejected.

### C1 — `cargo check` fast-feedback path ✅ NEW in this PR (complementary, **not** a `cargo run` speedup)

- **Maps to:** R1, R2, R10; iteration-loop UX.
- **Impact ⬤⬤ (error feedback) · Effort ⬤ · Risk ⬤.**
- **Existing component:** Cargo's built-in `cargo check`.
- **What it is:** `cargo check` skips codegen **and** linking, so it
  surfaces compile errors in seconds (Measurement 2: **1,029** vs 14,736
  filesystem syscalls). This PR **pre-bakes the check fingerprint** in the
  disk image (so the first in-browser `cargo check` reuses inodes rather
  than tripping the wedge) and surfaces it as a `cargo check (fast)` task
  in the seeded `tasks.json` (with `rust-analyzer.checkOnSave` left off so
  it does not fire the slow path on every keystroke).
- **Why it is explicitly *not* the answer to "make `cargo run` faster":**
  `cargo check` produces no binary, so you still pay the full build
  whenever you actually want to *run* the program. It is a parallel
  fast-feedback lever (rust-analyzer's check-on-save uses the same
  command), which is why we ship it — but the fix to the *real build*
  remains S1 (and the future S2/S3). Presenting `cargo check` as "the
  performance fix" was the framing the PR review correctly rejected; it is
  shipped here as a complement, not the headline.

### S2 — Move `target/` off the IndexedDB overlay (in-memory build dir) — the big architectural win

- **Maps to:** R1, R2, R3, R9.
- **Impact ⬤⬤⬤ · Effort ⬤⬤⬤ · Risk ⬤⬤⬤.**
- **Existing component:** CheerpX writable devices (`DataDevice`, the mount
  topology in `web/glue/cheerpx-bridge.js`); Cargo's `CARGO_TARGET_DIR`.
- **Why it is the highest-leverage *remaining* fix:** writing build
  artifacts to `OverlayDevice(cloud, IDBDevice)` is *both* the slow-IO
  source (every remaining artifact syscall still pays IndexedDB latency)
  *and* the trigger for the `a1` fresh-inode wedge that forced
  `CARGO_INCREMENTAL=0` + `codegen-units=1`. Put `target/` on an in-memory
  writable mount and you (a) make artifact IO RAM-fast and (b) stop
  allocating fragile overlay inodes — which unblocks **S3** (incremental).
  Artifacts are regenerable, so losing them on reload is acceptable. Unlike
  `lld`, this *removes* work from the emulation layer rather than adding a
  large new binary for it to JIT.
- **Open question / why prototyped not shipped:** CheerpX's documented
  mount types are `ext2`, `dir` (Web/DataDevice), `devs`, `devpts`,
  `proc`, `sys` (see `bootLinux` in `cheerpx-bridge.js`); whether a
  *writable, full-tree, in-memory* mount usable for `target/` is exposed
  needs an upstream check/experiment. If unavailable, file an upstream
  request to `leaningtech/webvm`/CheerpX for a tmpfs/ramfs device.
- **Plan:** experiment under `experiments/` to mount a writable in-memory
  device at `/workspace/target` (or point `CARGO_TARGET_DIR` at one);
  confirm the wedge no longer fires with `CARGO_INCREMENTAL=1`; measure the
  rebuild with `vm.benchCargo` before/after; then ship S3.

### S3 — Re-enable incremental compilation (depends on S2)

- **Maps to:** R1, R2.
- **Impact ⬤⬤⬤ (for one-line edits) · Effort ⬤ · Risk ⬤⬤⬤ until S2 lands.**
- **Existing component:** Cargo's built-in incremental compilation.
- **Why blocked today:** `CARGO_INCREMENTAL=0` exists because incremental
  generates a flood of fresh inodes under `target/<profile>/incremental/`,
  which trips the `a1` overlay wedge (#17). Incremental is *the* normal
  accelerator for "I changed one line"; re-enabling it once S2 removes the
  overlay is the natural pairing. Measurement 1 confirms incremental adds
  no native penalty, so the only thing standing between us and it is the
  overlay wedge.
- **Plan:** after S2, flip `CARGO_INCREMENTAL=1` (env + `config.toml` +
  the bench's `SHIPPED_BENCH_ENV`), re-bake, and validate with
  `vm.benchCargo` that an edited `cargo run` drops to seconds.

### S4 — Track CheerpX's own performance levers / upstream

- **Maps to:** R3, R1.
- **Impact ⬤⬤ (long-horizon) · Effort ⬤⬤⬤ · Risk ⬤⬤.**
- **Existing component:** CheerpX itself (pinned 1.3.3 in
  `cheerpx-bridge.js`). Its roadmap targets "average application at most
  5× slower than native" by extending integer-pipeline optimizations to
  FP/vector (online-research §1), and a persistent JIT/translation cache
  would stop cold `rustc` re-paying interpretation cost every run — and
  would also be what makes a bigger linker like `lld` viable (Measurement 4).
- **Plan:** keep `CHEERPX_VERSION` current (#37 tracks this); adopt and
  measure FP/vector JIT or a persistent translation cache when shipped;
  file/track an upstream request for the in-memory writable device S2
  needs and for a persistent JIT cache.

### S5 — Cranelift debug codegen backend

- **Maps to:** R1, R2, R10.
- **Impact ⬤⬤ (20–30 % debug **codegen**) · Effort ⬤⬤⬤ · Risk ⬤⬤⬤.**
- **Existing component:** `rustc_codegen_cranelift`. **Blocked here**
  (online-research §4): nightly-only `rustup` component on **x86_64**
  Linux; our guest is **i386** Alpine **stable** rust. And Measurement 1
  shows codegen is the *minority* of the cost (IO dominates), so even if
  unblocked the payoff is smaller than S1/S2. Park as research.

### S6 — Run `rustc` as native WASM/WASI instead of x86-under-CheerpX

- **Maps to:** R1, R3 (radical).
- **Impact ⬤⬤⬤ (removes the emulation layer) · Effort ⬤⬤⬤ · Risk ⬤⬤⬤.**
- **Existing component:** `wasm32-wasi` toolchain efforts. **Reality check
  (online-research §6):** there is no supported, drop-in `wasm32-wasi` host
  build of `rustc`+`cargo`+LLVM that runs a full edit-compile-run loop in
  the browser today. Long-horizon research only; recorded for completeness.

### S7 — Faster boot / cold-start (orthogonal to compile time)

- **Maps to:** R1, R3.
- **Impact ⬤⬤ (first-load UX) · Effort ⬤⬤ · Risk ⬤.**
- **Existing component:** already substantial — `web/sw.js` caches
  shell/glue, IDB overlay persists, disk ships as same-origin GitHubDevice
  chunks, workspace renders before VM boot. Further wins: smaller ext2,
  prefetch of disk chunks, HTTP caching headers. Does not touch the
  6-minute rebuild; tracked for completeness.

### Rejected after measurement — link with `lld`

- **Maps to:** R1, R2, R10, R12 (the measured-rejection requirement).
- **Verdict:** ❌ **investigated, measured on native i386 *and* in the real
  VM, and reverted.**
- **Existing component:** `lld`, the LLVM linker (Alpine `lld` package),
  driven through gcc with `-C link-arg=-fuse-ld=lld`.
- **Why it looked like the fix:** the link step is 68 % of compile and is
  the dominant filesystem-syscall source (Measurement 3); `lld` mmaps the
  libc archive instead of seeking through it, cutting the rebuild's native
  filesystem syscalls **14,736 → 2,157 (−85 %)** — precisely the cost
  CheerpX multiplies. An earlier revision of this PR shipped it on that
  basis.
- **Why it was rejected:** Measurement 4. In the real CheerpX VM the
  edited `cargo run` **regressed from ~58 s to a >180 s timeout** across
  two independent commits, because CheerpX must x86→WASM-JIT the much
  larger LLVM linker on first use and that cold-JIT cost dwarfs the syscall
  saving. The native syscall count was the wrong proxy for in-VM
  wall-clock. Reverted in `5fa7df3`; the disk keeps GNU `ld`.
- **When to revisit:** if S4 lands a persistent CheerpX JIT/translation
  cache (so the linker is JIT-compiled once and reused), or if a *smaller*
  fast linker that emulates cheaply (e.g. `mold`/`wild`, subject to musl
  i386 support) becomes available, re-run Measurement 4 before adopting.
- **Lesson:** validate every optimization on the **real VM**, not on a
  native proxy. This is the concrete payoff of the issue's "is it fake?"
  requirement.

## What this PR ships vs. proposes (honesty statement)

**Shipped & verified here:**

- **The in-VM tracing** the review asked for: `vm.benchCargo` (real
  `cargo run`/`build`/`check` timing over the real `cx.run` path) and
  `__RWB_DEBUG_VM_TIMING` (per-`cx.run` wall-clock), with unit +
  integration tests.
- **The `cargo check` fast-feedback path** (C1): pre-baked check
  fingerprint in the disk image + a `cargo check (fast)` task. New here;
  complements `cargo run`, does not replace it.
- **In-VM verification of the existing lean dev profile + pre-bakes** (S1,
  from #17/#31) as the load-bearing reason the real rebuild is ~58 s — via
  the e2e (Measurement 4), which now also guards against regressions.
- **The measurement rig** (`experiments/issue-41/`) behind every number,
  including `results/in-vm-ab.md` for the decisive A/B.
- The case study (R4–R8), cited research (R7), and the full ranked plan
  (R1, R9, R10, R12) — including the **honest, measured rejection of
  `lld`**.

**Investigated and rejected (not shipped):** the `lld` linker swap — a
−85 % *native* syscall win that *regressed* the real in-VM rebuild
(58 s → >180 s timeout). Reverted; documented above as the headline
finding.

**Proposed, not shipped:** S2 (in-memory `target/`), S3 (re-enable
incremental — depends on S2), S4–S7. S2/S3 need a CheerpX device check and
an in-browser before/after (now possible with `vm.benchCargo`); the rest
are blocked on our toolchain or orthogonal. Each is specified precisely
enough to land in a focused follow-up validated by the bench harness and
`disk-image.yml` CI.

## Verification

```sh
# JS glue + this PR's regression tests (no browser/docker needed):
node --test web/tests/

# Rust template still builds/lints/tests:
cargo fmt --check && cargo clippy --all-targets --all-features && cargo test

# Reproduce the native measurements (docker, i386):
cd experiments/issue-41 && docker build -f Dockerfile.measure -t rwb-issue41-measure . \
  && docker run --rm -v "$PWD/results:/out" rwb-issue41-measure /measure-linker.sh
```

The **net** in-browser behaviour of the shipped disk — the lean profile,
the warm pre-bakes, and the `cargo check` path — is exercised by
`disk-image.yml`, which builds the ext2, boots it in a headless browser,
and runs a real edited `cargo run` (`local-pages-e2e.test.mjs` subtest 2).
That same gate is what produced Measurement 4: GNU `ld` passes at ~58 s,
`lld` timed out — the evidence that reverting `lld` was correct. It is the
same CI gate that validated issues #17/#31.

## References

See [`online-research.md`](./online-research.md) for the full, cited
source list (CheerpX docs/blog, The Rust Performance Book, the LLD/mold
linker write-ups, Cranelift status, sccache). Measurement data lives in
[`experiments/issue-41/results/`](../../../experiments/issue-41/results/),
including [`in-vm-ab.md`](../../../experiments/issue-41/results/in-vm-ab.md)
for the decisive in-VM A/B.
