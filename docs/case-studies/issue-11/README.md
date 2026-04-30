# Case Study: Issue #11 - Quiet WebVM Workspace Priming

## Summary

Issue #11 reported that the main WebVM terminal became noisy immediately
after boot. The visible console showed the implementation's workspace
setup commands, repeated heredoc continuation prompts, and a final
directory listing before the user typed anything. The requested outcome
was a quieter terminal while still allowing the setup work to run through
a temporary script outside the user-visible workspace.

The fix moves workspace priming and later editor-save mirroring out of
the interactive bash stream. `boot.js` now passes the CheerpX
`DataDevice` to `webvm-server.js`; `webvm-server.js` stages short shell
scripts under the `/data` mount, executes them with `cx.run('/bin/sh',
...)`, removes the temporary script, and only then starts the visible
login shell in `/workspace`.

## Evidence Collected

All issue data and local verification logs are stored under
[`evidence/`](./evidence/):

| File | Purpose |
|------|---------|
| [`issue-11.json`](./evidence/issue-11.json) | Full GitHub issue payload captured with `gh issue view`. |
| [`issue-11-comments.json`](./evidence/issue-11-comments.json) | Issue comments from the GitHub API; the issue had no comments when captured. |
| [`pr-12-initial.json`](./evidence/pr-12-initial.json) | Initial draft PR metadata before this fix. |
| [`reported-terminal-transcript.md`](./evidence/reported-terminal-transcript.md) | The noisy console transcript from the issue body. |
| [`related-prs-workspace-terminal.json`](./evidence/related-prs-workspace-terminal.json) | Related merged PR search results for workspace and terminal behavior. |
| [`related-prs-cheerpx-webvm.json`](./evidence/related-prs-cheerpx-webvm.json) | Related merged PR search results for CheerpX/WebVM changes. |
| [`related-prs-terminal-noise.json`](./evidence/related-prs-terminal-noise.json) | Related merged PR search results for terminal-noise terms. |
| [`focused-before.log`](./evidence/focused-before.log) | Reproducing tests before the implementation; expected to fail. |
| [`focused-after.log`](./evidence/focused-after.log) | Focused tests after the implementation; expected to pass. |
| [`focused-current.log`](./evidence/focused-current.log) | Current focused WebVM regression test run. |
| [`web-tests.log`](./evidence/web-tests.log) | Full JavaScript test suite run for `web/tests`. |
| [`build-workbench.log`](./evidence/build-workbench.log) | Local Pages build command for the static workbench. |
| [`cargo-fmt-check.log`](./evidence/cargo-fmt-check.log) | Rust formatting check output. |
| [`cargo-clippy.log`](./evidence/cargo-clippy.log) | Rust Clippy check output. |
| [`cargo-test.log`](./evidence/cargo-test.log) | Rust test output. |
| [`check-file-size.log`](./evidence/check-file-size.log) | Repository file-size guard output. |
| [`git-diff-check.log`](./evidence/git-diff-check.log) | Whitespace validation output. |

## Timeline

| Time (UTC) | Event |
|------------|-------|
| 2026-04-30T05:11:32Z | Issue #11 opened with a terminal transcript showing setup commands and heredoc prompts in the main console. |
| 2026-04-30T05:12:30Z | Draft PR #12 opened from `issue-11-49cb7d5e5371` with placeholder content. |
| 2026-04-30 | Issue evidence, PR metadata, and related PR search results were captured into this case-study folder. |
| 2026-04-30 | Reproducing tests were added for quiet workspace priming and DataDevice wiring. The focused test run failed against the old implementation. |
| 2026-04-30 | Workspace priming and guest file sync were moved from visible terminal input to temporary scripts staged on CheerpX `/data`. |
| 2026-04-30 | Focused tests passed after the fix. |

## Requirements From The Issue

1. Minimize the main console output so it contains as few distractions as
   possible.
2. If setup commands must still run, execute them through a temporary
   script outside the user-visible workspace.
3. Download logs and issue data into `docs/case-studies/issue-11`.
4. Build a deep case study that reconstructs timeline, requirements,
   root causes, possible solutions, and relevant existing components.
5. Search online for additional facts and data.
6. If another repository or project is at fault, report an upstream issue
   with a reproducible example, workaround, and suggested fix.
7. If root cause cannot be found, add debug or verbose output for a later
   iteration.
8. Complete the work in one pull request.

## Root Causes

1. The old workspace prime path wrote each setup command into the same
   `cx.setCustomConsole` input function that receives user keystrokes.
   Because terminal subscribers also listened to the same CheerpX output,
   setup commands appeared in the user's terminal scrollback.
2. `stty -echo` was only a partial workaround. It can reduce input echo
   after bash processes the command, but it does not hide all interactive
   shell prompts. Heredocs still put bash into continuation-prompt mode,
   so each multiline file produced visible `>` prompts.
3. The initial prime script used one heredoc per seeded file. That
   multiplied the amount of prompt noise in proportion to the workspace
   seed size.
4. The boot path marked the VM ready and attached the user-visible shell
   around the same time as the setup stream, so setup output and usable
   terminal output were mixed.
5. Later editor save/delete/rename/create-directory sync operations also
   used interactive console input, so the same class of noise could recur
   after boot.
6. The existing `docs/case-studies/issue-11` folder contained unrelated
   CI template material and did not document the actual rust-web-box
   issue.

## Solution

The selected solution uses a component already mounted by rust-web-box:
CheerpX `DataDevice`.

1. `boot.js` passes `vm.dataDevice` to `startWebVMServer`.
2. `webvm-server.js` builds a shell script for workspace priming from the
   JS-side workspace snapshot.
3. The script is written to DataDevice at a path such as
   `/rust-web-box-workspace-prime.sh`, which appears in the guest as
   `/data/rust-web-box-workspace-prime.sh`.
4. CheerpX runs the script non-interactively with `/bin/sh` via
   `cx.run`, then removes the temporary script with `/bin/rm -f`.
5. The visible `/bin/bash --login` loop starts only after priming
   completes, with its working directory set to `/workspace`.
6. Editor-side file mutations reuse the same DataDevice script runner
   instead of injecting commands into the visible terminal.
7. `vm.status` now exposes `workspacePrimed` and
   `workspacePrimeError`, and the VS Code host terminal reports mirror
   failures instead of silently claiming success.

## Alternatives Considered

| Option | Result |
|--------|--------|
| Keep the interactive heredoc stream and tune `stty`, `PS1`, or `PS2` | Rejected. It is fragile and still uses the user's console as a setup transport. |
| Clear the terminal after setup | Rejected. It hides evidence after the fact and can still flash noisy setup output during boot. |
| Use xterm.js `convertEol` or stream normalization only | Not sufficient. That helps line-ending rendering, but it does not stop command echo or bash continuation prompts. |
| Stage a temporary script on CheerpX `/data` and run it with `cx.run` | Selected. It matches the issue request, uses documented CheerpX APIs, and keeps setup outside `/workspace` and outside the interactive terminal stream. |

## Upstream Issue Decision

No upstream issue was filed. The observed behavior is a local
integration problem: rust-web-box was intentionally feeding setup commands
into the same console API that backs the user terminal. CheerpX
`setCustomConsole` and xterm.js were behaving according to their
documented roles. CheerpX `DataDevice.writeFile` already provides a
documented way to stage files for non-interactive execution.

## Verification

The regression tests prove the old failure mode and the new behavior:

```bash
node --test web/tests/webvm-server.test.mjs web/tests/boot-shell.test.mjs
node --test web/tests
node web/build/build-workbench.mjs
cargo fmt --check
cargo clippy --all-targets --all-features
cargo test
rust-script scripts/check-file-size.rs
git diff --check
```

The pre-fix run in [`focused-before.log`](./evidence/focused-before.log)
failed because the implementation still typed priming commands into the
terminal and did not pass a DataDevice into `webvm-server.js`. The
post-fix run in [`focused-after.log`](./evidence/focused-after.log)
passed after the implementation staged `/data` scripts and avoided
terminal input during workspace priming.

## Related Files

- [`web/glue/boot.js`](../../../web/glue/boot.js)
- [`web/glue/webvm-server.js`](../../../web/glue/webvm-server.js)
- [`web/extensions/webvm-host/extension.js`](../../../web/extensions/webvm-host/extension.js)
- [`web/tests/webvm-server.test.mjs`](../../../web/tests/webvm-server.test.mjs)
- [`web/tests/boot-shell.test.mjs`](../../../web/tests/boot-shell.test.mjs)
- [`analysis-terminal-noise.md`](./analysis-terminal-noise.md)
- [`online-research.md`](./online-research.md)
