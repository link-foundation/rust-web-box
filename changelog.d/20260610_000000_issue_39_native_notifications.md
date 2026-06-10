---
bump: patch
---

### Changed
- Errors, warnings, and info are now surfaced through VS Code's **native** notification API (`window.showError/Warning/InformationMessage`) instead of a home-grown HTML widget. The page no longer invents its own UI element for failures (issue #39).

### Removed
- Removed the custom bottom-right `#boot-toast` overlay (div from `index.html` + `build/index.template.html`, styles from `boot.css`) and all `setToast`/`hideToast` DOM plumbing from `boot.js`. The issue-#37 viewport pin (`position: fixed; inset: 0`) is preserved (issue #39).

### Added
- New `web/glue/notifications.js` notification center: a single uniform path for every error/warning/info. It validates severity, assigns a monotonic id, keeps a bounded buffer, and broadcasts each record over the WebVM bus as `vm.notify`. Records produced before the extension host activates (early-boot disk/CheerpX failures) are buffered and replayed on attach and on the extension's `vm.notify.sync` request, deduped by id so each is shown exactly once — so we never fail silently (issue #39).
- The `webvm-host` extension now subscribes to `vm.notify` and renders each record via VS Code's native notifications (dedup by id, emits `vm.notify.sync` on activation); its inlined bus client gained an `emit()` for the sync handshake (issue #39).
- The integrated terminal now **genuinely fails** on an unhealthy shell: the pseudoterminal subscribes to `vm.shell {healthy:false}` and closes with a non-zero exit code (after letting the server's in-terminal advisory render), so VS Code marks the terminal as failed rather than leaving a blank, hung pane (issue #39).
- Regression tests `web/tests/notifications.test.mjs` (center contract: severity validation, monotonic ids, bounded buffer, replay-on-attach, replay-on-`vm.notify.sync`, dedup, dead-transport safety) and `web/tests/issue-39-no-custom-ui.test.mjs` (no toast in HTML/CSS, native notifications + terminal-fail wiring in the extension).
- Case study `docs/case-studies/issue-39/` with timeline, requirements checklist, root-cause analysis (terminal = upstream CheerpX wedge `leaningtech/webvm#222`; toast = our design debt), online research on the VS Code notification API and CheerpX/iPad support, and the iPad Pro evidence screenshot.
