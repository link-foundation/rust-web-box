# Prepared upstream report — CheerpX interactive shell on iPad Safari

**Status: PREPARED, NOT YET FILED.** The issue tracker requires every
upstream report to contain a *reproducible example*. We do not yet have an
iPad to reproduce on, and the failure is device/version specific. This
draft is staged so it can be filed against
[leaningtech/cheerpx](https://github.com/leaningtech/cheerpx) (or the
[webvm](https://github.com/leaningtech/webvm) tracker) the moment a real
iPad produces a diagnostic dump (see *How to capture a repro* below).
Filing it now without a dump would violate our own "reproducible example"
rule and waste maintainer time.

---

## Title

`cx.run('/bin/bash', ['--login'])` never produces an interactive shell on
iPad Safari (workbench + CheerpX otherwise boot)

## Environment

- CheerpX `1.3.0` (vendored), `vscode-web@1.91.1`.
- Host page is cross-origin isolated (COOP `same-origin` + COEP
  `require-corp` synthesised by a service worker; `crossOriginIsolated`
  is `true`, `SharedArrayBuffer` is present).
- Reproduces on: iPad, Safari (iPadOS). **Exact iPadOS/Safari version and
  device model: TBD from the diagnostic dump.**
- Does NOT reproduce on: desktop Chrome/Chromium/Firefox/Safari, where the
  same code yields a working interactive bash prompt.

## Symptom

The VS Code workbench renders fine and CheerpX boots to `vmPhase: ready`,
but the terminal pane never shows a shell prompt. Our `runShellLoop`
spawns `/bin/bash --login` via `cx.run(...)`; on iPad the call appears to
either reject immediately or return/exit before any stdout reaches the
console handler, and our loop respawns it. Desktop browsers run the same
binary and arguments and get a normal interactive shell.

## Minimal call site

```js
// env = a fixed set of KEY=VALUE strings; cwd = '/workspace'
const code = await cx.run('/bin/bash', ['--login'], {
  env, cwd, uid: 0, gid: 0,
});
// Desktop: blocks for the life of the interactive session, streams stdout
//          to the attached console, returns an exit code on `exit`.
// iPad:    (observed) no prompt ever appears; the call resolves/throws
//          quickly and the loop respawns. Exact code/error: TBD from dump.
```

## What we need from the dump (attached when filed)

Our app exposes `window.__rustWebBox.dump()` (also auto-collected with
`?debug=1`). On the failing iPad it will report:

- `platform`, `maxTouchPoints`, `isSafari`, `isIPad`, `userAgent`
  (iPadOS version + Safari build).
- `crossOriginIsolated`, `sharedArrayBuffer`, `serviceWorker` (to confirm
  isolation is genuinely active on the device).
- `shellLoop`: `{ healthy, running, spawns, exits, errors, fastCycles,
  lastExitCode, lastError }` — this distinguishes the failure modes:
  - `errors > 0` with a `lastError` → `cx.run` is *rejecting* (likely a
    CheerpX/WASM/memory error — most actionable upstream).
  - `exits > 0`, `lastExitCode` set, `errors == 0` → bash *starts and
    exits* immediately (guest/init or TTY issue).

## Hypotheses (to be narrowed by the dump)

1. **Memory pressure.** iPad Safari caps per-tab memory more
   aggressively; CheerpX may fail to allocate the bash process' linear
   memory. → `lastError` would mention allocation / `RangeError`.
2. **WASM/JIT limitation.** Older iPadOS WebKit falls back to scalar code
   for some WASM SIMD paths; a hard incompatibility would surface as a
   `CompileError`/`LinkError` in `lastError`.
3. **SAB/atomics edge under Safari.** Even with `crossOriginIsolated`
   true, a Safari-specific `Atomics.wait` / worker-bootstrap edge could
   stall the run. → `running` stays true with no stdout, or a worker
   error in console.

## Workaround shipped in our app (this PR)

We do **not** disable the terminal on iPad (that would hide the bug).
Instead we surface it: after 3 consecutive fast spawn→exit cycles the
shell is flagged `healthy: false`, a boot toast tells the user the shell
could not start, and the full `shellLoop` diagnostic is logged + available
via `__rustWebBox.dump()`.

## Suggested fix directions for upstream

- If `cx.run` rejects on iPad, expose the underlying CheerpX/WASM error to
  the caller rather than a generic rejection, and document the
  memory/SAB requirements for iPadOS specifically.
- If it's memory, document a minimum free-memory guidance and/or a smaller
  default heap for mobile WebKit.

## How to capture a repro (for the maintainer who has an iPad)

1. Open https://link-foundation.github.io/rust-web-box/?debug=1 on the
   iPad in Safari.
2. Wait for the workbench to load and the terminal pane to appear.
3. In a desktop remote-debugging session (Mac Safari → Develop → iPad), or
   via the on-page toast, run `JSON.stringify(window.__rustWebBox.dump())`.
4. Paste that JSON here and fill in the TBD fields above.
