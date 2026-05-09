# Case Study: Issue #29 - WebVM Workspace Synchronization

## Summary

Issue #29 reported two related WebVM workspace problems:

- The guest `/workspace/target` directory existed in the terminal, but VS Code Explorer showed an empty `target` folder.
- Editing Rust source in VS Code and immediately running `cargo run` in the WebVM terminal could reuse the old guest file contents, so the new build did not reflect the editor change.

The fix keeps prompt-time synchronization cheap while adding a scoped, on-demand target metadata refresh for Explorer expansion. It also saves dirty VS Code workspace documents before terminal Enter and before built-in Cargo tasks send their command to the guest.

## Captured Evidence

- Issue data: `evidence/issue-29.json`
- Issue comments: `evidence/issue-29-comments.json`
- Pull request data: `evidence/pr-30.json`
- Pull request comments and reviews: `evidence/pr-30-conversation-comments.json`, `evidence/pr-30-review-comments.json`, `evidence/pr-30-reviews.json`
- Original screenshot: `raw/issue-29-screenshot.png`
- Focused test log: `evidence/focused-web-tests.log`
- Full Node test log: `evidence/node-web-tests.log`
- Local browser e2e attempt log: `evidence/local-pages-e2e-repro.log`
- Guest sync shell syntax log: `evidence/bash-sync-hook-syntax.log`
- Diff whitespace log: `evidence/git-diff-check.log`
- Changelog, version, and file-size check logs: `evidence/check-changelog-fragment.log`, `evidence/check-version-modification.log`, `evidence/check-file-size.log`
- Rust check logs: `evidence/cargo-fmt-check.log`, `evidence/cargo-clippy.log`, `evidence/cargo-test-all-features.log`, `evidence/cargo-test-doc.log`
- Online research notes: `online-research.md`

The issue had no comments when evidence was captured. PR #30 had no conversation comments, inline review comments, or reviews at capture time.

## Timeline

| Date | Event |
| --- | --- |
| 2026-05-09 04:49 UTC | Issue #25 fix added metadata-only `target` entries so Explorer could see Cargo build outputs. |
| 2026-05-09 07:30 UTC | Issue #27 fix removed prompt-time full target scans after they caused duplicate terminal output, expensive scans, and metadata churn. |
| 2026-05-09 09:18 UTC | Issue #29 was opened with a screenshot showing `/workspace/target` populated in the terminal but empty in Explorer, plus stale `cargo run` behavior after editor changes. |
| 2026-05-09 20:27 UTC | PR #30 was opened from `issue-29-bbfa3711ed5c` as a draft. |
| 2026-05-09 20:28 UTC | The screenshot and GitHub issue/PR evidence were captured into this case-study directory. |
| 2026-05-09 20:38 UTC | Focused sync/server/extension tests passed with 31 tests. |
| 2026-05-09 20:39 UTC | Full `node --test web/tests/` passed with 190 passing tests and 4 skipped tests. |
| 2026-05-09 21:02 UTC | Pages local-e2e CI exposed that direct CheerpX console captures can hide the target-refresh sync frame from the page server. |

## Requirements

1. Keep the VS Code Explorer view and the WebVM `/workspace` filesystem synchronized.
2. Include Cargo `target` metadata in Explorer instead of showing an empty folder when guest `target` exists.
3. Avoid reintroducing the expensive prompt-time full-target scan that caused issue #27.
4. Ensure editor changes to Rust source are saved into the WebVM filesystem before the next `cargo run`.
5. Add unit, integration, and e2e coverage for the sync details.
6. Preserve logs, issue data, screenshot evidence, root-cause analysis, and online research in `docs/case-studies/issue-29`.
7. Report upstream issues only if the investigation finds an upstream project defect.

## Root Causes

### Empty target Folder

The prompt-time guest sync deliberately pruned `/workspace/target` descendants after issue #27. That was the right tradeoff for terminal responsiveness because Cargo target trees can contain many files. The side effect was that Explorer saw only the `target` directory entry and did not have child metadata when the user expanded it.

The root cause was local sync granularity: the system had one cheap prompt sync, but no separate scoped refresh path for large generated folders.

During CI, the local browser e2e suite exposed a second integration detail: the test helper used `cx.setCustomConsole()` directly to capture low-level command output. CheerpX has one console callback, so that capture replaced the page server's callback. A later target refresh could emit the hidden sync frame successfully while the server never saw it.

### Stale cargo run After Editor Edits

The WebVM terminal runs real guest commands, but VS Code Web documents can remain dirty until they are explicitly saved. If the user edited `src/main.rs` and then pressed Enter in the terminal, bash could start `cargo run` before the dirty document had been pushed through the FileSystemProvider and mirrored into the guest filesystem.

The root cause was command ordering between the VS Code editor save lifecycle and terminal command submission.

## Solution

### Scoped target Refresh

`workspace-sync.js` now supports scoped sync payloads with a `P` record. `buildGuestTargetSnapshotScript()` emits a hidden sync frame for `/workspace/target` or one of its descendants. The snapshot includes directory entries and metadata-only file stubs, not file contents.

`webvm-server.js` calls that refresh only when VS Code asks `fs.readDir` for `/workspace/target` or a path under it. The refresh updates cached Explorer metadata and prunes stale metadata inside only that target subtree.

The server waits for the matching scoped sync frame before returning `fs.readDir`. This avoids a real browser race where CheerpX can complete the helper script before the hidden OSC frame has reached the page console handler.

Before each target scan, the server reattaches its CheerpX console callback. This keeps the hidden sync-frame parser connected even after a test or debug helper temporarily captured VM output with `cx.setCustomConsole()`.

Prompt-time sync still prunes target descendants, so normal shell prompts do not scan the full build cache.

### Save Before Commands

`web/extensions/webvm-host/extension.js` now calls `vscode.workspace.saveAll(false)` before forwarding terminal input that submits a command and before built-in Cargo task ptys write their Cargo command. This keeps manual-save behavior intact while ensuring the next command sees the editor state the user just submitted.

### Disk Image Hook Alignment

`web/disk/Dockerfile.disk` now bakes the same cheap prompt hook behavior as the runtime page hook: it surfaces `/workspace/target` as a directory when present, prunes target descendants during prompt sync, and avoids double-installing `PROMPT_COMMAND`.

## Verification

Focused regression suite:

```bash
node --test web/tests/cheerpx-bridge.test.mjs web/tests/webvm-server.test.mjs web/tests/workspace-sync.test.mjs web/tests/extension-pty-listeners.test.mjs > docs/case-studies/issue-29/evidence/focused-web-tests.log 2>&1
```

Result: 47 passed, 0 failed.

Full web test suite:

```bash
node --test web/tests/ > docs/case-studies/issue-29/evidence/node-web-tests.log 2>&1
```

Result: 191 passed, 4 skipped, 0 failed.

The skipped tests were browser e2e cases. The local environment did not have `browser-commander` / Playwright installed, and `RUST_WEB_BOX_LIVE_URL` was not set for live Pages e2e. The e2e specs themselves were still parsed and included in the Node test run.

Guest sync shell syntax:

```bash
node --input-type=module -e "import { buildGuestSyncProfileBlock, buildGuestTargetSnapshotScript } from './web/glue/workspace-sync.js'; process.stdout.write(buildGuestSyncProfileBlock()); process.stdout.write('\n'); process.stdout.write(buildGuestTargetSnapshotScript('/workspace/target'));" | bash -n > docs/case-studies/issue-29/evidence/bash-sync-hook-syntax.log 2>&1
```

Result: passed with an empty log.

Rust and repository checks:

```bash
git diff --check
GITHUB_BASE_REF=main rust-script scripts/check-changelog-fragment.rs
GITHUB_EVENT_NAME=pull_request GITHUB_BASE_REF=main GITHUB_HEAD_REF=issue-29-bbfa3711ed5c rust-script scripts/check-version-modification.rs
rust-script scripts/check-file-size.rs
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-features --verbose
cargo test --doc --verbose
```

Result: all passed locally.

The e2e specs were extended so local and live browser tests now assert:

- `fs.readDir('/workspace/target')` returns Cargo target children after a real `cargo run`.
- `fs.readDir('/workspace/target/debug')` returns on-demand metadata.
- Editing `src/main.rs` through the same WebVM FileSystemProvider bus and then running real `cargo run --release` prints the edited message.

## Upstream Assessment

No upstream GitHub issue was opened. The observed behavior was caused by local coordination between the guest sync hook, the in-browser FileSystemProvider cache, and terminal command submission. The upstream APIs used by the fix provide the required primitives.

## Follow-up Risk

The fix intentionally does not sync Cargo target file contents into VS Code. It syncs metadata-only file stubs so Explorer can show the generated tree without pulling large artifacts into browser storage.
