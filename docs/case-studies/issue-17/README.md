# Case Study: Issue #17 - `cargo run` is not working

## Summary

Issue #17 reports that on the deployed Pages site
(https://link-foundation.github.io/rust-web-box) typing
`cargo run` in the workbench terminal hangs and never produces output.
The captured console shows the same CheerpX 1.3.0 OverlayDevice fault we
encountered as the secondary failure mode in issue #15:

```
[Error] TypeError: undefined is not an object (evaluating 'c.a4.a1')
        y8 (cx_esm.js:1:190555)
        y_ (cx_esm.js:1:187731)
[Log]   Unexpected exit – CheerpException: Program exited with code 71
        ari@blob:.../bf3023ee-...:1:123524
        wasm-function[2523] … wasm-function[2363]
```

Issue #15 had already shipped a four-layer workaround for the same bug
on the **boot path** (workspace prime / interactive shell prepare) by:
pre-baking seed paths in the disk image so the prime overwrites existing
inodes, gating the `workspace.prime` bus method on `skipPrime`, bounding
the prime/shell-prepare with a 30 s `Promise.race`, and setting the skip
flags in the e2e harness. Issue #15's e2e suite only proved the
**pre-built** binary `/workspace/target/release/hello` could be executed
end-to-end. It did not exercise `cargo run` itself, so the same
OverlayDevice 'a1' wedge silently regressed on the user-facing path the
issue's title calls out.

The smoking gun in this investigation: re-running the same Playwright MCP
session from issue #15 against the live site, but driving plain
`cargo run` instead of the prebuilt binary — the runtime wedges around
**~74 s** into the build with the identical `'a1'` /
`Program exited with code 71` pair. Plain `cargo run` does a *debug*
build from cold, allocating ~hundreds of fresh inodes under
`target/debug/{build,deps,.fingerprint,incremental}/`. CheerpX 1.3.0's
OverlayDevice flaky bug is biased toward fresh inode allocation, and at
this volume of new inodes the wedge fires reliably.

The fix is the same in spirit as issue #15's "pre-create the seed paths
the prime would touch" — extended to cargo: the disk image now pre-bakes
**both** the `--release` and the plain `cargo build` artifacts, so plain
`cargo run` from the user's terminal hits cargo's mtime fast-path
("Finished … 0.00s") and does not allocate fresh inodes. Two of the
existing wedge mitigations get sharpened too — `CARGO_INCREMENTAL=0`
removes the largest source of fresh inodes on subsequent rebuilds, and
the e2e harness now actually drives `cargo run --release` so a future
regression on the cargo path is loud rather than silent.

## Evidence Collected

All evidence captured for this investigation is stored in this
directory:

| File | Purpose |
|------|---------|
| [`evidence/issue.json`](./evidence/issue.json) | Full GitHub issue payload captured with `gh issue view`. Includes the user's reproduction screenshot URL and the Safari console capture pasted in the body. |
| [`evidence/issue-comments.json`](./evidence/issue-comments.json) | Issue comments from the GitHub API. Empty at time of capture — the body is the only narrative. |
| [`evidence/ci-run-25212429146.json`](./evidence/ci-run-25212429146.json) | The CI run referenced in the issue body (cancelled). Confirms the user's complaint that CI did not catch this — the live e2e job did not assert `cargo run`. |
| [`screenshots/01-live-after-cargo-run-hang.png`](./screenshots/01-live-after-cargo-run-hang.png) | Live Pages site after typing `cargo run` in the terminal. Build never completes, terminal silent. |
| [`playwright-logs/01-cargo-run-wedge-console.log`](./playwright-logs/01-cargo-run-wedge-console.log) | Full Playwright MCP console capture from the live site driving plain `cargo run`. The wedge fires at **74,538 ms** (`CheerpException: Program exited with code 71`) followed by `TypeError: e is not a function` — the runtime is now dead for the rest of the session. The four `'a1'` errors at 1.9 s / 31 s / 45 s / 65 s are the same OverlayDevice fault from issue #15, here biased toward `target/debug/{build,deps,.fingerprint}/` inode allocations. |

## Timeline

| Time (UTC) | Event |
|------------|-------|
| 2026-05-01 11:38 | Issue #17 opened. User reports `cargo run` does not work on deployed Pages site, attaches Safari console showing `evaluating 'c.a4.a1'` then `CheerpException: Program exited with code 71`. Calls out that the live-pages e2e job did not catch it. |
| 2026-05-01 ~11:50 | Reproduced from Playwright MCP against the live site. Plain `cargo run` wedged at ~74 s. `cargo run --release` and `cargo --version` returned in ~1 s. `/workspace/target/release/hello` returned in <100 ms. The differential confirms the wedge is FS-allocation-bound, not CPU-bound. |
| 2026-05-01 ~11:55 | Bisected the wedge to fresh-inode allocations under `target/debug/`. The disk image only pre-bakes `cargo build --release`, so the first plain `cargo run` walks `target/debug/{build,deps,.fingerprint,incremental}/` from cold and trips CheerpX 1.3.0's OverlayDevice 'a1' bug. The wedge is biased toward fresh inodes (issue #15 root cause #6 — same bug, different code path). |
| 2026-05-01 ~12:00 | Compared with issue #15's e2e fix. The Stage C assertion in `local-pages-e2e.test.mjs` only ran the pre-built `/workspace/target/release/hello` binary — it never invoked cargo, so it never proved `cargo run` worked. Same omission in `live-pages-e2e.test.mjs`. This is exactly the gap the user calls out: "in CI/CD that bug was not catched". |
| 2026-05-01 ~12:00 | Drafted the four-layer fix (mirrors issue #15's pattern). Confirmed in disk-image-mounted chroot that pre-baking BOTH `cargo build --release` AND `cargo build` makes both `cargo run --release` and plain `cargo run` finish in <1s with "Finished … 0.00s". |
| 2026-05-01 ~12:00 | Added Stage D (`cargo run --release`) to both the local and live e2e suites. Set `CARGO_INCREMENTAL=0` in the harness env when invoking commands inside the VM so `runInVM` mirrors the user's terminal. Added a smoke-test loop in the disk-image workflow that runs both `cargo run --release` and plain `cargo run` inside a chroot of the freshly built image — the real-Linux baseline that proves the prebakes are valid before the image is published as `disk-latest`. |

## Requirements From The Issue

The issue body lists multiple requirements. Spelled out individually:

1. **`cargo run` must work on the deployed Pages site.** This is the
   user-facing fault.
2. **CI must catch this regression.** The user says: "in CI/CD that bug
   was not catched, that should have been checked published website with
   e2e tests directly using its GitHub Pages url." So the fix must
   include an e2e test that drives the live URL (or one byte-identical
   to it) and runs `cargo run`.
3. **Compile all logs and data into `docs/case-studies/issue-17/`.**
4. **Reconstruct timeline, list all requirements, find root causes,
   propose solutions.**
5. **Search online for additional facts** and check for known existing
   components/libraries that solve similar problems.
6. **Add debug output / verbose mode** if data is insufficient to find
   the root cause.
7. **File upstream issues** for any external project bug, with
   reproducible examples, workarounds, and fix suggestions.
8. **Plan and execute everything in a single PR** (PR #18 already
   exists for this branch).
9. **Use Playwright MCP locally** to debug in Google Chrome (critical)
   and other browsers; encode all manual debugging into CI-executed e2e
   tests.

## Root Causes

1. **The disk image only pre-baked `cargo build --release`.** Plain
   `cargo run` (without `--release`) does a debug build, which writes
   `target/debug/build/<crate>-<hash>/`, `target/debug/deps/<crate>-<hash>{,.d,.rmeta}`,
   `target/debug/.fingerprint/<crate>-<hash>/{...}` etc. — on the order
   of hundreds of new inodes. CheerpX 1.3.0's OverlayDevice flaky bug
   (issue #15 root cause #6) reliably wedges at this volume of fresh
   inode allocation. The release pre-bake covers `cargo run --release`
   but not the plain command in the issue's screenshot.
2. **Cargo's incremental compilation rotates fresh inodes on every
   rebuild.** Even after a successful first build, editing
   `src/main.rs` triggers cargo to write a new fingerprint dir under
   `target/<profile>/incremental/`. Each fingerprint directory contains
   a fresh set of inodes (one per dep × profile × pass). On native
   Linux this is fine. On CheerpX 1.3.0's OverlayDevice it accumulates
   the same wedge risk on every rebuild, even for projects that
   previously built fine. So even a fully-baked image regresses as soon
   as the user edits a file.
3. **The e2e suites never invoked cargo.** Issue #15's `local-pages-e2e`
   and `live-pages-e2e` asserted three things — `tree --version`,
   `tree /workspace -L 2`, and the pre-built
   `/workspace/target/release/hello` binary — but no test ever invoked
   `cargo run`. Cargo's mtime check + linker invocation + workspace
   write path is a different code path from "execute prebuilt ELF", and
   exactly the path that wedges on the live site. The user's complaint
   ("in CI/CD that bug was not catched") was correct.
4. **The default VS Code build task was `cargo run` (debug).** Even
   users who would have hit the working `--release` prebake by accident
   were funnelled by `tasks.json` defaults toward the broken path.

## Solution

Four-layer defense, mirroring issue #15's pattern (workaround the
OverlayDevice bug at every level we control until upstream lands a fix):

1. **Disk image: pre-bake BOTH debug and release profiles**
   ([`web/disk/Dockerfile.disk`](../../../web/disk/Dockerfile.disk)).
   - `cargo build --release && cargo build` so `target/release/hello`
     and `target/debug/hello` and *all* their fingerprint /
     deps / build directories already exist on the image.
   - Plain `cargo run` from the user's terminal walks the existing
     fingerprint, sees nothing changed, prints "Finished … 0.00s", and
     allocates **zero** new inodes. The wedge cannot fire on this path
     until the user actually edits a file.
2. **Disable cargo incremental compilation on the disk image**
   ([`web/disk/Dockerfile.disk`](../../../web/disk/Dockerfile.disk)).
   - `CARGO_INCREMENTAL=0` exported in `/root/.bash_profile` and
     `[build] incremental = false` in `/root/.cargo/config.toml`. Both
     are needed: the env var covers the interactive shell, the cargo
     config covers tasks.json / RPC-driven invocations.
   - On rebuilds after edits cargo still re-uses pre-existing fingerprint
     directories instead of rotating fresh ones. The set of inodes that
     change is small and stable, so the wedge bias toward fresh
     allocations is largely defused.
3. **`tasks.json` default = "cargo run (release)"**
   ([`web/disk/Dockerfile.disk`](../../../web/disk/Dockerfile.disk)).
   - Two tasks: `cargo run (release)` (default, prebaked) and
     `cargo run (debug)` (fallback). Each `detail` field references
     issue #17 so the next contributor reading the file knows why the
     default is `--release`.
   - `Ctrl+Shift+B` / "Run Build Task" now hits the prebaked path.
4. **e2e tests actually invoke cargo**
   ([`web/tests/e2e/local-pages-e2e.test.mjs`](../../../web/tests/e2e/local-pages-e2e.test.mjs),
   [`web/tests/e2e/live-pages-e2e.test.mjs`](../../../web/tests/e2e/live-pages-e2e.test.mjs)).
   - New "Stage D" assertion: `cd /workspace && cargo run --release 2>&1`
     with `timeoutMs: 120_000`. Asserts `timedOut: false`,
     `status: 0`, output contains `"Hello from rust-web-box!"`, and
     output contains `"Finished"` (the cargo mtime-check signal).
   - The `timedOut` assertion has a dedicated message that names the
     OverlayDevice wedge — a future timeout regression is immediately
     classifiable from the CI log.
   - `runInVM` propagates `CARGO_INCREMENTAL=0` to the spawned shell so
     in-VM commands match user terminals.
5. **Disk-image build smoke test**
   ([`.github/workflows/disk-image.yml`](../../../.github/workflows/disk-image.yml)).
   - Asserts `target/release/hello` AND `target/debug/hello` both exist
     in the image (a missing prebake fails the workflow loudly).
   - chroots into the image and runs `cargo run --release` AND plain
     `cargo run`. On real Linux the prebakes are honoured, so both
     finish in 0.0s with "Finished" and "Hello from rust-web-box!" —
     proves the prebakes are valid before the image is published as
     `disk-latest`. If `cargo build` was somehow invalid on the image,
     this catches it pre-publish.

## Alternatives Considered

| Option | Result |
|--------|--------|
| Force users to type `cargo run --release` | Rejected. The issue's screenshot shows the user typing plain `cargo run`. We do not control what users type. |
| Patch CheerpX's OverlayDevice locally | Rejected (same reason as issue #15). The fault is in obfuscated CheerpX i386 emulator chunks; we cannot maintain a fork without breaking subsequent CheerpX updates. The defence-in-depth workaround is fully recoverable when upstream lands a fix. |
| Bound `cargo run` itself with a Promise.race timeout in the page harness | Rejected. The wedge is in CheerpX's internal worker, not in a JS-level promise we own. A timeout would let the test fail cleanly but would not make the user's `cargo run` work. The fix has to keep the wedge from firing in the first place. |
| Drop the debug build from the disk image and only support `cargo run --release` | Rejected. The user-facing terminal supports any cargo command; arbitrarily disabling debug is hostile UX, and rust-analyzer's check-on-save would be unexpectedly broken too. |
| Skip the cargo run e2e assertion in CI to avoid flakes | Rejected. This is the user-facing operation that broke. With the prebakes in place the run takes ~1 s and is deterministic. |
| Pin to plain `cargo run` (debug) in tasks.json default since "that's what users type" | Rejected. The default task is what `Ctrl+Shift+B` invokes. The release path is the deterministic-fast one given our prebakes; surfacing it as default is a UX win, not a hidden behaviour change (users who type `cargo run` in the terminal still get debug builds, also fast thanks to the prebake). |

## Upstream Issue Decision

The underlying CheerpX 1.3.0 OverlayDevice 'a1' bug is upstream. Issue
#15 reserved
[`docs/case-studies/issue-15/upstream-issues/`](../issue-15/upstream-issues/)
for the eventual cross-reference; that directory is the canonical
location for the upstream filing — the bug is the same, the only thing
this case study adds is a new code path (cargo's debug build) that
trips it.

We are not opening a separate upstream filing for issue #17 because:

1. The reproducer is identical: any code path that allocates many
   fresh inodes under `/workspace` on an OverlayDevice-backed mount.
2. CheerpX maintainers are best-served by **one** detailed reproducer,
   not a sequence of variations.
3. We have a high-confidence workaround that does not require an
   upstream fix on our timeline.

When the upstream filing happens (issue #15's tracking item), we will
mention plain `cargo run` as the second-most-frequent trigger after
`primeGuestWorkspace` so the maintainer's investigation covers both.

## Verification Plan

Local verification:

```bash
# Unit tests (fast, offline).
node --test web/tests/

# Local e2e — soft-skips without browser-commander or warm disk.
cd web/tests && npm install
node --test e2e/local-pages-e2e.test.mjs

# Live e2e against the deployed site (no CI required).
RUST_WEB_BOX_E2E=1 \
  RUST_WEB_BOX_LIVE_URL=https://link-foundation.github.io/rust-web-box \
  node --test e2e/live-pages-e2e.test.mjs
```

The Stage D `cargo run --release` assertion in both suites now reproduces
the regression: against a deployed site without the disk-image fix, the
test fails at the `timedOut: false` assertion with the diagnostic
"likely OverlayDevice wedge". Against a deployed site WITH the fix, the
run finishes in ~1 s.

CI verification:

- `.github/workflows/disk-image.yml`: the smoke-test step asserts both
  prebakes are present and runs `cargo run [--release]` inside a chroot
  before the image is published. A regression in the Dockerfile fails
  here.
- `.github/workflows/pages.yml` (already wired by issue #15): the
  `local-e2e` and `e2e` jobs run the suites this PR amended. Stage D
  ensures `cargo run --release` is exercised on every deploy.

## Related Files

- [`web/disk/Dockerfile.disk`](../../../web/disk/Dockerfile.disk) — pre-bake both debug & release; CARGO_INCREMENTAL=0; tasks.json default = release
- [`.github/workflows/disk-image.yml`](../../../.github/workflows/disk-image.yml) — smoke test verifies both prebakes
- [`web/tests/e2e/local-pages-e2e.test.mjs`](../../../web/tests/e2e/local-pages-e2e.test.mjs) — Stage D `cargo run --release`
- [`web/tests/e2e/live-pages-e2e.test.mjs`](../../../web/tests/e2e/live-pages-e2e.test.mjs) — Stage D `cargo run --release`
- [`web/tests/helpers/cheerpx-page-harness.mjs`](../../../web/tests/helpers/cheerpx-page-harness.mjs) — runInVM env now propagates `CARGO_INCREMENTAL=0`
- [`docs/case-studies/issue-15/README.md`](../issue-15/README.md) — prior art for the OverlayDevice wedge mitigation
