# Upstream issues

The investigation for issue #15 surfaced two candidate upstream
follow-ups. Neither blocks closing #15, but both are tracked here so
they don't get lost.

## CheerpX 1.2.11 `'a1'` regression

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
