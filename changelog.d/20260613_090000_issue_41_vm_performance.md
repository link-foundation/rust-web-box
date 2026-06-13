---
bump: minor
---

### Changed

- **The in-browser disk now links Rust binaries with `lld` instead of GNU `ld` (issue #41).** This is the measured fix for the slow `cargo run`: on the exact i386 Alpine toolchain the disk ships, a one-line-edit rebuild issues ~14,700 filesystem syscalls when linking with GNU `ld` but only ~2,150 with `lld` (−85 %), with the process count unchanged. Under CheerpX every filesystem syscall crosses the WASM/JS boundary into the IndexedDB overlay, and linking is ~68 % of compile time, so swapping the linker directly attacks the dominant cost of the *actual* build — no workaround, no change to what the user runs. The linker config is baked before the pre-bake build so the warm `target/` stays valid (first in-browser `cargo run` remains a no-op).

### Added

- Opt-in in-VM performance tracing (issue #41): `vm.benchCargo` runs the user's **real** `cargo run` / `cargo build` / `cargo check` inside the guest across four phases (no-op run, one-line-edit run, edit build, edit check) plus an optional `rustc -Z time-passes` split, and ships per-phase wall-clock back over the existing OSC-frame stdout channel; `globalThis.__RWB_DEBUG_VM_TIMING` records per-`cx.run` wall-clock. Both are zero-overhead when off and reuse the real `cx.run` path, so the bottleneck can be measured in the browser on the real VM.
- A measurement-driven performance case study in `docs/case-studies/issue-41/`, backed by a reproducible docker rig in `experiments/issue-41/`: native i386 syscall/linker measurements (the basis for the `lld` fix), the front-end/codegen/link time split, an anti-fake verification of the VM, and a ranked catalogue of every improvement option (shipped `lld` vs. proposed in-memory `target/` → re-enabled incremental, CheerpX upstream, cranelift).
- A complementary `cargo check` fast-feedback path: the warm disk pre-bakes `cargo check` and the seeded `.vscode/tasks.json` offers a `cargo check (fast)` task. `cargo check` skips codegen and linking, so it surfaces compile errors in seconds — useful for the edit→error loop, though (unlike the `lld` change above) it does not make `cargo run` itself faster.

### Changed

- The disk-image smoke test verifies the `cargo check` pre-bake and runs `cargo check` on the edited source; existing untouched workspaces are migrated to the `tasks.json` that includes the `cargo check (fast)` task.
