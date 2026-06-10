# Upstream issue — FILED

The CheerpX `OverlayDevice` fresh-inode-allocation `'a1'` wedge (the root
cause behind the iPad-Safari terminal symptom in issue #37, and the same
bug as issues #15/#17) has been filed upstream as a single canonical
report:

- **https://github.com/leaningtech/webvm/issues/222**

Title: *OverlayDevice fresh-inode allocation intermittently wedges the
runtime (TypeError reading 'a1', exit code 71; cx.run promise never
settles)*

The report covers all three observed triggers (workspace prime, `cargo
run`, interactive `bash --login`), the minimal reproducer
(`experiments/cx-130-alpine-narrow5.mjs`), the workarounds we ship, and a
fix suggestion (make fresh-inode allocation deterministic; reject the
`cx.run` promise instead of leaving it pending so callers can recover).

CheerpX has no public issue tracker; `leaningtech/webvm` (issues enabled)
is the canonical home for CheerpX runtime bugs.
