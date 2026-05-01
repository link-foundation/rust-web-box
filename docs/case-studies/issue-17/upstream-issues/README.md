# Upstream issue tracking — Issue #17

The underlying bug (`TypeError: …reading 'a1'` →
`CheerpException: Program exited with code 71` on fresh-inode allocation
under an OverlayDevice mount) is upstream in CheerpX 1.3.0. It is the
SAME bug as issue #15's root cause #6; only the trigger is different
(plain `cargo run` walks `target/debug/{build,deps,.fingerprint}/`,
which is dense in fresh inodes).

The canonical home for the upstream filing is therefore
[`docs/case-studies/issue-15/upstream-issues/`](../../issue-15/upstream-issues/).
When that filing happens, the maintainer's reproducer should reference:

- `experiments/cx-130-alpine-narrow5.mjs` (issue #15's minimal
  standalone reproducer of the OverlayDevice wedge)
- This case study's
  [`playwright-logs/01-cargo-run-wedge-console.log`](../playwright-logs/01-cargo-run-wedge-console.log)
  as evidence that plain `cargo run` is the second high-volume trigger
  in the wild after `primeGuestWorkspace()`.

We did NOT open a duplicate upstream issue here because:

1. The bug is identical; only the trigger is different.
2. A single detailed reproducer is more useful to the maintainer than a
   sequence of variations.
3. Our workaround (pre-bake debug AND release; `CARGO_INCREMENTAL=0`)
   is fully recoverable when upstream lands a fix.
