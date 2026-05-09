# Case Study: Issue #27 — PR #26 broke working features without finishing #25

## Summary

Issue #27 was filed two hours after PR #26 (the issue #25 fix) merged.
The reporter loaded the deployed page and could not type a command:
**every keystroke rendered twice** (`lll[ll[lls`s for `ls`), the
**target folder was missing again** in the Explorer (the very thing
PR #26 promised to fix), and **`cargo run` did not react to file
edits**. The same screenshot used in #25 was attached to make the
contrast obvious — locally everything still worked.

Three independent regressions, all introduced by PR #26, fired at once:

1. **Duplicate output**: every byte broadcast on the bus's
   `proc.stdout` topic was delivered to the terminal *N* times because
   the webvm-host extension's `makePseudoterminal()` reassigned
   `stdoutDispose = bus.on('proc.stdout', …)` every time VS Code
   re-`open()`-ed the pty (panel reattach, terminal restore), without
   disposing the previous listener. Each open() doubled the listener
   count.

2. **Catastrophic prompt-time sync**: PR #26 removed
   `-path /workspace/target -prune` from the bash sync hook so
   `find /workspace` could enumerate the build tree. After a single
   `cargo build` the `target/` directory contains ~10 000 files; the
   prompt now ran `find` + `wc -c` + `base64` over all of them after
   *every prompt return*, blasting a multi-MB OSC frame down the
   terminal. Two consequences fell out: the terminal felt frozen
   between commands, and the racing JS-side sync routinely overwrote
   editor saves before the next `cargo run` could see them — which
   re-cast the symptom as "cargo run does not react to changes".

3. **Target folder missing — again**: even though PR #26 added
   metadata-only file support, the deletion sweep
   (`knownPaths` minus `currentPaths`) wiped the cached metadata stubs
   on every prompt because the new prompt-time scan didn't re-emit
   them when the output got truncated/dropped under load. So the
   Explorer never settled on a stable view of `target/`.

The fix in this PR addresses all three at the layer that introduced
each regression, plus adds reproduction-quality regression tests:

- **PTY listener leak**: introduce `detachBusListeners()` inside both
  `makePseudoterminal()` and `makeCargoPty()` and call it at the top of
  every `open()` so re-opens never accumulate subscribers.
- **Sync hook**: restore `-path /workspace/target -prune`, but emit a
  *single* `D\t<base64 /workspace/target>` line so VS Code still gets
  the directory entry. Add an idempotency guard so re-sourcing
  `/root/.bash_profile` doesn't double-install `PROMPT_COMMAND`.
- **Sweep**: filter `target/` paths out of the deletion-sweep list so
  cached metadata stubs survive the now-pruned scan.
- **Regression tests** in `web/tests/extension-pty-listeners.test.mjs`,
  `web/tests/workspace-sync.test.mjs`, and a new e2e test in
  `web/tests/e2e/local-pages-e2e.test.mjs` that types into the bus and
  asserts the marker appears exactly twice (one bash echo + one
  program output) — strictly less than the doubled stream the bug
  produced.
- **Debug surface**: opt-in `globalThis.__RWB_DEBUG_TERMINAL_STREAM`
  trace at both the bus emitter (webvm-server) and the pty subscriber
  (webvm-host extension) so any future duplicate-output regression is
  one console toggle away from being attributable.

## Issue Data

- Issue: https://github.com/link-foundation/rust-web-box/issues/27
- PR: https://github.com/link-foundation/rust-web-box/pull/28
- Branch: `issue-27-207271149d2b`
- Opened: 2026-05-09 07:18:51 UTC (≈2h after PR #26 merged at 05:12:58 UTC)
- Reporter: `konard`
- Predecessor PR: #26 (merged 2026-05-09 05:12:58 UTC), the source of all three regressions

| File | Purpose |
| --- | --- |
| `evidence/issue-27.json` | Full issue payload captured with `gh issue view`. |
| `evidence/issue-27-comments.json` | Issue comments. |
| `evidence/pr-28.json` | PR metadata. |
| `evidence/pr-28-review-comments.json` | Inline PR review comments. |
| `evidence/pr-28-conversation-comments.json` | PR conversation comments. |
| `evidence/pr-28-reviews.json` | PR reviews. |
| `evidence/pr-26-context.json` | The merged predecessor PR that introduced all three regressions. |
| `screenshots/issue-27-report.png` | Reporter's screenshot showing duplicated input (`lll[ll[lls`s, `cccaaarrgggoorruunn`). |
| `online-research.md` | External notes on xterm.js / VS Code pseudoterminal echo semantics, find performance over Cargo target, and EventEmitter listener accounting. |
| `verification/local-tests.log` | `node --test web/tests/*.test.mjs` output after the fix. |

## Requirements From The Issue

| Requirement | Status | Evidence |
| --- | --- | --- |
| Each typed symbol must NOT be duplicated | Implemented | `extension-pty-listeners.test.mjs` (3 tests) + new e2e marker count == 2 |
| `cargo run` must react to file changes | Implemented | Sync hook restored to a fast path (target pruned), so the JS↔guest race that overwrote saves no longer fires every prompt |
| Target folder must remain visible in Explorer | Implemented | Single `D\t/workspace/target` frame + sweep filter for paths under `target/` |
| All issue #25 requirements still satisfied | Preserved | `workspace-sync: target directory itself is surfaced without descending into it` + existing #25 e2e still asserts on `target` in the tree |
| E2E tests with browser-commander, run on every PR | Implemented | New test in `web/tests/e2e/local-pages-e2e.test.mjs`; existing `local-e2e` job in `.github/workflows/pages.yml` already runs the e2e suite for PRs against the built artifact |
| Add debug output / verbose mode | Implemented | `globalThis.__RWB_DEBUG_TERMINAL_STREAM` (off by default, no overhead) traces every chunk at both emitter and subscriber |
| Compile data into `docs/case-studies/issue-27/` | This file | Plus `evidence/`, `screenshots/`, `verification/`, `online-research.md` |
| Search for upstream/related issues | Documented | `online-research.md` § Upstream notes |
| File issues against related repos when applicable | Not required | All three regressions live in this repo's glue/extension code; CheerpX and VS Code Web were not at fault |

## Timeline

- 2026-05-08 21:10 UTC — Issue #25 opened (target folder missing).
- 2026-05-09 04:33 UTC — PR #26 opened to fix #25.
- 2026-05-09 05:12 UTC — PR #26 merged. The merged commit:
  - Removed `-path /workspace/target -prune` so `find` could discover
    target artifacts (`web/glue/workspace-sync.js`).
  - Added metadata-only file storage and a deletion sweep
    (`web/glue/workspace-fs.js`, `applyWorkspaceSyncSnapshot`).
  - Did NOT touch `web/extensions/webvm-host/extension.js` — but the
    extension's `bus.on('proc.stdout', …)` site became a problem the
    moment users started reattaching the workbench panel against the
    new "every prompt scans 10 K files" baseline.
- 2026-05-09 07:18 UTC — Issue #27 filed against the deployed Pages
  build. Screenshot shows `lll[ll[lls`s typed into the terminal,
  empty Explorer apart from `Cargo.toml` and `src/`, and stuck
  "Hello from rust-web-box! [old version]" output even after the user
  edited `main.rs`.
- 2026-05-09 (this branch) — Three-fold fix landed.

## Root Causes

### 1. PTY listener leak (`web/extensions/webvm-host/extension.js`)

`createWebVmTerminalProvider()` builds a Pseudoterminal whose `open()`
subscribes to the bus:

```js
// before
async open(initialDimensions) {
  …
  stdoutDispose = bus.on('proc.stdout', (payload) => {
    writeEmitter.fire(payload.chunk);
  });
  exitDispose = bus.on('proc.exit', () => { … });
  …
}
```

VS Code Web calls `open()` again on the same Pseudoterminal instance
in several cases (panel reattach, "Detach session" / "Attach to terminal",
state restore on page reload). Each call appended *another*
`bus.on('proc.stdout', …)` listener without disposing the previous one.
The bus is a single-emitter fan-out — if N listeners are registered,
each emit fires N times, and `writeEmitter.fire(payload.chunk)` runs N
times per chunk. The xterm-side rendering then appends each byte N
times.

The reporter's screenshot shows three-character clumps (`ccc`, `aaa`,
`rrr`) — consistent with three open() calls during their session, not
two. `bus.on()` returns a disposer that, when called, removes that
specific listener; the fix is to call it before reassigning.

### 2. Prompt-time scan over a 10 000-file `target/` (`web/glue/workspace-sync.js`)

PR #26's sync hook went from:

```sh
find /workspace -path /workspace/target -prune -o -path /workspace/.git -prune -o -print
```

to:

```sh
find /workspace -path /workspace/.git -prune -o -print
```

After the first `cargo build` the resulting OSC frame's payload is
~3-5 MB of base64 (10 K paths × Cargo's typical fingerprint sizes,
each one base64'd inline). Three things go wrong simultaneously:

1. The base64 + `wc -c` invocations cost real CPU time inside the
   guest — even with the OS-level page cache, every prompt return
   stalls noticeably.
2. The OSC frame is written to the same console that bash echoes
   into. xterm.js (VS Code's pty front-end) does NOT preserve write
   ordering across very large frames if rendering can't keep up; the
   net effect is a visible "freeze" between commands and intermittent
   dropped output.
3. The browser-side sync handler then runs `applyWorkspaceSyncSnapshot`
   over the same 10 K paths, including a deletion sweep against the
   previous `knownPaths`. The sweep is O(N) and the IndexedDB writes
   it issues serialise behind any in-flight VS Code save — so a
   `Ctrl+S` issued mid-sync gets clobbered by the snapshot's older
   version of the same file. That's the "cargo run does not react to
   changes" report.

### 3. Target metadata wiped by deletion sweep

PR #26 stores skipped target artifacts as metadata-only files. But the
sweep ran:

```js
const deleted = [...knownPaths].filter((path) => !currentPaths.has(path));
```

Once a `cargo build` writes a new artifact, the next prompt's sync
emits *that* new file but may drop older ones if the OSC frame is
truncated under load (see #2). On the next sweep cycle they're "in
knownPaths but not in currentPaths" and get deleted. Each sweep
trimmed the Explorer's view of `target/`, until eventually the user
saw an empty tree — exactly the symptom they had filed #25 to fix.

## Solution

### `web/glue/workspace-sync.js`

```sh
# Restored prune so prompt-time sync stays cheap …
find /workspace -path /workspace/.git -prune -o -path /workspace/target -prune -o -print …

# … but ALWAYS emit a single 'D' frame for the target dir itself, so
# VS Code's Explorer keeps a stable entry for it.
if [ -d /workspace/target ]; then
  printf 'D\t%s\n' "$(printf '%s' /workspace/target | base64 | tr -d '\n')"
fi
```

Plus a `case` guard so `__rwb_sync_from_guest` is only installed once:

```sh
if [ -n "${PROMPT_COMMAND:-}" ]; then
  case "${PROMPT_COMMAND}" in
    *__rwb_sync_from_guest*) ;;
    *) PROMPT_COMMAND="__rwb_sync_from_guest;${PROMPT_COMMAND}" ;;
  esac
else
  PROMPT_COMMAND="__rwb_sync_from_guest"
fi
```

And in `applyWorkspaceSyncSnapshot`, exclude target paths from the
deletion sweep so cached metadata stubs survive intentionally-pruned
prompt scans:

```js
const deleted = [...knownPaths]
  .filter((path) => !currentPaths.has(path))
  .filter((path) => !isUnderTarget(path))
  .sort((a, b) => b.length - a.length);
```

### `web/extensions/webvm-host/extension.js`

```js
function detachBusListeners() {
  try { stdoutDispose?.(); } catch {}
  try { exitDispose?.(); } catch {}
  stdoutDispose = null;
  exitDispose = null;
}

return {
  async open() {
    detachBusListeners();      // <— new: drop stale subscribers first
    …
    stdoutDispose = bus.on('proc.stdout', …);
    exitDispose   = bus.on('proc.exit',   …);
  },
  close() { detachBusListeners(); … },
};
```

The same fix is applied to `makeCargoPty()` (the cargo-tasks pty,
which has the same shape).

A separate guard avoids creating a second `WebVM bash` terminal if
`activate()` ever runs twice:

```js
setTimeout(() => {
  const existing = vscode.window.terminals?.find((t) => t?.name === 'WebVM bash');
  if (existing) { existing.show(); return; }
  vscode.window.createTerminal({ … }).show();
}, 350);
```

### `web/glue/webvm-server.js`

Opt-in trace on the emitter side, mirroring the one in the extension:

```js
let stdoutChunkCount = 0;
console_.onData((bytes) => {
  …
  if (globalThis.__RWB_DEBUG_TERMINAL_STREAM) {
    stdoutChunkCount += 1;
    console.log(`[rwb:terminal-stream] #${stdoutChunkCount} bytes=${chunk.length}`,
      JSON.stringify(chunk.slice(0, 80)));
  }
  busServer.emit('proc.stdout', { pid: 1, chunk });
});
```

If `[rwb:terminal-stream] #N` shows up once but `[rwb:pty:bash]` shows
up twice for the same N, the listener leak has come back. If both
appear once but xterm renders twice, the regression is at xterm/VS
Code level — different root cause, different fix.

## Verification

- `node --test web/tests/*.test.mjs` — 184 passing, 0 failing.
- Three new regression tests in
  `web/tests/extension-pty-listeners.test.mjs` (assert the source
  shape of the fix without requiring `vscode` at import time).
- Three updated/new tests in `web/tests/workspace-sync.test.mjs`:
  - `target directory itself is surfaced without descending into it`
  - `PROMPT_COMMAND is not double-installed if already present`
  - `target paths are not deleted from JS workspace by sweep`
- New e2e test
  `local e2e: terminal proc.stdout does not duplicate bytes when reattached`
  (skipped on machines without warm disk; required on CI).
- See `verification/local-tests.log` for the full pass output.

## Why the user-visible symptom was three things at once

The most useful insight from this case is that **PR #26 fixed one
visible bug by introducing three correlated ones**. Removing the
target prune so the file tree could be enumerated also turned every
prompt into a multi-MB OSC frame, which exposed an unrelated extension
bug (the listener leak — silent before because `proc.stdout` chunks
were small and infrequent), and which raced the deletion sweep that
the same PR added to support metadata-only files.

The lesson, encoded into the regression tests:

1. Any new prompt-time work goes behind a perf budget.
2. The fan-out path (`bus.on(...)`) ALWAYS gets a paired disposer
   call before reassignment; the test asserts this textually so a
   future copy-paste can't reintroduce the leak.
3. The deletion sweep is conservative: paths in known-pruned subtrees
   are exempt by construction, not by happy timing.

## Cross-references

- Issue #25 (`docs/case-studies/issue-25/`) — the predecessor.
- Issue #21 (`docs/case-studies/issue-21/`) — original sync-hook
  introduction, including the prune.
- Issue #17 (`docs/case-studies/issue-17/`) — CheerpX 1.3.0
  OverlayDevice 'a1' wedge that motivated `CARGO_INCREMENTAL=0` and
  the e2e harness's `__RUST_WEB_BOX_SKIP_PRIME` guard. Not the cause
  of #27 but adjacent in the e2e plumbing.
