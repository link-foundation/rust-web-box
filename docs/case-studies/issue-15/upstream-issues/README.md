# Upstream issues

The investigation for issue #15 surfaced three candidate upstream
follow-ups. None blocks closing #15, but all are tracked here so
they don't get lost.

## CheerpX 1.2.11 `'a1'` regression (boot-time)

- **Project:** [Leaning Technologies, CheerpX](https://github.com/leaningtech/cheerpx).
- **Status:** already fixed upstream by the time we triaged it. The
  symptom is a `TypeError: Cannot read properties of undefined (reading
  'a1')` that fires four times during Linux boot, sourced inside the
  CheerpX bundle's prefetch-flush chunk
  (`cxcore-mlx-9020-prefetch-flush.js`). Boot stalls with `vmPhase:
  'starting Linux'` and `cx.run` reports `CheerpException: Program
  exited with code 71`. Switching the imported runtime from 1.2.11 to
  1.3.0 (with no other changes) makes the same `cx.run` call return
  `status: 0`.
- **Decision:** no upstream issue filed because 1.3.0 already addresses
  it. Evidence is captured in `../playwright-logs/01..07.*` and the
  case-study `README.md`.

## CheerpX 1.3.0 OverlayDevice `'a1'` flake (post-boot)

- **Project:** [Leaning Technologies, CheerpX](https://github.com/leaningtech/cheerpx).
- **Status:** open. Distinct from the 1.2.11 boot-time crash. After
  Linux is up, `cx.run` of a script that does `mkdir -p
  /workspace/.vscode` or `printf > /workspace/<new-file>` non-deterministically
  fires the same `TypeError: Cannot read properties of undefined
  (reading 'a1')` and `Program exited with code 71`. The exception is
  logged via `pageerror` but the JS-level `cx.run` promise never
  settles — the entire CheerpX runtime wedges, every subsequent `cx.run`
  errors with `function signature mismatch`. Repro is racy and biased
  toward fresh inodes (overwriting existing inodes is reliable).
- **Setup:** rust-alpine ext2 disk + IDBDevice writable layer +
  OverlayDevice combining them. The retained
  `experiments/cx-130-alpine-narrow5.mjs` reproduces in a standalone
  page without VS Code or our boot pipeline (also see
  `experiments/cx-130-bisect-trace-bus-skip.mjs` for evidence that the
  same bug fires when VS Code calls `workspace.prime` via the bus).
- **Workaround in this PR:** four-layer mitigation — pre-bake seed
  paths in the disk image (so prime overwrites existing inodes only),
  add `skipPrime` parameter to `fullServerMethods` so the bus method
  honors the flag, bound `primeGuestWorkspace` with `Promise.race`, and
  set the skip flag in the e2e harness. Documented in
  `web/glue/webvm-server.js` and the parent case-study `README.md`.
- **Action item:** open an upstream issue with
  `experiments/cx-130-alpine-narrow5.mjs` as the minimal reproducer,
  after #15's PR merges.

## browser-commander wrapper coverage

- **Project:** [link-foundation/browser-commander](https://github.com/link-foundation/browser-commander).
- **Status:** open question. The harness uses
  `commander.page.evaluate(...)` and direct `page.on('console' | 'pageerror')`
  hooks because there is no first-class wrapper for either yet. Both
  patterns work but they bypass the abstraction the library is supposed
  to provide.
- **Action item:** when we open a follow-up PR (after this branch
  merges), enumerate exactly the surface area the harness uses and file
  a single feature-request issue upstream with the harness as the
  reproducer. Don't over-spec it from this case study — the harness
  itself is the spec.
- **Tracked here so we remember.**
