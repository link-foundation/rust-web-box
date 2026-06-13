---
bump: minor
---

### Added

- A fast `cargo check` edit→feedback path (issue #41): the warm disk now pre-bakes `cargo check` alongside the debug/release builds, the seeded `.vscode/tasks.json` offers a `cargo check (fast)` task, and the terminal banner points users at it. `cargo check` skips codegen and linking, so it surfaces compile errors in seconds where a full rebuild under x86→WASM emulation takes minutes — and it writes strictly fewer fresh inodes, so it never increases CheerpX OverlayDevice wedge pressure.
- A deep performance case study in `docs/case-studies/issue-41/`: evidence (the two-`cargo run` screenshot + transcript), cited online research on CheerpX emulation overhead and Rust compile-time levers, an anti-fake verification of the VM, a two-factor root-cause analysis of the 6m04s rebuild, and a ranked catalogue of every improvement option (shipped vs. proposed) with existing components/libraries.
- A reproducible performance-benchmark recipe in `experiments/issue-41-perf-bench.md` for attributing the in-browser rebuild time across front-end, codegen, and linking.

### Changed

- The disk-image smoke test now verifies the `cargo check` pre-bake and runs `cargo check` on the edited source.
- Existing untouched workspaces are migrated to the new `tasks.json` that includes the `cargo check (fast)` task.
