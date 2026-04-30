# Case Study: Issue #13 - Usable Rust Web Box Defaults

## Summary

Issue #13 reported that the published workbench booted against the
public WebVM Debian disk instead of the rust-web-box warm Alpine disk.
The terminal showed `tree: command not found`, `cargo: command not
found`, a `mesg: ttyname failed` login-shell warning, and an old
workspace layout with `hello/` plus `hello_world.rs`.

The fix makes the warm disk the production requirement, installs and
verifies `tree`, keeps `cargo` available through the Alpine Rust image,
seeds `/workspace` as a root Cargo project, prepares the login shell
through a hidden fail-fast DataDevice script, and adds CI coverage for
`tree`, `cargo --version`, and `cargo run --release` output.

## Evidence Collected

All issue data captured for this investigation is stored in this
directory:

| File | Purpose |
|------|---------|
| [`issue.json`](./issue.json) | Full GitHub issue payload captured with `gh issue view`. |
| [`issue-comments.json`](./issue-comments.json) | Issue comments from the GitHub API; no comments were present when captured. |
| [`issue-screenshot.png`](./issue-screenshot.png) | Screenshot from the issue body, downloaded from GitHub user attachments and verified as PNG data. |
| [`pr-14.json`](./pr-14.json) | Draft PR metadata before finalizing this fix. |
| [`pr-14-review-comments.json`](./pr-14-review-comments.json) | Inline review comments from PR #14; empty when captured. |
| [`pr-14-reviews.json`](./pr-14-reviews.json) | PR review records from PR #14; empty when captured. |
| [`online-research.md`](./online-research.md) | External documentation reviewed during root-cause analysis. |
| [`verification/web-tests.log`](./verification/web-tests.log) | Full `node --test web/tests/` run. |
| [`verification/build-workbench.log`](./verification/build-workbench.log) | Static workbench build and vendoring run. |
| [`verification/cargo-fmt-check.log`](./verification/cargo-fmt-check.log) | Rust formatting check. |
| [`verification/cargo-clippy.log`](./verification/cargo-clippy.log) | Rust Clippy check. |
| [`verification/cargo-test.log`](./verification/cargo-test.log) | Rust test run. |
| [`verification/check-file-size.log`](./verification/check-file-size.log) | Repository Rust file-size guard. |
| [`verification/git-diff-check.log`](./verification/git-diff-check.log) | Git whitespace check. |
| [`verification/local-smoke.png`](./verification/local-smoke.png) | Playwright local browser smoke screenshot showing `src/main.rs` open and the terminal in `/workspace`. |
| [`verification/playwright-snapshot.md`](./verification/playwright-snapshot.md) | Playwright accessibility snapshot from the local smoke run. |
| [`verification/playwright-console.log`](./verification/playwright-console.log) | Warnings/errors observed during the local browser smoke run. |
| [`verification/playwright-console-errors.log`](./verification/playwright-console-errors.log) | Error-only console capture from the local browser smoke run. |

## Timeline

| Time (UTC) | Event |
|------------|-------|
| 2026-04-30T06:17:23Z | Issue #13 opened with terminal evidence showing Debian fallback, missing `tree`, missing `cargo`, and old workspace files. |
| 2026-04-30 | Issue payload, comments, screenshot, PR metadata, review comments, and review records were captured under this case-study folder. |
| 2026-04-30 | The workspace seed was changed from `/workspace/hello` plus `hello_world.rs` to `/workspace/Cargo.toml` plus `/workspace/src/main.rs`. |
| 2026-04-30 | The warm disk build was changed to install `tree`, create the root Cargo project, pre-build it, and avoid hiding build failures. |
| 2026-04-30 | Pages disk staging was changed to fail closed by default when the warm disk cannot be staged. |
| 2026-04-30 | CI smoke tests were extended to chroot into the image and verify `tree`, `cargo`, and `cargo run --release` output. |

## Requirements From The Issue

1. Fix `mesg: ttyname failed: No such file or directory`.
2. Emit preparation debug output when the site is opened with `?debug`.
3. Make default-mode preparation fail on the first error with useful
   details instead of hiding failures.
4. Ensure `cargo` is installed and usable for Rust work.
5. Ensure `tree` is installed and usable.
6. Unpack the `hello` project to the workspace root.
7. Remove the need for `hello_world.rs`.
8. Keep the default workspace minimal, universal, and easy to modify.
9. Add end-to-end coverage for `tree`, `cargo`, and `cargo run` output
   from `src/main.rs`.
10. Download issue data and logs to `docs/case-studies/issue-13`.
11. Reconstruct the timeline, requirements, root causes, possible
    solutions, and relevant existing components.
12. Search online for additional facts and data.
13. File upstream issues only if the root cause belongs to another
    project.
14. Complete the work in one pull request.

## Root Causes

1. Production Pages staging could deploy without a staged warm disk. In
   that state the app booted CheerpX's public Debian fallback, which
   does not contain the rust-web-box Rust toolchain or workspace image.
2. The warm Alpine disk image installed Rust and Cargo but not `tree`.
3. The seeded workspace and VS Code host integration still optimized for
   the earlier `/workspace/hello` layout and kept a separate
   `hello_world.rs` one-file demo.
4. The visible Bash shell was started as a login shell without first
   controlling root's startup file path. If the inherited profile ran
   tty-specific commands, warnings such as `mesg: ttyname failed` could
   appear before the user typed anything.
5. Disk-image smoke testing checked for a few files but did not execute
   `tree`, `cargo --version`, or the hello-world binary through
   `cargo run`.
6. `web/disk/Dockerfile.disk` allowed the pre-build command to fail with
   `|| true`, so image build regressions could be hidden.
7. The runtime script runner had a quiet execution path but no explicit
   guest-script debug channel connected to the page `?debug` flag.

## Solution

1. Seed new browser workspaces as a root Cargo project:
   `/workspace/Cargo.toml`, `/workspace/src/main.rs`, `README.md`, and
   `.vscode` stubs.
2. Migrate old default workspaces by adding the root Cargo files and
   deleting the old default `hello/` and `hello_world.rs` files only
   when they are unchanged.
3. Point the VS Code task, status-bar run command, auto-open logic, and
   `cargo.runHello` RPC at `/workspace`.
4. Add `tree` to the Alpine disk package list.
5. Build the root Cargo project in the image and treat build failure as
   fatal.
6. Write `/root/.bash_profile` before the visible login shell starts;
   the profile sets PATH, prompt, and `cd /workspace` without running
   tty-specific commands.
7. Route guest script tracing through `?debug` with a `guest` debug
   channel. In debug mode the script name, path, byte count, and script
   body are emitted; normal mode stays quiet.
8. Make Pages staging fail by default when the warm disk cannot be
   staged. `STAGE_WARM_DISK_REQUIRED=0` remains available for explicit
   local fallback testing.
9. Extend the disk-image GitHub Actions smoke test to mount the ext2,
   chroot into it, run `tree --version`, run `cargo --version`, execute
   `cargo run --release`, and grep for the hello-world output from
   `src/main.rs`.
10. Add regression tests that assert the new workspace layout, debug
    wiring, fail-closed staging behavior, Dockerfile package list, and
    disk-image workflow e2e commands.

## Alternatives Considered

| Option | Result |
|--------|--------|
| Keep Debian fallback in production and tell users to install Rust manually | Rejected. It violates the issue requirement that `cargo` works by default. |
| Keep `/workspace/hello` and only update the terminal message | Rejected. The issue explicitly asked to unpack the project to the root and remove the need for `hello_world.rs`. |
| Remove login-shell mode entirely | Rejected for now. The existing WebVM terminal model uses a long-lived login bash loop; controlling `/root/.bash_profile` is a narrower fix. |
| Keep `tree` out of the image and document `ls` instead | Rejected. The issue explicitly asks for `tree`, and Alpine's package is small. |
| Let warm disk staging continue with warnings | Rejected for production. Missing warm disk staging is the direct path to missing `cargo` and `tree`. |

## Upstream Issue Decision

No upstream issue was filed. The observed behavior came from this
repository's staging, disk image, workspace seed, and shell preparation.
CheerpX provides the needed filesystem, temporary-data, console, and
process primitives; Alpine provides the required packages.

## Verification Plan

The local verification for this PR is:

```bash
node --test web/tests/
node web/build/build-workbench.mjs
cargo fmt --check
cargo clippy --all-targets --all-features
cargo test --all-features --verbose
rust-script scripts/check-file-size.rs
git diff --check
```

The local browser smoke command loaded `http://localhost:8876/?debug=guest`
with Playwright. The workbench auto-opened `src/main.rs`, the Explorer
showed `Cargo.toml`, `README.md`, and `src/`, and the terminal reached
`root@rust-web-box:/workspace#` without the reported `mesg` warning. The
local smoke still used the committed Debian fallback because Pages warm
disk chunks are generated only by the staging workflow; the image-level
`tree` and `cargo` checks therefore live in `.github/workflows/disk-image.yml`.

The full disk e2e path needs Docker, loopback mount support, and sudo,
so the definitive image-level check runs in `.github/workflows/disk-image.yml`.

## Related Files

- [`web/glue/workspace-fs.js`](../../../web/glue/workspace-fs.js)
- [`web/glue/webvm-server.js`](../../../web/glue/webvm-server.js)
- [`web/glue/boot.js`](../../../web/glue/boot.js)
- [`web/extensions/webvm-host/extension.js`](../../../web/extensions/webvm-host/extension.js)
- [`web/disk/Dockerfile.disk`](../../../web/disk/Dockerfile.disk)
- [`web/build/stage-pages-disk.mjs`](../../../web/build/stage-pages-disk.mjs)
- [`.github/workflows/disk-image.yml`](../../../.github/workflows/disk-image.yml)
- [`web/tests/boot-shell.test.mjs`](../../../web/tests/boot-shell.test.mjs)
- [`web/tests/webvm-server.test.mjs`](../../../web/tests/webvm-server.test.mjs)
- [`web/tests/workspace-fs.test.mjs`](../../../web/tests/workspace-fs.test.mjs)
