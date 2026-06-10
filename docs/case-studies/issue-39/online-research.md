# Online research — issue #39

Searches run while solving issue #39, with the facts that informed the
design. (Searches performed June 2026.)

## 1. VS Code's native notification API is the right surface

**Question:** What is the canonical way for a VS Code (Web) extension to
show errors and warnings, and does it auto-dismiss?

**Findings.**

- VS Code exposes exactly three notification methods:
  `window.showInformationMessage`, `window.showWarningMessage`, and
  `window.showErrorMessage`. Each takes a message string, optional
  `MessageOptions`, and optional clickable button items, and returns a
  `Thenable`.
- **Severity matters for persistence.** `showWarningMessage()` and
  `showErrorMessage()` do **not** disappear after a timeout, while
  `showInformationMessage()` does. This is exactly the behaviour we want:
  a real boot/terminal failure (error/warning) should *stay visible*
  until dismissed; transient "VM ready" info can auto-clear. Our severity
  mapping (`error`/`warning` → persistent, `info` → transient) follows
  this directly.
- The official UX guidelines advise: only notify when necessary, show one
  notification at a time, and provide actionable messages. Our records
  carry a `detail` string with the concrete next step ("reload the tab,
  or try a Chromium-based browser").

**Consequence for the fix.** We delete our home-grown red HTML toast and
defer entirely to these three native methods, deduping by a monotonic id
so a buffered+replayed record is shown once.

Sources:
- VS Code UX guidelines — Notifications: https://code.visualstudio.com/api/ux-guidelines/notifications
- VS Code API reference (`window.showErrorMessage`, etc.): https://code.visualstudio.com/api/references/vscode-api
- Sample extension: https://github.com/microsoft/vscode-extension-samples/blob/main/notifications-sample/src/extension.ts
- "Allow to show notifications that do not timeout" (confirms warning/error persistence): https://github.com/microsoft/vscode/issues/65459

## 2. CheerpX/WebVM on Safari/iPad — known terminal limitation

**Question:** Is the iPad Pro terminal failure a CheerpX/WebVM platform
limitation, and is it already tracked?

**Findings.**

- WebVM's own README states it is "compatible with any browser, both on
  Desktop (Chrome/Chromium, Edge, Firefox, Safari) and Mobile (Chrome,
  Safari), provided support for SAB (SharedArrayBuffer) is present, and
  the device has sufficient memory." So Safari/iPad is *nominally*
  supported — the failure is not "Safari is unsupported," it is an
  intermittent runtime wedge.
- CheerpX requires cross-origin isolation (COOP `same-origin` + COEP
  `require-corp`) for SharedArrayBuffer. Our service worker already
  synthesises those headers (verified by `boot-shell.test.mjs`), so the
  blank terminal is **not** a COOP/COEP misconfiguration on our side.
- Community reports of "black screen / blank" on CheerpX consistently
  resolve to "check the browser console for errors" — i.e. the runtime
  failing after load, not a setup problem. That matches our observation:
  the workbench renders, the disk loads, but the interactive shell spawn
  never yields a prompt.

**Consequence for the fix.** The terminal failure is the upstream CheerpX
`OverlayDevice` fresh-inode wedge, already filed as
`leaningtech/webvm#222`. We can't fix it page-side; we make it loud and
honest (native warning + genuine non-zero terminal exit) and point the
user at the upstream issue and the workarounds.

Sources:
- WebVM repo + README (browser compatibility, SAB requirement): https://github.com/leaningtech/webvm and https://github.com/leaningtech/webvm/blob/main/README.md
- CheerpX docs — Full OS tutorial (cross-origin isolation): https://cheerpx.io/docs/tutorials/full_os
- `@leaningtech/cheerpx` on npm: https://www.npmjs.com/package/@leaningtech/cheerpx
- Upstream tracking issue (ours): https://github.com/leaningtech/webvm/issues/222
