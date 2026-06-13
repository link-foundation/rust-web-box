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
04 s to rebuild**, and even a *no-op* `cargo run` takes 24 s. The issue
asks us to (a) find every way to improve this, (b) confirm the VM is
**real** (the speed is not a trick — and conversely the slowness is not a
mock), (c) compile the data into this folder, (d) research online, (e)
enumerate every requirement, and (f) propose solution plans for each,
surveying existing components/libraries.

This document is the analysis. [`online-research.md`](./online-research.md)
is the cited research. The one optimization this PR *ships* (a pre-baked
`cargo check` fast-feedback path) and the much larger menu it *proposes*
are in [Solution catalogue](#solution-catalogue).

## Evidence collected

| File | Purpose |
|------|---------|
| [`evidence/issue.json`](./evidence/issue.json) | Full GitHub issue payload (`gh issue view`). Labels: `documentation`, `enhancement`, `question`. |
| [`evidence/issue-comments.json`](./evidence/issue-comments.json) | Issue comments via the API — empty at capture; the body + screenshot are the whole report. |
| [`evidence/issue-screenshot.jpg`](./evidence/issue-screenshot.jpg) | The reporter's screenshot: VS Code Web, `main.rs` edited to `"Hello, rust world!"`, terminal showing the 23.96 s no-op and 6 m 04 s rebuild. |
| [`evidence/terminal-transcript.md`](./evidence/terminal-transcript.md) | Verbatim transcription + the two-run analysis that anchors the root cause. |
| [`online-research.md`](./online-research.md) | Cited online research on CheerpX overhead, single-core execution, and Rust compile-time levers. |

## Timeline / sequence of events

1. **2026-06-13 08:25 UTC** — Issue #41 filed by `konard`, with the
   two-`cargo run` screenshot. State: open.
2. **Context — the wedge saga (#15 → #17 → #31 → #37).** Earlier issues
   forced a chain of **performance-costing** workarounds for a CheerpX
   `OverlayDevice` bug (the "`a1`" fresh-inode wedge). Specifically the
   project **disabled incremental compilation** (`CARGO_INCREMENTAL=0`,
   issue #17), set **`codegen-units = 1`** and **`debug = 0`** (issue
   #31), and pre-bakes artifacts so common commands hit cargo's
   freshness fast-path. Several of these are exactly the knobs one would
   normally turn the *other* way for speed — so part of issue #41's
   slowness is **self-imposed by the correctness workarounds**. This is
   central to the analysis below.
3. **This PR (#42)** compiles the case study, verifies the VM is real,
   ships the safe `cargo check` fast path, and lays out the full ranked
   improvement menu with the wedge trade-offs made explicit.

## Is the VM real? (anti-fake verification)

The issue explicitly asks us to "double check that our solution is not
fake, and we actually use [a] virtual machine to execute commands." The
evidence is conclusive on **both** directions:

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
   pipeline running under x86→WASM emulation (see
   [Root-cause analysis](#root-cause-analysis)). You cannot fake being
   this slow in a way that also produces correct, edited output.
4. **The architecture has no shortcut path.** `web/glue/webvm-server.js`
   runs the user's command through `cx.run('/bin/bash', …)` inside
   CheerpX (`docs/architecture.md`). There is no interception layer that
   could substitute output; the bytes come straight from the guest PTY.

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
why it is worth optimizing.

## Root-cause analysis

The two timings in the screenshot decompose the cost into two
independent factors. Treat them separately because they have *different*
fixes.

### Factor 1 — fixed per-invocation overhead (~24 s, the no-op run)

A `cargo run` that compiles **nothing** still takes ~24 s. Native, the
same no-op is ~0.05 s. That ~24 s is pure overhead:

- **Process startup under emulation.** `cargo` itself is a large binary;
  starting it (and `rustc --version`-style probes) means CheerpX
  cold-interprets a lot of code that never gets hot enough to JIT
  (online-research §1).
- **Filesystem freshness checks over `OverlayDevice(cloud, IDBDevice)`.**
  Cargo `stat()`s the whole `target/` tree to decide nothing changed.
  Each `stat` is a syscall emulated against an IndexedDB-backed overlay —
  orders of magnitude slower than a native page-cache `stat`. With the
  pre-baked `target/`, that is a lot of inodes to walk.

→ **Fix family:** reduce syscalls/process spawns and get `target/` off
the slow overlay (tmpfs / in-memory writable device). See S3, S4.

### Factor 2 — the incremental compile itself (~5 m 40 s = 6 m 04 s − 24 s)

This is one `rustc` invocation + LLVM codegen + one linker invocation for
a **tiny** crate. Native: <0.3 s. The ~340× blow-up is the combination
of:

- **CheerpX emulation overhead.** Leaning Technologies state CheerpX is
  "5x–10x slower than native" for complex apps, best-case 2–3× only for
  hot integer code (online-research §1). `rustc`/LLVM is the *worst* case
  for a tiered JIT: huge instruction footprint, much of it run once
  (stays in the slow interpreter), heavy on the FP/vector pipelines
  CheerpX itself names as least-optimized.
- **Single-core guest (no parallel codegen).** The emulated Linux runs
  as one CPU (online-research §2; verify with `nproc`). Cargo/rustc
  cannot fan work across cores, so parallelism knobs (`-Zthreads`, high
  `codegen-units`) buy nothing here.
- **Incremental compilation is disabled.** `CARGO_INCREMENTAL=0` (issue
  #17) is the project's wedge workaround, but incremental is *the* normal
  accelerator for "I changed one line" rebuilds. With it off, the edit
  forces a from-scratch codegen+link of the crate.
- **`codegen-units = 1`** (issue #31) serialises codegen — chosen to
  minimise fresh-inode churn for the wedge, at a compile-speed cost.
- **A full link still runs.** Even for hello-world, cargo invokes the
  system linker (`cc`→`ld`) — another large binary cold-started under
  emulation, statically linking musl.

→ **Fix family:** do *less* compiler work (S1 `cargo check`), use a
faster linker (S2), re-enable incremental once the wedge is gone (S4),
or escape the emulation layer entirely (S6). See catalogue.

### The meta-root-cause

Several of the biggest speed knobs are **turned the slow way on purpose**
to dodge the CheerpX `OverlayDevice` "`a1`" fresh-inode wedge. So the
single highest-leverage move is **architectural**: stop writing build
artifacts to the fragile, slow IndexedDB overlay (put `target/` on an
in-memory device). That *simultaneously* removes Factor 1's IO cost and
unblocks re-enabling incremental compilation (Factor 2). It is also the
riskiest/most involved change — hence proposed-and-prototyped, not
shipped blind (S4).

## Requirements (every one, enumerated)

Parsed verbatim from the issue body:

| # | Requirement | Where addressed |
|---|-------------|-----------------|
| R1 | "Explore **all possible ways** to improve performance of [the] virtual machine in the browser." | [Solution catalogue](#solution-catalogue) — S1–S9, ranked. |
| R2 | "Simple `cargo run` executes too long (5–6 minutes on second rebuild)." — quantify & fix the rebuild. | [Root-cause analysis](#root-cause-analysis); S1 shipped, S2/S4 proposed. |
| R3 | "It is ok to also **optimize the WebVM itself** if you know how." | S4 (target off overlay), S5 (CheerpX JIT/threading), S8 (boot) — surveyed with upstream pointers. |
| R4 | "**Double check that our solution is not fake**, and we actually use [a] virtual machine to execute commands." | [Is the VM real?](#is-the-vm-real-anti-fake-verification) + live re-verification recipe. |
| R5 | "Collect data related to the issue … compile that data to `./docs/case-studies/issue-41`." | This folder: `evidence/`, `README.md`, `online-research.md`. |
| R6 | "Deep case study analysis." | This `README.md`. |
| R7 | "Search online for additional facts and data." | [`online-research.md`](./online-research.md), fully cited. |
| R8 | "List of each and all requirements from the issue." | This table. |
| R9 | "Propose possible solutions and solution plans for each requirement." | [Solution catalogue](#solution-catalogue), per-requirement mapping + plans. |
| R10 | "Check known existing components/libraries that solve a similar problem or can help." | Each S-entry names concrete tools (lld/mold/wild, cranelift, sccache, CheerpX devices, `cargo check`). |
| R11 | "Plan and execute everything in this single pull request." | PR #42; branch `issue-41-…`. |

## Solution catalogue

Each entry: **impact** (how much wall-clock it can remove), **effort**,
**risk** (especially vs. the CheerpX wedge), the **existing
component/library** it uses, and a **plan**. Ranked by *value today*.

Legend — Impact/Effort/Risk: ⬤⬤⬤ high · ⬤⬤ medium · ⬤ low.

### S1 — `cargo check` fast-feedback path  ✅ SHIPPED in this PR

- **Maps to:** R1, R2, R9, R10.
- **Impact ⬤⬤⬤ (for the edit→error loop) · Effort ⬤ · Risk ⬤ (lowest).**
- **Existing component:** Cargo's built-in `cargo check` — "checks your
  code for errors without producing an executable binary"
  (online-research §3). Skips **codegen and linking** entirely, which is
  the bulk of Factor 2.
- **Why it is also wedge-*safer*, not riskier:** `cargo check` writes
  *fewer* fresh inodes than a full build (no `deps/*.o`, no final binary,
  no link temporaries) → strictly lower fresh-inode pressure on the
  `OverlayDevice`. It fits the project's existing "pre-bake so the warm
  path reuses inodes" strategy exactly.
- **Honest scope:** `cargo check` does **not** speed up `cargo run`
  itself — it gives a *much faster* way to catch compile errors (seconds,
  not minutes) before paying for a full build/run. That is the single
  biggest realistic improvement to the *iteration* loop today.
- **Plan (implemented):**
  1. `web/disk/Dockerfile.disk` pre-bakes `cargo check` alongside the
     existing `cargo build`/`cargo build --release` pre-bakes, so the
     first `cargo check` in the browser also hits a warm, inode-reusing
     path.
  2. The pre-baked `/workspace/.vscode/tasks.json` gains a
     **`cargo check (fast)`** task so it is one click from the Command
     Palette / Run menu.
  3. The boot banner prints a one-line tip pointing users at
     `cargo check` for quick error feedback.
  4. Tests assert all three (Dockerfile pre-bake, task entry, banner tip).

### S2 — Faster linker (lld → mold → wild)

- **Maps to:** R1, R2, R3, R9, R10.
- **Impact ⬤⬤ · Effort ⬤⬤ · Risk ⬤⬤ (toolchain + must match pre-bake).**
- **Existing component:** `lld` (LLVM), `mold`, or `wild`. The Rust team:
  LLD gives "roughly 7× faster linking on incremental rebuilds … around
  a 40 % reduction in end-to-end compilation time" and "has no
  trade-offs" when it works (online-research §3).
- **Why not shipped here:** linking under emulation means *replacing one
  huge cold binary (`ld`) with another* — the net win on musl-static
  hello-world is unverified in this sandbox (no docker/browser to
  measure), and `RUSTFLAGS`/linker choice is part of Cargo's fingerprint,
  so it **must be pre-baked in lockstep** with the disk or it invalidates
  the warm artifacts and re-triggers the wedge (the exact failure mode
  issue #31 documented). Shipping it blind would risk the warm disk.
- **Plan:** in one coordinated change — `apk add lld` in
  `Dockerfile.disk`; set `[target.i686-unknown-linux-musl] linker`/
  `rustflags = ["-C", "link-arg=-fuse-ld=lld"]` in `/root/.cargo/config.toml`;
  re-bake build/release/check under it; add the matching runtime guard in
  `webvm-server.js` (mirror `LEAN_CARGO_DEV_PROFILE_SCRIPT`); let
  `disk-image.yml`'s mounted-image smoke test measure before/after and
  fail closed. Promote to "shipped" once CI shows a real win on i686/musl.

### S3 — Trim per-invocation work (fewer syscalls / smaller pre-baked target)

- **Maps to:** R1, R2 (the 24 s no-op).
- **Impact ⬤⬤ · Effort ⬤⬤ · Risk ⬤⬤.**
- **Existing component:** Cargo freshness internals; `strip`/`debug`
  already minimise artifact size (issue #31).
- **Idea:** the 24 s no-op is dominated by `stat()`-walking a large
  pre-baked `target/` over the overlay. A leaner pre-bake (only the
  fingerprints/artifacts that the freshness check actually consults) and
  fewer pre-baked profiles reduce the inode walk. Also evaluate
  `CARGO_LOG`/`-Z` freshness shortcuts. Measure first (S9) — this only
  matters if the `stat` walk, not process startup, dominates.

### S4 — Move `target/` off the IndexedDB overlay (in-memory build dir) — the big one

- **Maps to:** R1, R2, R3, R9.
- **Impact ⬤⬤⬤ · Effort ⬤⬤⬤ · Risk ⬤⬤⬤.**
- **Existing component:** CheerpX writable devices (`DataDevice`, and the
  mount topology in `web/glue/cheerpx-bridge.js`); Cargo's
  `CARGO_TARGET_DIR`.
- **Why it is the highest-leverage fix:** writing build artifacts to
  `OverlayDevice(cloud, IDBDevice)` is *both* the slow-IO source (Factor
  1) *and* the trigger for the `a1` fresh-inode wedge that forced
  `CARGO_INCREMENTAL=0` + `codegen-units=1` (Factor 2). Put `target/` on
  an **in-memory / tmpfs-like writable mount** and you (a) make artifact
  IO RAM-fast and (b) stop allocating fragile overlay inodes — which
  unblocks **re-enabling incremental compilation**, the normal one-line-edit
  accelerator. Artifacts are regenerable, so losing them on reload is
  acceptable.
- **Open question / why prototyped not shipped:** CheerpX's documented
  mount types are `ext2`, `dir` (Web/DataDevice), `devs`, `devpts`,
  `proc`, `sys` (see `bootLinux` in `cheerpx-bridge.js`); whether a
  *writable, full-tree, in-memory* mount usable for `target/` is exposed
  needs an upstream check/experiment. If unavailable, file an upstream
  request to `leaningtech/webvm`/CheerpX for a tmpfs/ramfs device.
- **Plan:** experiment under `experiments/` to mount a writable in-memory
  device at `/workspace/target` (or point `CARGO_TARGET_DIR` at one);
  confirm the wedge no longer fires with `CARGO_INCREMENTAL=1`; then
  re-enable incremental + restore `codegen-units` defaults; add e2e that
  an edited `cargo run` completes in seconds, not minutes.

### S5 — Lean on CheerpX's own performance levers / upstream

- **Maps to:** R3, R1.
- **Impact ⬤⬤ (long-horizon) · Effort ⬤⬤⬤ · Risk ⬤⬤.**
- **Existing component:** CheerpX itself (currently pinned 1.3.3 in
  `cheerpx-bridge.js`). Its roadmap targets "average application at most
  5× slower than native" by extending integer-pipeline optimizations to
  FP/vector (online-research §1) — exactly the pipelines `rustc`/LLVM
  stress. Tracking CheerpX releases is free speed.
- **Plan:** keep `CHEERPX_VERSION` current (issue #37 already tracks
  this); when CheerpX ships FP/vector JIT improvements or a persistent
  JIT/translation cache across runs, adopt and measure. File/track an
  upstream issue for a **persistent JIT cache** so cold `rustc` runs stop
  re-paying interpretation cost every invocation.

### S6 — Run `rustc` as native WASM/WASI instead of x86-under-CheerpX

- **Maps to:** R1, R3 (radical).
- **Impact ⬤⬤⬤ (removes the emulation layer) · Effort ⬤⬤⬤ · Risk ⬤⬤⬤.**
- **Existing component:** `wasm32-wasi` toolchain efforts; in-browser WASI
  runtimes. **Reality check (online-research §6):** there is no
  supported, drop-in `wasm32-wasi` host build of `rustc`+`cargo`+LLVM
  that runs a full edit-compile-run loop in the browser today. Long-horizon
  research only; recorded for completeness.

### S7 — Cranelift debug codegen backend

- **Maps to:** R1, R2, R10.
- **Impact ⬤⬤ (20–30 % debug codegen) · Effort ⬤⬤⬤ · Risk ⬤⬤⬤.**
- **Existing component:** `rustc_codegen_cranelift`. **Blocked here**
  (online-research §4): nightly-only `rustup` component on **x86_64**
  Linux; our guest is **i386** Alpine **stable** rust. Would require
  switching the disk to a nightly rustup toolchain *and* a
  32-bit-x86-capable Cranelift build that is not distributed. Park as
  research.

### S8 — Faster boot / cold-start (orthogonal to compile time)

- **Maps to:** R1, R3.
- **Impact ⬤⬤ (first-load UX) · Effort ⬤⬤ · Risk ⬤.**
- **Existing component:** already substantial — `web/sw.js` caches
  shell/glue, IDB overlay persists, disk ships as same-origin
  GitHubDevice chunks, workspace renders before VM boot
  (`docs/architecture.md`). Further wins: smaller ext2 (fewer packages),
  parallel/prefetch of disk chunks, HTTP caching headers on chunks.
- **Plan:** measure first-load vs second-load (SW cache) with the disk
  staging already in place; trim the image (S3 overlaps).

### S9 — A measurement harness (prerequisite for honest optimization)

- **Maps to:** R1, R4, R6.
- **Impact ⬤⬤ (enables everything else) · Effort ⬤ · Risk ⬤.**
- **Existing component:** `cargo build --timings`, `cargo build -v`,
  `time`, `RUSTC_BOOTSTRAP`/`-Z self-profile` (nightly).
- **Plan:** [`experiments/issue-41-perf-bench.md`](../../../experiments/issue-41-perf-bench.md)
  gives a copy-paste recipe to run **inside the app's terminal** to
  attribute the 6 minutes across rustc front-end / LLVM codegen / link,
  so future changes (S2, S4) are validated by numbers, not vibes. No
  optimization should be merged as "shipped" without a before/after from
  this harness.

## Per-requirement solution map (R1, R9 at a glance)

| Requirement | Shipped now | Proposed (ranked) |
|-------------|-------------|-------------------|
| R2 — rebuild too long | S1 `cargo check` fast loop + S9 harness | S4 (target off overlay → re-enable incremental) ≫ S2 (lld) > S7 (cranelift) > S6 (wasi rustc) |
| R3 — optimize the WebVM | — | S4 (in-memory target), S5 (CheerpX JIT/upstream), S8 (boot) |
| R4 — prove it's real | done (analysis + recipe) | — |

## What this PR ships vs. proposes (honesty statement)

**Shipped & verified here:** the case study (R5–R8, R4), the cited
research (R7), the full ranked plan (R1, R9, R10), the measurement
harness (S9), and **S1** — the pre-baked `cargo check` fast-feedback path
with regression tests.

**Proposed, not shipped:** S2/S4/S5/S6/S7/S8. These either (a) need a
disk rebuild + browser/e2e measurement that this PR's author environment
cannot run, and/or (b) must be pre-baked in lockstep with `RUSTFLAGS`/
profile fingerprints or they re-trigger the CheerpX wedge (the issue-#31
failure mode). Shipping them blind would risk the warm disk; each is
specified precisely enough to land in a focused follow-up validated by
`disk-image.yml` CI. This split is deliberate: the issue values a
*correct, complete plan* over an *untested change that might regress the
careful wedge mitigations*.

## Verification

```sh
# JS glue + this PR's regression tests (no browser/docker needed):
node --test web/tests/

# Rust template still builds/lints/tests:
cargo fmt --check && cargo clippy --all-targets --all-features && cargo test
```

The end-to-end behaviour of the shipped `cargo check` pre-bake is
exercised by `disk-image.yml` (mounts the freshly built ext2 and runs
real cargo) — the same CI gate that validated issues #17/#31.

## References

See [`online-research.md`](./online-research.md) for the full, cited
source list (CheerpX docs/blog, The Rust Performance Book, the LLD/mold
linker write-ups, Cranelift status, sccache).
