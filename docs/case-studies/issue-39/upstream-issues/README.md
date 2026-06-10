# Upstream issues — issue #39

## Terminal failure: same root cause as the already-filed CheerpX bug

The iPad Pro terminal failure in issue #39 is **not a new bug**. It is the
same CheerpX `OverlayDevice` fresh-inode-allocation wedge that already
causes the Safari/iPad terminal symptom in issues #15, #17, and #37. That
runtime bug has a single canonical upstream report:

- **https://github.com/leaningtech/webvm/issues/222**

  *OverlayDevice fresh-inode allocation intermittently wedges the runtime
  (TypeError reading 'a1', exit code 71; `cx.run` promise never settles).*

The report already covers:

- All three observed triggers (workspace prime, `cargo run`, interactive
  `bash --login`).
- A minimal reproducer (`experiments/cx-130-alpine-narrow5.mjs`).
- The workarounds we ship (retry, Chromium fallback, visible advisory).
- A fix suggestion (make fresh-inode allocation deterministic; reject the
  `cx.run` promise instead of leaving it pending so callers can recover).

Because the iPad symptom in #39 is the same wedge, **no new upstream issue
is warranted** — filing a duplicate would only fragment the report. The
#39 work is entirely page-side: stop inventing UI, surface the failure
through VS Code's native notifications, and make the terminal genuinely
fail.

CheerpX has no public issue tracker; `leaningtech/webvm` (issues enabled)
is the canonical home for CheerpX runtime bugs.

## VS Code / vscode-web

No upstream issue needed. We are *adopting* VS Code's documented
notification API (`window.showError/Warning/InformationMessage`) and
`Pseudoterminal` exit-code channel exactly as intended; no defect or
missing capability was found on that side.
