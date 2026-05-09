# Case Study: Issue #25 - Target Folder Visibility and Natural WebVM Rebuilds

## Summary

Issue #25 reported a mismatch between local VS Code and rust-web-box:
local VS Code showed Cargo's `target/` directory after a build, while the
web workbench hid it from the Explorer. The same report also called out a
natural-workflow problem: users should edit files, run `cargo run`, and
see Cargo behave like it does locally, without fake commands or manual
`target` cleanup.

The root cause for the visible mismatch was the guest-to-browser sync
hook introduced in issue #21. It deliberately pruned
`/workspace/target` to avoid streaming generated artifacts through the
terminal after every prompt. That protected performance, but it made the
VS Code Explorer an incomplete view of the VM workspace.

The fix keeps the performance protection while syncing the tree honestly:
the guest hook now traverses `/workspace/target`, emits target files as
skipped metadata entries with their sizes, and the IndexedDB workspace
stores those entries as metadata-only files. VS Code can display the
Cargo build tree, while rust-web-box still avoids copying large build
artifacts into the browser workspace or priming fake target files back
into the VM.

## Issue Data

- Issue: https://github.com/link-foundation/rust-web-box/issues/25
- PR: https://github.com/link-foundation/rust-web-box/pull/26
- Branch: `issue-25-891aa8cfdd35`
- Opened: 2026-05-08 21:10:55 UTC
- Reporter: `konard`

| File | Purpose |
| --- | --- |
| `evidence/issue-25.json` | Full issue payload captured with `gh issue view`. |
| `evidence/issue-25-comments.json` | Issue comments. Empty at time of capture. |
| `evidence/pr-26.json` | Prepared PR metadata before implementation. |
| `evidence/pr-26-review-comments.json` | Inline PR review comments. Empty at time of capture. |
| `evidence/pr-26-conversation-comments.json` | PR conversation comments. Empty at time of capture. |
| `evidence/pr-26-reviews.json` | PR reviews. Empty at time of capture. |
| `screenshots/local-target-visible.png` | User-provided local VS Code reference: `target/` is visible. |
| `screenshots/rust-web-box-target-hidden.png` | User-provided rust-web-box failure: `target/` is absent from Explorer. |

## Requirements From The Issue

| Requirement | Status | Evidence |
| --- | --- | --- |
| Do not hide `target/` in the VS Code Explorer | Implemented | `workspace-sync: target artifacts stay visible as skipped metadata` |
| Preserve natural `cargo run` behavior, not fake output | Preserved | Existing `cargo.runHello` still only writes a real terminal command; no mocked cargo output was added |
| Sync the file tree as it exists in WebVM | Implemented for tree metadata | Guest sync emits directories and skipped target file metadata |
| Avoid turning target sync into a browser performance problem | Implemented | Target files remain metadata-only and are excluded from `workspace.snapshot()` |
| Add reproducing tests before the fix | Implemented | `verification/focused-before.log` failed on the old `/workspace/target -prune` hook |
| Add investigation notes and evidence under this case study | Implemented | This directory contains payloads, screenshots, test logs, and research notes |
| Investigate Cargo rebuild/cache expectations | Implemented | See `online-research.md` and issue #17 references |

## Root Cause

The hidden folder was caused by this generated shell sync hook:

```sh
find /workspace -path /workspace/target -prune -o -path /workspace/.git -prune -o -print
```

The browser-side parser treated skipped files as known paths only; it did
not expose them through the FileSystemProvider. In practice this meant
`target/` existed in the CheerpX guest and Cargo could use it, but the
VS Code Explorer had no corresponding tree entries.

The original prune had a reasonable motivation. Cargo's `target/`
contains binaries, dep-info files, fingerprints, incremental artifacts,
and other generated data. Streaming all target file bodies through an OSC
terminal frame after every prompt would be slow and would bloat the
IndexedDB workspace. The implementation needed a middle ground: show the
tree without copying generated contents.

## Solution

- `web/glue/workspace-sync.js`
  - Stops pruning `/workspace/target`.
  - Keeps pruning `/workspace/.git`.
  - Emits target files as `S\t<base64 path>\t<size>` skipped metadata.
  - Parses skipped-file metadata into `snapshot.skippedFiles`.
  - Creates or refreshes metadata-only workspace files for target
    artifacts while preserving the previous behavior for non-target
    oversized files.

- `web/glue/workspace-fs.js`
  - Adds `writeMetadataFile(path, { size })`.
  - Shows metadata-only files in `stat()` and `readDirectory()`.
  - Rejects `readFile()` for metadata-only entries with an `Unavailable`
    error instead of returning empty or fake contents.
  - Excludes metadata-only files from `snapshot()` so workspace priming
    does not write placeholder target artifacts back into WebVM.

- `web/disk/Dockerfile.disk`
  - Updates the baked `/root/.bash_profile` sync hook to match the page
    generated hook, so deployed warm disks and local page preparation use
    the same protocol.

- `web/tests/workspace-sync.test.mjs`
  - Reproduces the old prune bug.
  - Verifies skipped target metadata decoding and application.
  - Verifies metadata refresh when a target artifact changes size.
  - Preserves the oversized-file behavior outside `target/`.

- `web/tests/e2e/local-pages-e2e.test.mjs`
  - Adds the missing assertion that `/workspace/target` appears in the
    warm-disk tree when the browser e2e suite is able to run.

## Why Metadata-Only Target Files

Cargo's build cache documentation confirms that `target/` is Cargo's
normal output location for final artifacts and build/intermediate data.
It also contains incremental compiler cache directories used to speed up
subsequent builds. Those files belong in the tree view, but copying their
contents into the JS workspace is not necessary for the Explorer use
case and would make prompt-time sync much heavier.

The metadata-only design keeps these invariants:

- `target/` is visible and deletions are reflected.
- File sizes update for target artifacts.
- Non-target oversized files still keep their existing JS-side content
  instead of being replaced by placeholders.
- VS Code saves still sync real source files into WebVM before reporting
  success.
- Workspace priming never sends metadata-only artifacts back into the
  guest as fake files.

## Verification

| Log | Result |
| --- | --- |
| `verification/focused-before.log` | Focused test failed before the fix because the generated hook still pruned `/workspace/target`. |
| `verification/focused-after.log` | 8 focused workspace-sync tests passed. |
| `verification/node-web-tests.log` | 179 web tests passed, 3 browser e2e tests skipped because local Playwright/browser-commander or live URL was not configured. |
| `verification/bash-sync-hook-syntax.log` | Generated bash sync hook passed `bash -n`. |
| `verification/git-diff-check.log` | `git diff --check` passed. |
| `verification/cargo-fmt-check.log` | `cargo fmt --check` passed. |
| `verification/cargo-clippy.log` | `cargo clippy --all-targets --all-features` passed. |
| `verification/cargo-test.log` | `cargo test --all-features --verbose` passed. |
| `verification/cargo-doc-test.log` | `cargo test --doc --verbose` passed. |
| `verification/check-file-size.log` | `rust-script scripts/check-file-size.rs` passed. |
| `verification/cargo-build-release.log` | `cargo build --release --verbose` passed. |
| `verification/cargo-package-list.log` | `cargo package --list --allow-dirty` passed. |
| `verification/check-changelog-fragment.log` | `rust-script scripts/check-changelog-fragment.rs` passed with PR-like env vars. |
| `verification/check-version-modification.log` | `rust-script scripts/check-version-modification.rs` passed with PR-like env vars. |

## Remaining Constraints

- Target file contents are intentionally not mirrored into IndexedDB.
  Opening a metadata-only target binary from the Explorer returns an
  `Unavailable` error rather than fake content.
- Guest-to-browser sync still runs at interactive prompt boundaries. A
  long-running command's generated files become visible after the command
  returns to a prompt.
- `.git` remains pruned from prompt sync. VS Code itself also hides some
  folders such as `.git` by default.
- No upstream issue was filed for this case. The confirmed defect was in
  this repository's generated sync hook and workspace store behavior.
  The broader CheerpX OverlayDevice/cargo build performance concern is
  the same category already documented in issue #17.

## Related Case Studies

- `docs/case-studies/issue-21/README.md`: introduced two-way workspace
  sync and explains why the original target prune was added.
- `docs/case-studies/issue-17/README.md`: covers the `cargo run`
  warm-disk and CheerpX OverlayDevice mitigation work.
- `online-research.md`: summarizes the official docs consulted for
  Cargo build cache behavior, VS Code Explorer hiding semantics, and
  CheerpX filesystem devices.
