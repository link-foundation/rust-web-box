# Case Study: Issue #31 - Repeated `cargo run` after editing `main.rs`

Issue: https://github.com/link-foundation/rust-web-box/issues/31

PR: https://github.com/link-foundation/rust-web-box/pull/32

## Summary

The first plain `cargo run` used the pre-baked debug artifact and completed. After editing `src/main.rs`, the next real `cargo run` correctly entered a dev rebuild, then CheerpX exited with code 71 and the page logged `TypeError: e is not a function`.

The fix keeps `cargo run` real. The warm disk now pre-bakes a lean dev profile (`debug = 0`, `codegen-units = 1`, `incremental = false`), the runtime enables the matching Cargo env only when that disk config is present, and the e2e test no longer accepts "entered Compiling before timeout" as success on fixed disks.

## Evidence

| File | Purpose |
| --- | --- |
| `raw/chrome-console.png` | Reporter Chrome screenshot showing second `cargo run` stuck in `Compiling`, followed by code 71 and `TypeError`. |
| `raw/safari-console.png` | Reporter Safari screenshot with the same repeated-run failure. |
| `evidence/live-console-after-timeout.log` | Live reproduction against Pages. The second debug rebuild logs `Program exited with code 71` at about 268.8 seconds. |
| `evidence/live-console-lean-profile-probe.log` | Runtime-only profile probe. It proves old disks cannot receive `CARGO_PROFILE_DEV_DEBUG=0` without invalidating the pre-bake. |
| `verification/webvm-server-before-fix.log` | Reproducing regression tests failing before the implementation. |
| `verification/webvm-server-after-fix.log` | Focused WebVM server tests passing after the implementation. |
| `verification/disk-staging-after-fix.log` | Disk staging tests passing after local-disk staging support was added. |
| `online-research.md` | CheerpX and Cargo references used for the fix. |

## Requirements

1. Repeated `cargo run` after editing `src/main.rs` must work.
2. The command must be real Cargo, not mocked terminal output.
3. VS Code and WebVM workspace state must stay synchronized before commands run.
4. Add e2e coverage that catches the repeated-run failure.
5. Preserve issue evidence and research in `docs/case-studies/issue-31`.

## Root Cause

PR #30 made browser-side saves visible to Cargo and forced edited Cargo inputs newer than warm-disk target artifacts. That fixed stale output, but it exposed the next failure: the second command was now a real debug rebuild inside CheerpX.

The old e2e allowed a timed-out second `cargo run` as long as output showed `Compiling hello`. That masked the exact failure in issue #31: the command could remain in the rebuild path for minutes and then crash the CheerpX runtime with code 71.

The failed runtime-only probe is important: setting lean dev-profile environment variables against the old disk made the first `cargo run` rebuild from scratch and crash around 30 seconds. Cargo profile settings are part of the freshness/fingerprint surface, so the runtime and disk pre-bake must match.

## Fix

- `web/disk/Dockerfile.disk` now writes `[profile.dev] incremental = false`, `debug = 0`, and `codegen-units = 1`, exports matching env in `/root/.bash_profile`, and pre-bakes debug/release artifacts under those settings.
- `web/disk/build.sh` still minimizes the ext2 image for upload, but grows it back by a small writable reserve so edited rebuilds have filesystem headroom.
- `web/glue/webvm-server.js` writes a guarded bash profile. It enables `CARGO_PROFILE_DEV_*` only when `/root/.cargo/config.toml` declares the matching lean profile, so old published disks are not invalidated by new page JavaScript.
- `.github/workflows/disk-image.yml` runs its destructive edited-source smoke test on a copy of the ext2 image before staging the untouched built disk for browser e2e and release.
- `web/tests/helpers/cheerpx-page-harness.mjs` uses the same guard for direct e2e `cx.run` commands.
- `web/tests/e2e/*` now require the edited `cargo run` to complete and print the edited output when the staged disk has the lean profile.
- `.github/workflows/disk-image.yml` now edits `src/main.rs` and reruns real `cargo run` in the mounted image smoke test, then builds the workbench, stages the freshly built disk chunks, and runs the browser e2e suite against that new disk before publishing.
- `web/build/stage-pages-disk.mjs` can stage a local disk image with `WARM_DISK_SOURCE_PATH`, which lets disk-image CI run browser e2e against the disk it just built.

## Verification

- `node --test web/tests/webvm-server.test.mjs`
- `node --test web/tests/disk-staging.test.mjs`
- `node --test web/tests`
- `cargo fmt --all -- --check`
- `cargo clippy --all-targets --all-features`
- `rust-script scripts/check-file-size.rs`
- `cargo test --all-features --verbose`
- `cargo test --doc --verbose`
- `cargo package --list --allow-dirty`

Browser e2e with the fixed disk is intentionally attached to the disk-image workflow, because the regular PR Pages workflow stages the currently published `disk-latest` image.
