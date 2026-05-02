# Case Study: Issue #21 - WebVM and VS Code Two-Way Workspace Sync

## Summary

Issue #21 reported that editing `src/main.rs` in the VS Code web editor and pressing Ctrl+S did not affect the next `cargo run` inside WebVM. The screenshot also showed a UX mismatch: VS Code did not display the expected dirty indicator before save, and the editor/file tree state did not behave like a local VS Code workspace.

The fix makes the JS-side workspace, VS Code FileSystemProvider, and guest `/workspace` fail together instead of drifting apart. Editor saves now mirror into the guest before VS Code is told the save completed, terminal-side edits are mirrored back into the IndexedDB workspace through a hidden prompt-time sync frame, and workspace change events are forwarded to VS Code watchers.

## Issue Data

- Issue: https://github.com/link-foundation/rust-web-box/issues/21
- PR: https://github.com/link-foundation/rust-web-box/pull/22
- Opened: 2026-05-02 10:10:52 UTC
- Reporter: `konard`
- Screenshot: `issue-screenshot.png`
- Downloaded issue payloads: `issue-21.json`, `issue-21-comments.json`, `pr-22.json`
- Related PR search export: `related-prs-workspace-webvm.json`
- Online research notes: `online-research.md`

## Requirements

| Requirement | Status | Evidence |
| --- | --- | --- |
| VS Code saves affect the next WebVM command immediately | Implemented | `web/tests/webvm-server.test.mjs`, e2e Stage E in `web/tests/e2e/local-pages-e2e.test.mjs` |
| Terminal-side file edits reflect back into VS Code Explorer/editor | Implemented | `web/glue/workspace-sync.js`, `web/extensions/webvm-host/extension.js`, `web/tests/workspace-sync.test.mjs` |
| File and directory operations stay consistent both ways | Implemented | save/delete/rename/createDirectory sync paths in `web/glue/webvm-server.js` |
| Unsaved editor changes show normal dirty state before Ctrl+S | Implemented | `.vscode/settings.json` now sets `"files.autoSave": "off"` and migrates unchanged old defaults |
| Add e2e coverage | Implemented | Added bus-save-to-guest verification stage to local Pages e2e |
| Download logs/data and produce a case study | Implemented | This folder contains issue payloads, screenshot, focused before/after logs, and verification logs |
| Search online for relevant facts/components | Implemented | See `online-research.md` |

## Root Causes

1. `fs.writeFile` updated the JS workspace and then tried to mirror into the guest. If the CheerpX guest sync failed, the error was swallowed, so VS Code could clear the dirty state while `/workspace` still contained old bytes.
2. There was no guest-to-host sync path. Bash edits under `/workspace` stayed inside the VM and never updated the IndexedDB-backed workspace served to VS Code.
3. The page-side workspace store had `onChange`, but `boot.js` did not forward those changes as bus events and the web extension did not subscribe to them.
4. The seeded workspace setting `"files.autoSave": "afterDelay"` made the web editor auto-save after a delay, suppressing the explicit dirty-marker behavior expected from desktop VS Code.

## Solution

- `web/glue/webvm-server.js` now mirrors VS Code write/delete/rename/createDirectory operations into the guest before mutating the JS workspace, and it rejects the FileSystemProvider operation when guest sync fails.
- `web/glue/workspace-sync.js` adds a hidden OSC frame protocol emitted from bash `PROMPT_COMMAND`. The page strips these frames from terminal output, decodes the `/workspace` snapshot, and applies creates, updates, and deletions to the IndexedDB workspace.
- `boot.js` emits `fs.change` events from workspace changes, and `webvm-host/extension.js` translates them into VS Code `onDidChangeFile` events so Explorer/editor state refreshes.
- Default and disk-baked `.vscode/settings.json` now use manual save. Existing workspaces are migrated only when the old settings file is still unchanged.
- Large guest files are marked as skipped instead of deleted; `/workspace/target` and `/workspace/.git` are pruned to avoid streaming generated artifacts through the terminal.

## Alternatives Considered

- Directly mounting the JS workspace as a CheerpX guest filesystem would be simpler, but the current CheerpX API surface in this project provides DataDevice staging and console I/O, not a general page-implemented POSIX filesystem.
- Polling `/workspace` with repeated `cx.run` calls would be noisier and more likely to collide with the existing OverlayDevice instability documented in earlier case studies.
- Leaving VS Code and WebVM as separate stores would preserve the original bug and fails the issue's "fully functional" requirement.

## Verification

- `focused-before.log`: reproducing tests failed before the fix.
- `focused-after.log`: initial focused fix verification.
- `verification/focused-after-hardening.log`: 56 focused tests passed after protocol hardening.
- `verification/node-web-tests.log`: 176 web tests passed.
- `verification/local-pages-e2e.log`: local e2e file includes the new Stage E, but this runner skipped because `browser-commander`/Playwright is not installed.
- `verification/cargo-fmt-check.log`: `cargo fmt --check` passed.
- `verification/cargo-clippy.log`: `cargo clippy --all-targets --all-features` passed.
- `verification/cargo-test.log`: `cargo test` passed.
- `verification/check-file-size.log`: `rust-script scripts/check-file-size.rs` passed.
- `verification/check-changelog-fragment.log`: `rust-script scripts/check-changelog-fragment.rs` passed.
- `verification/check-version-modification.log`: `rust-script scripts/check-version-modification.rs` passed with PR-like env vars.
- `verification/bash-sync-hook-syntax.log`: generated bash sync hook passed `bash -n`.
- `verification/git-diff-check.log`: `git diff --check` passed.

## Remaining Constraints

- Guest-to-host sync runs when the interactive shell reaches the next prompt. Edits made by a long-running command are visible after that command returns.
- The prompt snapshot intentionally skips `/workspace/target`, `/workspace/.git`, and file contents over 256 KiB. Skipped large files remain known to the sync state so they are not treated as deletions.
- No upstream GitHub issue was filed because the reproduced defect was in this repository's glue logic rather than a confirmed third-party library bug.
