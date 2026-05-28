# Online research — issue #35 (Brave browser errors)

Notes gathered while investigating the three console errors the user
captured on Brave. Each section names the source, the relevant quote
or summary, and how it bears on our diagnosis.

## 1. Brave / Chromium V8 + WebAssembly

### brave-browser#36187 — V8 optimiser disabled globally still allows site exceptions, but breaks WASM there

> When V8 optimiser is disabled globally, but a site is allowed as an
> exception to this, WebAssembly is broken, when it should not be.

- Status: closed as not planned (Brave treats it as upstream Chromium).
- Reproduces in Chrome 122.0.6261.39, so it is a V8 bug rather than a
  Brave-specific code path.
- Disabling Brave Shields or Rewards does not work around it.
- Source: https://github.com/brave/brave-browser/issues/36187

### brave-browser#3366 — Pages using WebAssembly eventually crash with enough reloads

> Pages using WebAssembly crash after repeated reloads, displaying
> errors like "Out of memory: wasm memory" or "could not allocate
> memory."

- Brave-specific (does not reproduce in Chrome or Firefox).
- Trigger: ~30–40 reloads of a WASM-heavy page.
- Workaround: open a new tab.
- Status: `Chromium/waiting upstream`, closed/stale.
- Source: https://github.com/brave/brave-browser/issues/3366

### Per-site V8 JIT controls (Chromium 122+)

- `chrome://settings/content/v8` (and `brave://settings/content/v8`)
  lets users disable the V8 optimizer globally or per site.
- In Chromium 122.0.6261.57 .. 122.0.6261.94 the behaviour was
  changed so that disabling the V8 optimizer no longer disables
  WebAssembly; before that change disabling V8 optimizer turned WASM
  off completely on the site.
- Practical implication: a user who once toggled the V8 JIT off
  (Brave Shields' "block JIT" advanced setting, or this content
  setting) on an older release and never toggled it back can still
  see WASM modules fail to compile.
- Source: https://discuss.privacyguides.net/t/v8-jit-javascript-wasm-engine-can-be-disabled-configured-on-a-per-site-basis-in-chromium-122/17126

## 2. Brave Shields / farbling and Workers

### brave-browser#42427 — Per-site farbling in Workers follow-up

- Worker-scope farbling has been a moving target across Brave releases.
- Some failure modes only show up when the page launches a Worker /
  Dedicated Worker that itself calls `WebAssembly.compile()` (which is
  exactly what CheerpX does — its `cx_esm.js` spawns workers and
  compiles JIT-generated WASM modules inside them).
- Source: https://github.com/brave/brave-browser/issues/42427

### sampson.codes — Brave farbling parity & web compat taxonomy

> Recent Brave Shields adaptive farbling has introduced web
> compatibility regressions, with four observable failure modes
> including per-frame canvas hash drift, audio context spectral
> re-quantisation, WebGL renderer string disambiguation, and
> font-metric quantisation skew.

- Even APIs we do not directly use can mutate timings inside
  CheerpX's scheduler (`performance.now()` is farbled), changing the
  order in which async loaders settle.
- Source: https://sampson.codes/experiments/brave-browser-compat/

### brave-browser#32667 — service workers unexpectedly blocked when shields are down

- Confirms that worker-scope shield logic has had functional
  regressions in the past.
- Source: https://github.com/brave/brave-browser/issues/32667

## 3. WebAssembly validation error semantics

### MDN — `WebAssembly.CompileError`

> The `WebAssembly.CompileError` object indicates an error during
> WebAssembly decoding or validation.

- The CompileError is thrown by the engine when the wasm bytes
  presented to `WebAssembly.compile()` / `Module()` are syntactically
  valid but fail validation.
- Source: https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/CompileError

### "expected N elements on the stack for fallthru, found M"

The validator counts the operand stack at the implicit fall-through
out of a block. If a function declares one result type but its body
falls through with an empty stack, validation fails with this exact
message. References:

- titzer/virgil#19 — same message at the function level when `main`
  returned the wrong arity.
- ethereum/solidity#8962 — same family, `return` vs `fallthru`.
- WebAssembly/wabt#586 — describes the rules around unreachable-tee
  acceptance that surround this validator path.

The pertinent point for issue #35: the message is **deterministic
given the bytes**. The same bytes produce the same validation result
in every browser. Variation between Chrome and Brave can only come
from:

1. The bytes themselves differing (a truncated download, a corrupted
   blob, a JIT-time generator that consumes randomness/timing that
   has been farbled).
2. The wasm being constructed dynamically (CheerpX's x86→wasm JIT)
   from upstream inputs that themselves differ (e.g. a disk chunk
   that failed to load — see §4).
3. The wasm validator behaving differently because a chromium flag
   like "disable optimizer" is set on this site (§1, #36187).

Sources:
- https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/CompileError
- https://github.com/titzer/virgil/issues/19
- https://github.com/ethereum/solidity/issues/8962
- https://github.com/WebAssembly/wabt/issues/586

## 4. GitHub Pages 503 ("Backend is unhealthy")

### community-discussions

- The 503 propagates from Fastly: GitHub Pages' edge layer returns
  it when the upstream Pages backend is briefly unhealthy. It is not
  a per-user / per-browser condition — it is GitHub-side.
- Recommended workarounds in the community thread: hard reload, try
  a different network, wait, push an empty commit to re-warm the
  backend.
- Sources:
  - https://github.com/orgs/community/discussions/11915
  - https://github.com/orgs/community/discussions/171298
  - https://github.com/orgs/community/discussions/53428
  - https://github.com/orgs/community/discussions/181682

### Implication for our disk chunks

`web/disk/manifest.json` warm-disk-kind is `github`. CheerpX's
`GitHubDevice` reads the image as 128 KB `.c{6-hex}.txt` chunks. If
**any** chunk returns 503, that 128 KB block reads as a network
failure. The block contains x86 instructions that the CheerpX JIT
is about to compile — if the JIT silently fills the failed block
with zeros, the resulting WASM is malformed and **WASM validation
fails** (§3 above). This is the cleanest explanation we have for
the three-error pattern in the screenshot: one root cause (one bad
chunk fetch), two downstream symptoms (malformed JIT output, then
an unset export tripping `e is not a function`).

## 5. CheerpX documentation

### cheerpx.io/docs/faq

- No documented stance on Brave specifically.
- States CheerpX requires `SharedArrayBuffer` + cross-origin
  isolation (we already handle this via `coi-bootstrap.js` +
  `sw.js`).
- Practical conclusion: there is no upstream guidance, so we should
  file an upstream issue (Task #7) once we have a reproducer.
- Source: https://cheerpx.io/docs/faq

## 6. Synthesis

- The Brave-only symptom is consistent with **either** a transient
  GitHub Pages 503 hitting on Brave (more likely under Shields'
  retry semantics) **or** a Shields/farbling/V8-optimizer setting
  that the user has tweaked.
- Both root causes are individually transient — the user's report
  ("works on Chrome, broken on Brave") is the kind of intermittent
  pattern produced by a 503 on a single 128 KB chunk.
- Either way, the page should not present the user with three
  uncaught stack traces. It should detect the failure, retry the
  chunk, and — if retries fail — surface a structured, Brave-aware
  toast that names the most likely cause and the workarounds.

Sources index (deduplicated):
- https://github.com/brave/brave-browser/issues/36187
- https://github.com/brave/brave-browser/issues/3366
- https://github.com/brave/brave-browser/issues/42427
- https://github.com/brave/brave-browser/issues/32667
- https://sampson.codes/experiments/brave-browser-compat/
- https://discuss.privacyguides.net/t/v8-jit-javascript-wasm-engine-can-be-disabled-configured-on-a-per-site-basis-in-chromium-122/17126
- https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/CompileError
- https://github.com/titzer/virgil/issues/19
- https://github.com/ethereum/solidity/issues/8962
- https://github.com/WebAssembly/wabt/issues/586
- https://github.com/orgs/community/discussions/11915
- https://github.com/orgs/community/discussions/171298
- https://github.com/orgs/community/discussions/53428
- https://github.com/orgs/community/discussions/181682
- https://cheerpx.io/docs/faq
