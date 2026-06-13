---
bump: minor
---

### Added

- Opt-in in-VM performance tracing (issue #41): `vm.benchCargo` runs the user's **real** `cargo run` / `cargo build` / `cargo check` inside the guest across four phases (no-op run, one-line-edit run, edit build, edit check) plus an optional `rustc -Z time-passes` split, and ships per-phase wall-clock back over the existing OSC-frame stdout channel; `globalThis.__RWB_DEBUG_VM_TIMING` records per-`cx.run` wall-clock. Both are zero-overhead when off and reuse the real `cx.run` path, so the bottleneck can be measured in the browser on the real VM.
- A `cargo check` fast-feedback path: the warm disk pre-bakes `cargo check` and the seeded `.vscode/tasks.json` offers a `cargo check (fast)` task. `cargo check` skips codegen and linking, so it surfaces compile errors in seconds — it speeds up the edit→error loop, not `cargo run` itself.
- A measurement-driven performance case study in `docs/case-studies/issue-41/`, backed by a reproducible docker rig in `experiments/issue-41/`: native i386 syscall/linker measurements, the front-end/codegen/link time split, an anti-fake verification that commands run on the real VM, the decisive in-VM e2e A/B, and a ranked catalogue of every improvement option — including the `lld` linker swap that looked like the fix on native syscall counts but regressed the real VM and was reverted (see below).
- Two **on-demand-only** (`workflow_dispatch`) CI workflows so benchmarks never run on a local machine: `.github/workflows/perf-bench.yml` runs the native i386 measurement rig and the **real** in-VM `cargo` benchmark (with a read-only `mount`/`df`/`nproc` storage+CPU probe), and `.github/workflows/ui-e2e.yml` runs a full UI-driven end-to-end test. Both publish a Markdown job summary and upload artifacts under `docs/case-studies/issue-41/data/`.
- `web/tests/e2e/ui-driven-e2e.test.mjs` — a UI-driven e2e that drives the **real** VS Code Web UI in order: `cargo run` typed into the integrated terminal (assert the seed greeting) → edit `src/main.rs` in the Monaco editor with a unique per-run marker (real Ctrl+S `FileSystemProvider` save) → `cargo run` again (assert the **new** marker *and* `Compiling`). The brand-new marker + `Compiling` are the anti-fake gate: a cached or pre-baked binary cannot print a marker that did not exist until this run.

### Changed

- The disk-image smoke test and end-to-end test now verify the `cargo check` pre-bake and run `cargo check` on the edited source; the e2e additionally times a **real** edited `cargo run` in the booted CheerpX VM (180 s ceiling) so a rebuild regression fails CI. Existing untouched workspaces are migrated to the `tasks.json` that includes the `cargo check (fast)` task.

### Investigated, not shipped

- **Linking with `lld` instead of GNU `ld` was tried and reverted (issue #41).** On the i386 Alpine toolchain the disk ships, a one-line-edit rebuild issues ~85 % fewer filesystem syscalls with `lld` (≈14,700 → ≈2,150), which looked like the fix for the slow `cargo run`. But the project's own in-VM e2e proved the opposite: with `lld` the real edited `cargo run` went from ~58 s to a >180 s timeout, because CheerpX must x86→WASM-JIT the much larger LLVM linker on first use and that cold-JIT cost dwarfs the syscall saving. Native syscall count was the wrong proxy for in-VM wall-clock. The disk keeps GNU `ld`; the load-bearing speedup remains the lean dev profile + warm pre-bakes (issues #17/#31). Full evidence in `docs/case-studies/issue-41/`.
