# Upstream issue draft — leaningtech/cheerpx

This is a *draft* to file against `leaningtech/cheerpx` after the PR is
reviewed. It is intentionally self-contained: a CheerpX maintainer
should be able to read it without first reading rust-web-box.

**Title:** `GitHubDevice` does not retry transient `5xx` per-chunk
fetches; one poisoned chunk crashes the worker with
`CompileError … expected 1 elements on the stack for fallthru`.

**Repo:** https://github.com/leaningtech/cheerpx
**Version:** `cheerpx@1.3.0` (vendored at `web/cheerpx/` in the
reporter's project)

---

## Summary

When a CheerpX page hosted on a CDN/edge with occasional transient
`5xx` responses (e.g. GitHub Pages, Cloudflare, Fastly) reads a warm
disk via `CheerpX.GitHubDevice.create()`, a single 5xx on any chunk
permanently poisons that 128 KB block:

1. `GitHubDevice` returns a zero-filled buffer for the failed chunk
   instead of retrying.
2. The Linux guest reads bytes from that block and the JIT compiles
   them.
3. The generated WASM is malformed and `WebAssembly.Module()` throws
   `CompileError: Compiling function #0 failed: expected 1 elements
   on the stack for fallthru, found 0 @+145`.
4. A worker-side export that should have been initialised by step 2
   is left undefined; a `MessagePort` handler then throws
   `Uncaught TypeError: e is not a function`, which is what end-users
   actually see in the console.

We reproduced this in Brave on GitHub Pages
(https://link-foundation.github.io/rust-web-box/), screenshot is
attached.  We did **not** reproduce it in Chrome on the same hardware
because Chrome did not happen to hit a Pages 503 during the
benchmark — the root cause is network-side, the browser delta is
incidental.

## Why we believe the root cause is in `GitHubDevice`

- `GitHubDevice` issues a plain `fetch(url)` per `c{hex6}.txt` chunk
  with no retry, no timeout, and no hash verification.
- The downstream JIT trusts the bytes byte-for-byte.
- The CompileError is *deterministic given the bytes* — the same
  garbage block will fail to compile every time. So the JIT itself
  is not the regression; the regression is upstream feeding it a
  zero block.
- The downstream `TypeError: e is not a function` only shows up
  because the worker's `WebAssembly.compile()` rejection is
  swallowed and the partially-initialised module is wired into a
  `MessagePort`. We can debate whether that is a CheerpX bug or a
  WASM/JS pattern bug, but it is at minimum a usability bug —
  end-users see no actionable error.

## Reproducer

The reporter's deployment is the easiest path:

```
open https://link-foundation.github.io/rust-web-box/
# In Brave with default Shields. Repeat with hard reloads;
# the failure correlates with GitHub Pages' "Backend is unhealthy"
# windows.
```

Minimal synthetic reproducer (a test harness):

```js
// Run inside the page that loads CheerpX.
import * as CheerpX from "./cheerpx/index.js";

// Wrap fetch so the FIRST request to a specific chunk URL is forced
// to 503, then second succeeds. Simulates a Pages 503.
const real = globalThis.fetch;
let firstChunk = null;
globalThis.fetch = async function(input, init) {
  const url = typeof input === "string" ? input : input?.url;
  if (/\.c[0-9a-f]{6}\.txt(?:\?|$|#)/i.test(url || "")) {
    if (firstChunk === null) firstChunk = url;
    if (url === firstChunk && !(init?.headers?.["x-retry"])) {
      return new Response("", { status: 503 });
    }
  }
  return real.call(this, input, init);
};

const dev = await CheerpX.GitHubDevice.create("./disk/rust-alpine.ext2");
const cx  = await CheerpX.Linux.create({
  mounts: [{ type: "ext2", dev, path: "/" }],
});
// On affected setups this rejects with:
//   CompileError: Compiling function #0 failed: expected 1 elements
//   on the stack for fallthru, found 0 @+145
```

## Suggested fixes

In rough order of how much work each is upstream:

### 1. Retry per-chunk fetches in `GitHubDevice`

A small retry loop around the existing `fetch`:

```js
const RETRY_STATUSES = [408, 429, 500, 502, 503, 504];
async function fetchChunkWithRetry(url, { signal } = {}) {
  let lastRes = null;
  for (let attempt = 0; attempt <= 4; attempt++) {
    let res;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      if (err.name === "AbortError" || attempt === 4) throw err;
      await sleep(jitter(250, 6000, attempt));
      continue;
    }
    if (!RETRY_STATUSES.includes(res.status) || attempt === 4) return res;
    lastRes = res;
    await sleep(jitter(250, 6000, attempt));
  }
  return lastRes;
}
function jitter(base, cap, attempt) {
  const exp = Math.min(cap, base * 2 ** attempt);
  return Math.floor(Math.random() * exp);
}
```

This alone unblocks every page deployed on Pages / Cloudflare /
Fastly / any CDN that has occasional transient 5xx.

### 2. Per-chunk integrity check

Optional but desirable: have the build emit a manifest with per-chunk
SHA-256 or CRC32 and verify after `fetch()`. On mismatch, retry
(reusing the loop in §1) and finally throw an explicit error rather
than silently returning zeros.

This catches not only "Pages 503 returned an empty body" but also
"some intermediate proxy returned a 200 with truncated bytes", which
we have not seen but is otherwise indistinguishable.

### 3. Propagate compile failures from worker into the host promise

Today the failure surfaces as `TypeError: e is not a function` in a
`MessagePort` handler. Catching `WebAssembly.compile()`'s rejection
in the worker boot path and `postMessage`-ing it back to the host so
`Linux.create()` rejects with the *original* CompileError would let
hosts show a useful message to the end-user.

### 4. Document the failure mode

If §1–§3 are out of scope or take time, even a note in the
`GitHubDevice` README saying "this device does not retry transient
HTTP failures; wrap `fetch` yourself if your CDN can 5xx" would let
hosts add the retry on their side. We did that in rust-web-box at
`web/glue/disk-chunk-fetch.js` and are happy to upstream it.

## Workaround in rust-web-box

We are shipping a per-host workaround in PR #36
(https://github.com/link-foundation/rust-web-box/pull/36):

- `web/glue/disk-chunk-fetch.js` wraps `globalThis.fetch` for any
  URL matching `\.c[0-9a-f]{6}\.txt` and retries 5xx/408/429 plus
  network `TypeError` with capped exponential backoff and full
  jitter (algorithm from AWS's "Exponential Backoff and Jitter"
  post). Retries are surfaced into `__rustWebBox.diskDiag`.
- `web/glue/boot-diagnostics.js` categorises the resulting boot
  errors so users get an actionable toast instead of
  `Linux VM failed to boot: undefined`.

We would prefer not to maintain this wrapper indefinitely.

## References

- The failure-chain narrative and timing analysis are in
  `docs/case-studies/issue-35/README.md` of the reporter's project.
- Online research and source index (Brave V8 quirks, Pages 503
  semantics, WASM validation semantics) are in
  `docs/case-studies/issue-35/online-research.md`.

## Reporter

Filed by @konard on behalf of the rust-web-box project. Happy to
test patches against the live deployment.
