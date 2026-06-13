# Online research — in-browser VM and Rust compile performance

Research backing the root-cause analysis and solution plans in
[`README.md`](./README.md). Every claim that informs a decision is cited
to a primary source. Captured 2026-06-13.

## 1. CheerpX is fundamentally an emulator with a real, large overhead

CheerpX runs x86 binaries by translating them to WebAssembly. It is
*not* free:

- **"CheerpX is expected to run complex applications 5x–10x slower than
  native"**, with the slowdown "as low as 2x–3x for binaries that only
  stress the best optimized parts of the CheerpX execution pipeline."
  — Leaning Technologies, *CheerpX 1.0*
  (<https://labs.leaningtech.com/blog/cx-10>).
- The engine is **two-tier**: "both an interpreter and a sophisticated
  JIT compiler that is able to generate efficient WebAssembly
  representations for hot code." Cold code runs in the **interpreter**
  "executing one instruction at a time" before the JIT promotes hot
  paths. — CheerpX docs overview (<https://cheerpx.io/docs/overview>)
  and *CheerpX 1.0*.
- The performance gap is worst for **floating-point and vector**
  workloads: the team's stated roadmap is to bring "optimizations
  already implemented for the integer pipeline to both the floating
  point and vector pipelines" to get "the average application to be at
  most 5x slower than native." — *CheerpX 1.0*.

**Why this matters for `rustc`:** `rustc`/LLVM is close to the
*pathological* case for a tiered JIT, not the 2–3× best case:

1. It is an enormous binary with a huge, branchy instruction footprint —
   much of the code runs **once** (cold), so it stays in the slow
   interpreter and never amortises a JIT promotion.
2. LLVM's optimizer is heavy on the exact pipelines CheerpX calls out as
   slowest.
3. Process startup (`cargo` → `rustc` → `cc`/`ld`) pays the cold-start
   penalty **per process**, every run.

This is why the observed slowdown (≈360× vs. a native sub-second
rebuild — see [`evidence/terminal-transcript.md`](./evidence/terminal-transcript.md))
is far larger than the headline "5–10×": that figure is for hot,
integer, steady-state code, which a one-shot compiler invocation is not.

## 2. The browser VM is single-core (no parallel codegen)

- WebVM/CheerpX require **SharedArrayBuffer** behind COOP/COEP cross
  origin isolation (which this repo already sets up in `web/sw.js` /
  `coi-bootstrap.js`). — CheerpX FAQ
  (<https://cheerpx.io/docs/faq>), corroborated by
  <https://blog.51sec.org/2025/01/no-vps-no-server-running-linux-vm-in.html>.
- In practice the emulated Linux runs as a **single CPU** (uniprocessor)
  — there is no SMP guest, so Cargo/rustc cannot fan codegen work out
  across cores the way a native multi-core box does. This is *verifiable
  inside the running app* with `nproc` (recommended check, see
  README → verification). The practical consequence: knobs that rely on
  parallelism (`-Zthreads`, high `codegen-units` overlapping across
  cores, `cargo`'s parallel job graph) give little or nothing here.

## 3. Rust's own compile-time levers (the Rust Performance Book)

From *The Rust Performance Book*, "Build Configuration"
(<https://nnethercote.github.io/perf-book/build-configuration.html>) and
*Compile Times* (<https://nnethercote.github.io/perf-book/compile-times.html>):

| Lever | Effect (quoted) | Applicability here |
|-------|-----------------|--------------------|
| `debug = false` (no debuginfo) | "can improve dev build times significantly, by as much as **20–40%**" | **Already set** (`debug = 0`, issue #31). Confirms it was the right call. |
| `strip = "debuginfo"` / `split-debuginfo` | skip emitting/linking debug info | Additive to `debug=0`; small extra win, less link work. |
| Faster linker (`lld`, then `mold`, then `wild`) | linker choice "has no trade-offs"; LLD "default linker on Linux since Rust 1.90" | **High-value, not yet applied.** Linking is a separate large process under emulation. |
| `codegen-units = 1` | trades "increased compile times" for runtime speed / smaller binary | This repo sets `1` **deliberately** to minimise OverlayDevice inode churn (issues #17/#31) — i.e. it *costs* compile speed to dodge a CheerpX bug. A genuine tension, documented in README. |
| Cranelift backend | "may reduce compile times … recommended for dev builds" — **20–30%** faster debug codegen | **Blocked here** (see §4). |
| Parallel front-end `-Zthreads=N` | "reduces compile times by up to **50%**" | Needs multiple cores → little benefit on a single-core guest (§2). |
| `cargo check` instead of `cargo build` | checks for errors "without producing an executable binary" — skips codegen + link entirely | The single biggest lever for the **edit→feedback** loop. |

Linker numbers specifically: the Rust team reports LLD gives "roughly 7×
faster linking on incremental rebuilds, … around a 40% reduction in
end-to-end compilation time for projects like ripgrep"
(<https://blog.rust-lang.org/2025/09/01/rust-lld-on-1.90.0-stable>), and
David Lattimore documents taking a warm edit-build-run cycle "from 20
seconds to 1.2 seconds" by combining a fast linker with `debug=0` and
related settings
(<https://davidlattimore.github.io/posts/2024/02/04/speeding-up-the-rust-edit-build-run-cycle.html>).

## 4. Cranelift is *not* directly usable on this disk (i386)

The Cranelift backend is the most-cited "faster debug builds" option
(20–30%: <https://www.phoronix.com/news/Rust-Cranelift-Merged>,
<https://lwn.net/Articles/964735/>), **but**:

- It ships only as a **nightly** `rustup` component "on Linux, macOS and
  x86_64 Windows."
  (<https://github.com/rust-lang/rustc_codegen_cranelift>).
- The production-ready goal explicitly targets **x86_64 and aarch64**,
  not 32-bit x86
  (<https://rust-lang.github.io/rust-project-goals/2025h2/production-ready-cranelift.html>).
- CheerpX requires **i386 (32-bit x86)** userspace (it JITs x86→WASM and
  the reference image is `i386/alpine`). The disk ships Alpine's
  **stable** `rust`/`cargo`, not rustup nightly.

So Cranelift would require: switching the disk to a rustup-managed
nightly toolchain *and* a 32-bit-x86-capable Cranelift component that is
not currently distributed. It stays a **research/long-shot** plan, not a
quick win.

## 5. Compiler caching (sccache) — bounded value here

`sccache` caches compiled artifacts keyed by input hash
(<https://github.com/mozilla/sccache>). For a **single leaf binary
crate** that the user is actively editing, every edit changes the hash,
so sccache helps **dependencies** (cached once) far more than the crate
under edit. It is worth it once the workspace pulls real dependencies,
not for the hello-world rebuild that the issue screenshots.

## 6. Radical alternatives (surveyed, mostly out of scope)

- **Run `rustc` as native WASM/WASI instead of x86-under-CheerpX.** This
  removes the emulation layer entirely but is a research effort: there is
  no supported, drop-in `wasm32-wasi` host build of `rustc`+`cargo`+LLVM
  that runs a full edit-compile-run loop in the browser today. Tracked as
  a long-horizon idea.
- **Server-side / remote compile.** Fast, but breaks the core product
  promise of a *client-side, serverless* sandbox (the whole reason for
  CheerpX). Out of scope.
- **Cheerp (C++→WASM) for the toolchain.** Not applicable to a Rust
  toolchain.

## Sources

- CheerpX 1.0 — <https://labs.leaningtech.com/blog/cx-10>
- CheerpX docs overview — <https://cheerpx.io/docs/overview>
- CheerpX FAQ — <https://cheerpx.io/docs/faq>
- WebVM (leaningtech/webvm) — <https://github.com/leaningtech/webvm>
- Mini.WebVM from Dockerfile — <https://labs.leaningtech.com/blog/mini-webvm-your-linux-box-from-dockerfile-via-wasm>
- The Rust Performance Book — Build Configuration — <https://nnethercote.github.io/perf-book/build-configuration.html>
- The Rust Performance Book — Compile Times — <https://nnethercote.github.io/perf-book/compile-times.html>
- Faster linking with LLD on 1.90 — <https://blog.rust-lang.org/2025/09/01/rust-lld-on-1.90.0-stable>
- Speeding up the Rust edit-build-run cycle (David Lattimore) — <https://davidlattimore.github.io/posts/2024/02/04/speeding-up-the-rust-edit-build-run-cycle.html>
- rustc_codegen_cranelift — <https://github.com/rust-lang/rustc_codegen_cranelift>
- Production-ready Cranelift goal — <https://rust-lang.github.io/rust-project-goals/2025h2/production-ready-cranelift.html>
- Cranelift merged (Phoronix) — <https://www.phoronix.com/news/Rust-Cranelift-Merged>
- Cranelift comes to Rust (LWN) — <https://lwn.net/Articles/964735/>
- sccache — <https://github.com/mozilla/sccache>
- How to speed up the Rust compiler, May 2025 (Nethercote) — <https://nnethercote.github.io/2025/05/22/how-to-speed-up-the-rust-compiler-in-may-2025.html>
