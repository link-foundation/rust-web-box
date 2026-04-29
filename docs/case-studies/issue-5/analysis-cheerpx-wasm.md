# Root cause #1 — Missing `cxcore-no-return-call.wasm`

> **Severity**: P0 — VM never boots on affected browsers.
> **Symptom**: Terminal stalls on "Booting Linux VM…" indefinitely.
> **Distinct console signal**:
> `CheerpX initialization failed: CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f`
> ([`evidence/console-first-load.log:52`](./evidence/console-first-load.log))

## What happens at boot

CheerpX 1.2.x ships its engine as paired `.js` + `.wasm` siblings. The ESM
wrapper (`cx_esm.js`) loads `cxcore.js`, which at startup probes WebAssembly
tail-call support:

```js
// (paraphrasing the bundled cxcore.js)
const haveTailCall = await detectTailCall();
const coreUrl = haveTailCall
  ? new URL('cxcore.wasm', import.meta.url)
  : new URL('cxcore-no-return-call.wasm', import.meta.url);
const { module } = await WebAssembly.instantiate(await fetch(coreUrl), …);
```

Both `.js` files exist in our vendored `web/cheerpx/`. Only one `.wasm` does.
On a browser **with** tail-call support, the page works. On a browser
**without**, `fetch(cxcore-no-return-call.wasm)` returns the SPA-404 HTML
that GitHub Pages serves for missing routes. The HTML starts with `<!DOCTYPE`
— bytes `3c 21 44 4f`. `WebAssembly.instantiate()` expects the magic word
`00 61 73 6d` ("\0asm") and rejects with the exact error line in the console.

## Smoking gun

The build script's CDN vendoring loop logs each fetch:

```
[cheerpx] vendoring cheerpx@1.2.11 from CDN
  fetch https://cxrtnc.leaningtech.com/1.2.11/cxcore.js -> .../cheerpx/cxcore.js ... ok
  fetch https://cxrtnc.leaningtech.com/1.2.11/cxcore-no-return-call.js -> .../cheerpx/cxcore-no-return-call.js ... ok
  fetch https://cxrtnc.leaningtech.com/1.2.11/cxcore.wasm -> .../cheerpx/cxcore.wasm ... ok
  # cxcore-no-return-call.wasm: NOT FETCHED — not in `files` array
```

[`evidence/network-requests.txt:78`](./evidence/network-requests.txt) shows
the live consequence:

```
[GET] https://link-foundation.github.io/rust-web-box/cheerpx/cxcore-no-return-call.wasm => [404]
```

`web/build/build-workbench.mjs:163-184` — the `files` array — has every
other paired asset (`cxbridge.js` + `cxbridge.wasm`, `cheerpOS.js` +
`cheerpOS.wasm`, `tun/ipstack.js` + `tun/ipstack.wasm`, …). Only
`cxcore-no-return-call.wasm` is missing. Comparing the array to a `grep` of
asset references inside `cxcore.js` would have caught this — the comment
above the array even says "[the list] was derived by grep" — but the grep
was clearly run before the `-no-return-call` split landed in CheerpX.

## Why it's browser-dependent

Tail-call support timeline:

| Browser           | Version | Date          | Notes                          |
| ----------------- | ------- | ------------- | ------------------------------ |
| Chrome / Edge     | 112     | 2023‑04‑04    | Default-on.                    |
| Firefox           | 121     | 2023‑12‑19    | Default-on after 121.          |
| Safari (WebKit)   | —       | not yet       | Behind a flag at writing.      |
| Node.js           | 20+     | 2023‑04‑18    | `--experimental-wasm-tail-call`. |

Safari and old Chromium / Firefox install bases *should* boot. Newer
Chromium / Firefox installs *do* boot — which is why the bug appears
intermittent and why the live screenshot showed a successful boot in PR #2
but not for the reporter.

## Fix

Add `'cxcore-no-return-call.wasm'` to the `files` array in
`web/build/build-workbench.mjs`. Both wasm variants are confirmed available
on the CDN at version 1.2.11:

```sh
$ curl -sI -o /dev/null -w "%{http_code}" https://cxrtnc.leaningtech.com/1.2.11/cxcore-no-return-call.wasm
200
```

A regression test (`web/tests/cheerpx-vendor-list.test.mjs`) statically
asserts every `cxcore*.js` listed has a sibling `*.wasm`. If a future
CheerpX upgrade introduces another `*-variant.js`, the test fails before
deploy.

## Why a runtime check would be wrong

We could `fetch()` each `.wasm` with `mode: 'cors'` at boot and warn the
user if it 404s. That helps the diagnostic surface but does not unbreak the
VM. The fix has to be in the build (or a CDN fallback) — vendoring is
load-bearing for the issue's "fully anonymous, zero‑signup, zero‑backend"
requirement, and runtime CDN fallback would re-introduce the issue #3
class of "hidden third-party dependency".

## Verification path

1. `cd web && node --test tests/cheerpx-vendor-list.test.mjs` — green.
2. `node build/build-workbench.mjs` — both wasm files now appear in `web/cheerpx/`.
3. Deploy preview → open in a Safari Tech Preview build → terminal advances
   past "Booting Linux VM…" to a busybox shell prompt.
