# Case Study: Issue #35 — "Error on Brave browser"

Issue: https://github.com/link-foundation/rust-web-box/issues/35

PR: https://github.com/link-foundation/rust-web-box/pull/36

## Summary

The reporter loaded the deployed page (https://link-foundation.github.io/rust-web-box/)
in Brave and captured three consecutive console errors:

1. `Failed to load resource: the server responded with a status of 503 ()`
   for `rust-web-box/disk/ru…ext2.c0000d7.txt`.
2. `Uncaught (in promise) CompileError: WebAssembly.Module(): Compiling
   function #0 failed: expected 1 elements on the stack for fallthru,
   found 0 @+145`, thrown inside a CheerpX worker.
3. `Uncaught TypeError: e is not a function` at
   `MessagePort.VF (…f753c94e887:1:59850)`.

Chrome on the same hardware loads fine. The reporter asked us to fix it
across the codebase, deep-dive the root cause, add debug output where
data is missing, and file upstream issues where applicable.

**Finding.** The Brave-specific symptom is *consistent* with a single,
common root cause — a transient `GitHub Pages 503` on one 128 KB
warm-disk chunk — that the page then mishandles in three downstream
ways:

- The block device does **not retry**: the chunk loader treats any
  non-200 as a permanent read failure and returns the zero-filled
  block. CheerpX then JITs garbage x86 into invalid WASM (root cause
  of the CompileError).
- Once a CheerpX worker's WASM compile throws, an export the worker
  was about to wire up never resolves; the message-port handler that
  references it then crashes with `e is not a function`.
- We have no Brave-aware diagnostics: the boot toast says
  `Linux VM failed to boot: undefined`, the console fires three
  generic stack traces, and the user has nothing actionable to do.

A secondary, less probable explanation is that the reporter (or a
default Brave Shields setting in their build) has the V8 optimizer
toggled off for the site via `brave://settings/content/v8`, hitting
upstream [brave-browser#36187](https://github.com/brave/brave-browser/issues/36187).
That path is documented in `online-research.md` and handled by the
diagnostic toast even if the disk read had succeeded.

**Fix shape (this PR).**

- Add a structured retry-with-backoff in front of the warm-disk chunk
  fetcher (5xx / 408 / 429 / `TypeError`-network, capped exponential
  backoff with jitter, surface attempts to `__rustWebBox.diskDiag`).
- Detect Brave by `navigator.brave?.isBrave()` and remember it as
  `__rustWebBox.browser`.
- Replace the bare boot-toast text with a structured renderer that
  recognises `WebAssembly.CompileError` and `503 on disk chunk`, and
  shows the Brave-aware workarounds (toggle V8 JIT for the site,
  retry, open in Chromium) when relevant.
- Capture diagnostics into `__rustWebBox.diagnostics` for the e2e
  harness and human inspection (CompileError messages, last chunk
  attempts, browser bits).
- Tests for the chunk retry, the diagnostic categoriser, and the
  Brave-aware toast.

We do **not** ship a workaround that disables warm disk on Brave —
that would let the underlying upstream bugs persist invisibly. We
instead document the upstream issues we depend on and file a CheerpX
report (Task #7).

## Evidence

| File | Purpose |
| --- | --- |
| `screenshots/issue-console.jpg` | Reporter's screenshot showing the three Brave console errors verbatim. |
| `evidence/issue-35.json` | Issue metadata + full body (GitHub API snapshot). |
| `evidence/issue-35-comments.json` | Issue comments (empty at time of writing). |
| `evidence/pr-36.json` | PR #36 metadata + commits. |
| `online-research.md` | Brave + V8 + farbling + WASM + Pages-503 references. |
| `verification/*.log` | Local test runs from this PR. |

## Timeline / sequence of events

1. **Build & deploy** — the latest `disk-latest` release was chunked
   by `web/build/stage-pages-disk.mjs` at the default 128 KB stride
   (`DEFAULT_CHUNK_SIZE = 131072`) and uploaded under
   `web/disk/<image>.c{hex6}.txt`. The manifest sets
   `warm.kind = 'github'` and `warm.chunk_size = 131072`.
2. **User opens the site in Brave** — page bootstraps, COOP/COEP
   service worker installs, workbench mounts, CheerpX loads.
3. **`bootLinux()` mounts the warm disk** — CheerpX's `GitHubDevice`
   begins streaming chunks on demand as Linux boots.
4. **Chunk fetch fails** — at offset 215 (`c0000d7` ≈ 215 × 128 KB ≈
   28 MB into the image) GitHub Pages returns HTTP 503 ("Backend is
   unhealthy"). `GitHubDevice` does not retry; the device interface
   sees zeros for that block.
5. **CheerpX JITs malformed code** — the x86 bytes Linux was about
   to execute from that block are zero/garbage. CheerpX's JIT
   produces a WASM function body whose declared result type is
   `i32` but whose body falls through with an empty stack.
6. **WASM validation fails** —
   `WebAssembly.Module(): Compiling function #0 failed: expected 1
   elements on the stack for fallthru, found 0 @+145`. The
   `aAh` → `aTt` → `aTr` frames in the screenshot are
   CheerpX's worker boot.
7. **Downstream symptom** — a worker export was supposed to be
   `e`, the exporter never ran, so the message-port handler hits
   `Uncaught TypeError: e is not a function at MessagePort.VF`.
8. **Boot stalls** — `bringUpVM` catches the rejection from
   `bootLinux` and shows a toast — but the toast text is the bare
   `err?.message ?? err`, which for a worker `TypeError` reads
   `undefined`. The reporter sees no useful message.

The Chrome-vs-Brave delta in (4) is intermittent at the network
layer: GitHub Pages 503s happen for everyone, but the user happened
to hit one in Brave. We treat (4)–(8) as a **single causal chain**
and harden each link.

## Requirements (extracted from the issue)

1. **Make the page work in Brave** — the deployed site must not
   crash for Brave users on first load.
2. **Apply the fix across the whole codebase**, not just one path.
3. **Compile issue data into `docs/case-studies/issue-35/`** —
   timeline, requirements, root causes, options, online research.
4. **Add debug output / verbose mode** if data is insufficient to
   identify the root cause.
5. **Report upstream issues** at related projects (e.g. CheerpX,
   Brave) with reproducers, workarounds, and fix suggestions.
6. **Do everything in PR #36**.

## Root cause(s)

### RC1 — warm-disk chunk loader does not retry on transient 5xx

`CheerpX.GitHubDevice.create()` (upstream `cheerpx@1.3.0`) wraps a
straight `fetch()` per chunk and does not retry on transient HTTP
errors. We invoke it through `createBlockDevice()` in
`web/glue/cheerpx-bridge.js:248`. There is no retry/jitter on
either side. A single 503 on a single 128 KB chunk poisons the
block.

GitHub Pages 503s are explicitly transient — see
`online-research.md` §4. The fix is a wrapping `fetch` with a
small retry budget.

### RC2 — JIT consumes a corrupted block

CheerpX 1.3.0's JIT does not validate input chunks against a hash
before compiling. Without RC1, RC2 produces the WASM CompileError
visible in the screenshot. The root cause is in the upstream JIT
behaviour; our mitigation is to never feed it a corrupted block
(RC1).

### RC3 — downstream `e is not a function`

When the CheerpX worker's WASM compile throws, an export named `e`
is never defined; the message-port handler `VF` later references
it. The root cause is upstream (CheerpX's worker error handling
swallows the CompileError instead of propagating it). Our
mitigation is to **observe** it: install a global
`unhandledrejection`/`error` listener that captures
`WebAssembly.CompileError` and `TypeError: e is not a function`
from CheerpX blobs, route them into a single diagnostic object,
and surface a structured toast.

### RC4 — toast prints `undefined`

`web/glue/boot.js:172` uses ``setToast(`Linux VM failed to boot:
${err?.message ?? err}`, 'error')``. For an opaque worker error,
`err` is `Event` and `err.message` is `undefined`, producing the
useless toast. We replace this with a categoriser that turns
known error shapes into actionable text.

### RC5 — possible Brave V8-optimizer setting (lower probability)

If RC1 did not fire and the WASM error still happened, the most
likely cause is upstream
[brave-browser#36187](https://github.com/brave/brave-browser/issues/36187):
`brave://settings/content/v8` (or `chrome://settings/content/v8`)
disables the V8 optimizer for the site, which on older Chromium
releases also disabled WASM. The fix is documented in the toast
("Brave detected — if WASM still fails, ensure V8 optimizer is
enabled for this site at `brave://settings/content/v8`").

## Possible solutions

| # | Option | Trade-off |
| --- | --- | --- |
| A | Retry transient 5xx/429/408 chunk fetches with capped exponential backoff + jitter. | Cheap, low-risk, fixes the dominant root cause RC1/RC2. Used. |
| B | Stop using GitHub Pages for warm-disk chunks. | Outside the scope of this PR; the manifest already supports `default` fallback to a CORS-served disk and falls back automatically when the warm disk errors at *mount* time (it does not currently fall back on per-chunk 503). Would also require us to host the disk somewhere with better SLA. Rejected for this PR. |
| C | Detect Brave and switch to default disk preemptively. | Hides the bug; doesn't fix Chrome users who occasionally see the same 503. Rejected. |
| D | Mirror chunks behind a Worker with `cache: 'force-cache'`. | Doesn't help the very first request which is the one that 503'd. Rejected. |
| E | Surface Brave-aware diagnostics + categorised toast even on RC5. | Cheap, high user value. Used (in addition to A). |
| F | File an upstream CheerpX issue requesting per-chunk retry / per-chunk hash verification. | Right thing to do; tracked as Task #7. |

Adopted: **A + E + F**.

## Solution plan

1. **`web/glue/disk-chunk-fetch.js`** — new module. Exports
   `createDiskChunkFetch({ fetchImpl, maxRetries, baseDelayMs,
   logger })`. Strategy:
   - retry on `5xx`, `408`, `429`, `TypeError`/network error;
   - exponential backoff with full jitter, capped at ~6 s;
   - emit attempt records into `__rustWebBox.diskDiag.attempts`.
2. **`web/glue/boot.js`** — call `installDiskChunkFetch({ target:
   globalThis })` BEFORE the CheerpX module is imported. The
   matcher inside `disk-chunk-fetch.js` restricts the retry path
   to URLs matching `\.c[0-9a-f]{6}\.txt`; all other fetches go
   through the original `globalThis.fetch` untouched. Wrapping at
   the global before CheerpX loads is required because CheerpX
   captures `fetch` once at module-eval time.
3. **`web/glue/browser-info.js`** — new module. Exports
   `detectBrowser({ navigator })` returning
   `{ isBrave, ua, brave: navigator.brave }`. Used by the toast
   renderer to add Brave-specific hints. Implements the async
   `navigator.brave?.isBrave()` check.
4. **`web/glue/boot-diagnostics.js`** — new module. Captures
   `unhandledrejection` + `error` events with
   `WebAssembly.CompileError` / `TypeError: e is not a function`
   / `503 on disk chunk` shapes. Returns a structured object the
   toast and `__rustWebBox.diagnostics` can consume.
   `categorizeBootError(input)` returns `{ kind, title, body,
   hints }`.
5. **`web/glue/boot.js`** — replace bare `setToast` strings with
   `renderBootError(category, browser)` from
   `boot-diagnostics.js`.
6. **Tests** under `web/tests/` (flat layout matches the rest of
   the project):
   - `disk-chunk-fetch.test.mjs`
   - `boot-diagnostics.test.mjs`
   - `browser-info.test.mjs`
7. **Upstream issue draft** under
   `docs/case-studies/issue-35/upstream-cheerpx-issue.md`. Filed
   manually once approved.

## Known existing components / libraries

- **`p-retry`** (npm) — battle-tested retry-with-backoff. We do
  not depend on npm in the web glue (everything is ESM under
  `web/glue/`), so we write the small loop inline (~20 LOC). The
  algorithm matches the AWS "Exponential Backoff and Jitter" post.
- **`cross-fetch` / `whatwg-fetch`** — irrelevant; we use the
  platform `fetch`.
- **CheerpX `IDBDevice` + `OverlayDevice`** — already in use.
- **`navigator.brave.isBrave()`** — Brave's documented detection
  surface.

## Outstanding follow-ups

- Task #6: tests added under `web/tests/` —
  `disk-chunk-fetch.test.mjs` (10), `boot-diagnostics.test.mjs`
  (12), `browser-info.test.mjs` (6). All 28 pass; full suite is
  225 pass / 4 skipped / 0 fail.
- Task #7: upstream issue drafted at
  `docs/case-studies/issue-35/upstream-cheerpx-issue.md`. To be
  filed at `leaningtech/cheerpx` after PR review.
- Task #2: a deterministic Brave reproducer would require running
  the e2e harness under Brave. The existing `web/tests/e2e/`
  Playwright harness only targets Chromium upstream; we record
  the limitation here rather than attempting a heavyweight
  reproducer.
