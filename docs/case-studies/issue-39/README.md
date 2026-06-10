# Case Study: Issue #39 — "Web box does not work on iPad Pro"

Issue: https://github.com/link-foundation/rust-web-box/issues/39

PR: https://github.com/link-foundation/rust-web-box/pull/40

## Summary

The reporter opened the deployed app
(https://link-foundation.github.io/rust-web-box/) on an iPad Pro and
captured a single screenshot
([`evidence/ipad-pro-screenshot.png`](evidence/ipad-pro-screenshot.png)).
It shows the workbench rendering correctly — dark theme applied, Explorer
populated, `Cargo.toml` open, the VS Code panel docked — but with **two**
defects:

1. **The integrated terminal never produced a shell.** The pane shows our
   issue-#37 advisory: *"The Linux shell started but produced no prompt.
   This is the known CheerpX/WebVM terminal issue on Safari/iPad
   (rust-web-box#37)."* The terminal sat there, never failing and never
   recovering.
2. **A custom red HTML toast** floats in the bottom-right corner: *"The
   Linux shell could not start in this browser. Terminal features may be
   unavailable — see console for details."* This is an **invented UI
   element** — not part of VS Code's own surface.

From these, the reporter wrote three product requirements (verbatim):

> That must be fixed, also we should **not invent our own UI elements**,
> and use **VS Code notifications** for errors and warnings, as well as
> **actual fail in terminal**.
>
> Fix all the errors, and double check we **don't fail silently** and all
> errors and warnings are **handled uniformly**.

Plus the standard process requirements: compile issue data into this
case-study folder, reconstruct the timeline, enumerate every requirement,
root-cause each problem, propose solution plans (surveying existing
components/libraries), search online for corroborating facts, add debug
output / verbose mode where the root cause is not yet observable, file
upstream issues (with reproducible examples) where the bug lives in a
dependency, apply each fix across the **entire** codebase, and do it all
in this single PR.

## Timeline / sequence of events

1. **2026-06-10 07:25 UTC** — Issue #39 filed by `konard` with the iPad
   Pro screenshot. State: open, label `bug`. No comments.
2. **Context: issue #37 (PR #38, merged `c46eb00` / `v0.15.0`)** had
   already (a) fixed the dark theme and CSS clipping, (b) added the
   page-side shell-health watchdog that writes the in-terminal advisory
   and emits `vm.shell {healthy:false}`, and (c) introduced the
   bottom-right boot **toast** as a stop-gap "make the failure visible"
   UI. The iPad screenshot in #39 is literally the #37 mitigation in
   action — proof the diagnostics work, but also proof that the toast is
   a home-grown widget the product should not ship.
3. **This PR (#40)** removes the invented toast, routes every
   error/warning/info through VS Code's native notification API, and
   makes the terminal genuinely fail (non-zero exit) instead of idling.

## Requirements (every one, enumerated)

| # | Requirement (from the issue) | Status |
|---|------------------------------|--------|
| R1 | The iPad Pro terminal failure "must be fixed". | Root cause is upstream (CheerpX `OverlayDevice` wedge). Mitigated + made loud; tracked in `leaningtech/webvm#222`. See [Root causes](#root-causes). |
| R2 | "We should not invent our own UI elements." | **Done** — the `#boot-toast` div + CSS are deleted from `index.html`, `build/index.template.html`, and `boot.css`. |
| R3 | "Use VS Code notifications for errors and warnings." | **Done** — every record routes over `vm.notify` and is surfaced via `window.showError/Warning/InformationMessage`. |
| R4 | "As well as actual fail in terminal." | **Done** — the pseudoterminal closes with a non-zero exit on `vm.shell {healthy:false}`, so VS Code marks the terminal as failed. |
| R5 | "Fix all the errors … don't fail silently." | **Done** — the notification center always mirrors to the console too, and buffers pre-activation records so early-boot failures aren't lost. |
| R6 | "All errors and warnings are handled uniformly." | **Done** — a single `createNotificationCenter()` / `notify(severity, …)` is the only error/warning/info path; `boot.js` no longer has bespoke DOM-toast code. |
| R7 | Apply the fix across the **entire** codebase (every place). | **Done** — both HTML files (source + build template), `boot.css`, `boot.js`, `boot-diagnostics.js`, `browser-info.js`, and the `webvm-host` extension. |
| R8 | Compile issue data + deep case study in `docs/case-studies/issue-39`. | **This document** + `evidence/` + `online-research.md` + `upstream-issues/`. |
| R9 | Search online for corroborating facts. | See [`online-research.md`](online-research.md). |
| R10 | Add debug output / verbose mode if root cause not observable. | The iPad root cause is already observable (the issue-#37 watchdog + `__rustWebBox.dump()`); the new center mirrors every notification to the console. No new gap. |
| R11 | File upstream issues with reproducible examples. | The terminal root cause is the same CheerpX wedge already filed as `leaningtech/webvm#222`; no new upstream bug. See [`upstream-issues/README.md`](upstream-issues/README.md). |
| R12 | Single PR (#40); push only to `issue-39-c756f24958fb`. | **Done.** |

## Root causes

### The terminal failure (R1) — upstream CheerpX, not us

The terminal pipeline (page-side `webvm-server` ↔ bus ↔ extension
pseudoterminal) is sound; it works in Chromium and intermittently on
Safari/iPad. The failure lives **inside the CheerpX runtime**, whose
`OverlayDevice` fresh-inode allocation intermittently wedges (the
`TypeError reading 'a1'` / exit-71 / never-settling-`cx.run` bug). When
that wedge happens during the interactive `bash --login` spawn, bash
never prints a prompt, so the terminal stays blank. This is the **same**
upstream bug behind issues #15, #17, and #37, filed as a single canonical
report:

- **https://github.com/leaningtech/webvm/issues/222**

We cannot un-wedge CheerpX from page-side JS. What we *can* do — and what
#37 started and #39 completes — is make the failure **visible and
honest**: a visible in-terminal advisory naming the upstream issue, a
native VS Code warning notification, and a genuine non-zero terminal exit
so the panel shows the terminal as failed rather than hung.

### The invented UI (R2–R6) — our own design debt

Issue #37 added a `#boot-toast` `<div>` (red `rgba(248,81,73,…)`
background, fixed bottom-right, safe-area-inset offsets) as a quick way to
surface boot errors before the VS Code extension host is alive. It worked,
but it is exactly the "invented UI element" #39 calls out. The deeper
problem was **non-uniform error handling**: `boot.js` owned bespoke
`setToast`/`hideToast` DOM plumbing, while the extension had its own
ad-hoc `showErrorMessage` calls, and the two never shared a path. There
was no single place that guaranteed "every error is surfaced, exactly
once, through VS Code's own surface."

## Solution plans (per requirement) and what we shipped

### Chosen design: a uniform notification center over the bus

A single page-side module — [`web/glue/notifications.js`](../../../web/glue/notifications.js)
— is the *only* error/warning/info path:

- `notify({severity, message, detail, source})` validates the severity
  (`error` | `warning` | `info`, default `error`), assigns a **monotonic
  id**, pushes the record into a **bounded buffer** (default 50), and
  broadcasts it over the WebVM bus as a `vm.notify` event.
- The `webvm-host` extension subscribes to `vm.notify` and surfaces each
  record through VS Code's **native** API
  (`showErrorMessage` / `showWarningMessage` / `showInformationMessage`),
  deduping by id.

**Why buffer + replay.** Notifications can be produced very early in boot
(a disk-chunk 503, a CheerpX `CompileError`) *before* the extension host
has activated and subscribed. A fire-and-forget event would be lost — a
silent failure (violates R5). So the center keeps a bounded buffer and
replays it (a) whenever a bus transport is attached, and (b) on demand
when the freshly-activated extension emits `vm.notify.sync`. Dedup by id
means a record delivered both live and via replay is shown exactly once.

**Why a dedicated bus client for the center.** `busServer` only *emits*;
it would not survive the stage-1 → stage-2 method-table hot-swap as a
*listener*. So `boot.js` attaches the center to its own `createBusClient`
on a separate `BroadcastChannel` instance (same channel name), which can
both emit `vm.notify` and listen for `vm.notify.sync`.

**Mapping requirements to the implementation:**

- **R2 (no invented UI):** delete the `#boot-toast` div from
  `web/index.html` and `web/build/index.template.html`, and the
  `#boot-toast` CSS block from `web/glue/boot.css` (the issue-#37 viewport
  pin `position: fixed; inset: 0` is kept — it is unrelated to the toast).
- **R3 (VS Code notifications):** the extension's
  `subscribeNotifications()` renders each `vm.notify` record natively. The
  inlined bus client gained an `emit()` so it can request `vm.notify.sync`.
- **R4 (actual terminal fail):** `makePseudoterminal` subscribes to
  `vm.shell`; on `{healthy:false}` it writes a one-line failure notice and
  fires `closeEmitter.fire(1)` after a short defer (so the server's queued
  advisory renders first). The server-side advisory + `vm.shell` event
  from #37 are kept as the source of truth.
- **R5/R6 (no silent failure, uniform handling):** `boot.js`'s single
  `notify(severity, message, detail)` helper mirrors to the console
  *and* records into the center. All call sites — disk-fetch persistent
  failure, `showBootError`, the unhealthy-shell callback, the
  missing-VS-Code check — go through it.

### Existing components/libraries surveyed

- **VS Code notification API** (`window.showInformationMessage` /
  `showWarningMessage` / `showErrorMessage`) — the canonical, built-in
  surface. The official UX guidelines confirm error/warning notifications
  do **not** auto-dismiss (so a real failure stays visible) while info
  ones do, which matches our severity mapping. We use exactly these three
  methods rather than a custom widget. (See `online-research.md`.)
- **VS Code `Pseudoterminal` / `closeEmitter`** — the built-in way to
  signal terminal exit. Firing a non-zero code is the documented "the
  terminal process failed" channel; no custom UI needed.
- **WebVM bus** (`web/glue/webvm-bus.js`) — our existing same-origin
  `BroadcastChannel` request/response + event protocol. The notification
  center reuses it (a new `vm.notify` / `vm.notify.sync` topic pair)
  rather than inventing a side channel.
- **Toast libraries (Toastify, react-toastify, VS Code Webview toasts):**
  considered and **rejected** — they would re-introduce exactly the
  invented-UI element the issue asks us to remove. The whole point is to
  defer to VS Code's own notifications.

## Verification

- `web/tests/notifications.test.mjs` — the center's contract: severity
  validation, monotonic ids, bounded buffer, replay-on-attach,
  replay-on-`vm.notify.sync`, dedup-by-id, dead-transport safety, and
  sync-handler detach on re-attach.
- `web/tests/issue-39-no-custom-ui.test.mjs` — no `#boot-toast` in HTML or
  CSS; `boot.js` uses the center (no `setToast`/`hideToast`); the
  extension renders `vm.notify` via native VS Code APIs, emits
  `vm.notify.sync`, dedupes by id; the inlined bus client can `emit`; the
  pseudoterminal fails (`closeEmitter.fire(1)`) on `vm.shell {healthy:false}`.
- Updated `web/tests/boot-shell.test.mjs` and
  `web/tests/issue-37-ux-parity.test.mjs` to assert the toast is **gone**.
- Full suite: `cd web && node --test tests/` → 256 pass / 5 skip / 0 fail.

## Files changed

| File | Change |
|------|--------|
| `web/glue/notifications.js` | **New** — uniform notification center (buffer + replay over `vm.notify`). |
| `web/glue/boot.js` | Route every error/warning/info through `notify()`; attach the center to a dedicated bus client; remove all toast DOM plumbing. |
| `web/index.html`, `web/build/index.template.html` | Remove the `#boot-toast` div. |
| `web/glue/boot.css` | Remove the `#boot-toast` styles; keep the issue-#37 viewport pin. |
| `web/glue/boot-diagnostics.js`, `web/glue/browser-info.js` | Comment updates (toast → notification). |
| `web/extensions/webvm-host/extension.js` | Add `emit()` to the bus client; `subscribeNotifications()` (native VS Code notifications, dedup, `vm.notify.sync`); pseudoterminal fails on `vm.shell {healthy:false}`. |
| `web/tests/notifications.test.mjs`, `web/tests/issue-39-no-custom-ui.test.mjs` | **New** regression tests. |
| `web/tests/boot-shell.test.mjs`, `web/tests/issue-37-ux-parity.test.mjs` | Assert the toast is removed. |
