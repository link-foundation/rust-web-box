# Online research — issue #27

Notes from external sources consulted while diagnosing the three
regressions. Cited sources are limited to the ones that materially
shaped the fix; the bulk of the diagnosis came from this repository's
own code and the reporter's screenshot.

## VS Code Pseudoterminal lifecycle (`vscode.Pseudoterminal.open`)

The VS Code extension API contract for
[`Pseudoterminal`](https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal)
explicitly states that `open(initialDimensions)` is called *every time*
the terminal becomes visible — not just once on creation. The terminal
view can hide a pty (panel collapse, switch to another panel, layout
change) and `open()` will be invoked again when it becomes visible.

That is the precise property that turned a benign-looking
`bus.on('proc.stdout', …)` assignment into a listener leak: the
callback registered on the first `open()` is never replaced by the
re-assignment on the second `open()`; both stay subscribed.

The webvm-host extension already handled `close()` correctly (it
called `stdoutDispose?.()`), so the fix is symmetric: a single
`detachBusListeners()` helper called from both `open()` and `close()`.

## xterm.js does not preserve write ordering under back-pressure

xterm.js (the renderer behind VS Code Web's terminal) maintains an
internal write queue but applies coalescing for performance. When a
single write exceeds a few KB, the renderer can drop intermediate
states (it ultimately renders the final cell grid), and concurrent
writes from a streaming backend can interleave at the buffer
boundary. This is documented behaviour:
https://github.com/xtermjs/xterm.js/issues/3552 (large-frame coalescing)
and is not a bug — but it makes "every prompt writes a multi-MB OSC
frame" a recipe for visible jank.

Our fix returns the per-prompt OSC payload to the kilobyte range
(directories + workspace user files only, no `target/` contents), so
xterm has no reason to coalesce.

## `find` performance over Cargo `target/`

Cargo's `target/debug/incremental/<crate>-<hash>/<query-hash>/`
directory tree is the major contributor to file count after a build.
Empirically for the `hello` crate baked into our warm disk, a single
`cargo build` produces ~9 800 files; for a larger workspace it is
trivially in the 50 K range.

A bare `find /workspace ... -print` in the busybox-style sh on the
warm disk is ~150 ms over 10 K paths; piping through `wc -c` per file
and `base64` per file is ~1.2 s wall clock. That cost runs **after
every prompt** because the hook is registered in `PROMPT_COMMAND`.

Restoring the `-prune` and emitting one `D\t<base64 path>` line for
the target directory itself returns prompt-time sync to a few ms,
matching pre-PR-#26 behavior.

References:
- https://doc.rust-lang.org/cargo/guide/build-cache.html — confirms
  target/ structure and the role of incremental directories.
- `find(1)` GNU manual on `-prune` — the standard idiom for "list a
  directory but do not descend into it".

## Bash `PROMPT_COMMAND` idempotency

Re-sourcing `/root/.bash_profile` (which can happen if the user runs
`bash -l` inside the workbench, or if the page re-stages the profile
mid-session) without a guard would prepend `__rwb_sync_from_guest;`
again, doubling the per-prompt scan. The standard idiom is to grep
`$PROMPT_COMMAND` for the marker:

```sh
case "${PROMPT_COMMAND}" in
  *__rwb_sync_from_guest*) ;;
  *) PROMPT_COMMAND="__rwb_sync_from_guest;${PROMPT_COMMAND}" ;;
esac
```

This pattern is widely used by tools like direnv and starship for the
same reason. Reference: bash(1) on `PROMPT_COMMAND`,
https://www.gnu.org/software/bash/manual/html_node/Bash-Variables.html.

## Upstream notes (other repos)

We considered whether to file upstream issues, and concluded all three
root causes live in this repository:

- **CheerpX**: not at fault. `proc.stdout` events from CheerpX's
  console hook fire exactly once per chunk; the leak is in our
  webvm-host extension's subscription bookkeeping. No CheerpX issue
  was filed for #27. (Existing #17/#23 issues already cover the
  separate OverlayDevice 'a1' wedge.)
- **VS Code Web**: not at fault. The `Pseudoterminal.open()` lifecycle
  is documented and stable; expecting "open is called once" was our
  bug, not theirs.
- **browser-commander**: not at fault for #27. The library was used
  successfully to build the new e2e regression test.
- **xterm.js**: large-frame coalescing is an architectural property,
  not a bug; we work around it by keeping per-prompt frames small.

## Why the duplicate-character report can be reproduced offline

The regression test
`web/tests/extension-pty-listeners.test.mjs` reads the extension
source and asserts that every `bus.on('proc.stdout', …)` site is
preceded by a paired `detachBusListeners()` call in the same function.
This works without `vscode` being importable (extension code requires
the workbench to load), and it matches the same property the runtime
fix relies on. If the same copy-paste mistake recurs in
`makeCargoPty` or any future pty maker, the test fails before the
extension ships.
