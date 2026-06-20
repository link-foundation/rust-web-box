# Issue #43 — “Still not working on iPad Pro”

[Issue link](https://github.com/link-foundation/rust-web-box/issues/43) ·
[Predecessor #39](https://github.com/link-foundation/rust-web-box/issues/39) ·
[Predecessor #37](https://github.com/link-foundation/rust-web-box/issues/37) ·
[Screenshot](./issue-screenshot.png)

## TL;DR

A v0.16.0 PR (#40) replaced the dead-end iPad-Safari error toast with a
native VS Code notification. The screenshot on issue #43 — taken on a
fresh iPad Pro on 2026‑06‑15 — shows the **old toast still present**.
The PR was correct; **two infrastructure bugs** kept it from reaching the
device:

1. **Stale-cache pin (primary).** The service worker (`web/sw.js`) used
   a single cache-first strategy with a `CACHE_VERSION` that was never
   bumped through #39 / #41 / v0.16.0 / v0.17.0. Every iPad that visited
   the site during v0.15.0 still serves the old toast forever, because
   the SW returns the cached `glue/boot.js` before the new one is even
   fetched.
2. **Dead-end debug advisory (secondary).** Even after the cache is
   flushed, the silent-shell advisory that fires on the iPad-Safari
   CheerpX hang still says “run `__rustWebBox.dump()` in the browser
   console.” iPadOS Safari has no easy developer console, so the user
   is sent to a surface they cannot reach. The maintainer brief in #43
   addresses this explicitly: *“all debug info should be output in VS
   Code terminal. As there no easy debug for iPadOS Safari.”*

This PR fixes both.

## Timeline

| When | What |
|---|---|
| 2026‑03‑19 | #37 filed: iPad-Safari terminal hangs silently in CheerpX |
| 2026‑04‑29 | #39 filed: replace the dead-end maintainer-only toast with native VS Code notifications |
| 2026‑05‑03 | #40 merged: notification center wired through VS Code’s `showErrorMessage` / `showWarningMessage` / `showInformationMessage` API |
| 2026‑05 → 2026‑06 | v0.15.0 → v0.17.0 shipped, but `web/sw.js` `CACHE_VERSION` was never bumped past `v3-vscode1.91.1-cheerpx1.3.3-app1` |
| 2026‑06‑15 | #43 filed: screenshot shows the original toast on iPad Pro despite #40 being live for >5 weeks |

## Verbatim requirements

> 1. Please make sure we use only notifications inside VSCode itself.
> 2. And all debug info should be output in VS Code terminal. As there
>    no easy debug for iPadOS Safari.
> 3. Download all logs and data → `./docs/case-studies/issue-43`, deep
>    case study, reconstruct timeline, list requirements, find root
>    causes, propose solutions; search online for additional facts.
> 4. If there isn’t enough data → add debug output and verbose mode.
> 5. Report related issues upstream with reproducible examples and
>    fix suggestions.
> 6. Apply the fix across the **entire codebase**, not just the first
>    site found.
> 7. Plan and execute in this single pull request.

## Requirements coverage

| # | Requirement | Where it lives in this PR |
|---|---|---|
| 1 | VS Code‑only notifications | Already enforced by #39. This PR re-runs the codebase sweep — no custom HTML widget remains. Audit log below. |
| 2 | Debug in the VS Code terminal | `web/glue/debug.js` (`formatDiagnosticsForTerminal`), `web/glue/webvm-server.js` (silent-shell advisory now prints the diagnostics block in-terminal, new `vm.diagnostics` bus method), `web/extensions/webvm-host/extension.js` (new `WebVM: Show Diagnostics in Terminal` command + pseudoterminal), `web/glue/boot.js` (shell-unhealthy hint points at the new command). |
| 3 | Case study + evidence | This file, `online-research.md`, the four `.json` evidence files, and the screenshot in this folder. |
| 4 | Verbose mode / more debug | `dumpRuntime` now surfaces `outputBytes` / `silentSpawns` / `slowFirstOutput`. Existing `?debug=*` flag is unchanged but its output stream is now reachable from a device with no developer console — via the terminal. |
| 5 | Upstream reports | No clear upstream owner: CheerpX is closed-source; VS Code-Web is not at fault; the `vscode.dev` reference renderer also exhibits the same iPad-Safari silent-shell pattern (this is a known WebKit/CheerpX interaction, see #37 and the “online research” page). Nothing new and reproducible to file. |
| 6 | Entire codebase | The audit in this PR confirms no other site renders error UI outside VS Code’s notification API or the terminal. Grep targets: `document.createElement`, `innerHTML`, `alert(`, `confirm(`, `prompt(`, `toast`. None matched outside of node_modules. The “browser console” string is gone from every user-facing path (only documentation comments remain). |
| 7 | One PR | This PR (#44). |

## Root causes — deep dive

### RC‑1 Stale service-worker cache

`web/sw.js` (pre-PR) used `cacheFirst` for *every* path, and
`CACHE_VERSION` was last touched in #36. The activate handler only
evicts caches whose name **differs from** `CACHE_VERSION`. So:

* v0.15.0 device visits → `glue/boot.js` populated into cache `v3-…-app1`.
* v0.16.0 (#40 merged) ships a new `glue/boot.js` that uses the
  notification center.
* The service worker still has cache `v3-…-app1`. The fetch handler
  returns the cached v0.15.0 `glue/boot.js`. The dead-end toast is
  rendered. **The fix is invisible to the user.**

There is no reasonable way to invalidate at the network layer (GitHub
Pages does not let us set headers), so the fix must:

1. **Switch the shell to network-first** so the page never pins.
2. **Bump the cache version once** so every device evicts the stale
   cache and seeds the new policy.
3. **Keep cache-first only for the huge immutable assets**
   (`/vscode-web/`, `/cheerpx/`, `/disk/`) so we don’t blow up the
   GitHub Pages egress budget.

Implementation: see `web/sw.js`. The `IMMUTABLE_PREFIXES` list draws
the line. Tests live in `web/tests/sw-cache-strategy.test.mjs` (13
tests, all green).

### RC‑2 Dead-end debug surface

The iPad-Safari CheerpX silent-shell failure (issue #37) trips the
first-output watchdog. The watchdog writes a banner directly to the
terminal *and* attaches a one-line hint reading

> Diagnostics: run `__rustWebBox.dump()` in the browser console.

There is no usable browser console on iPadOS Safari. Connecting to a
Mac for `Develop ▸ Web Inspector` is what the screenshot’s user
explicitly cannot do (they just want it to work on the device).

Fix: the watchdog now inlines a multi-line diagnostics block straight
into the terminal — `time`, `userAgent`, `browser`, isolation flags,
`vmPhase`, shell-loop stats. Independently, `bus.request('vm.diagnostics')`
returns `{dump, terminalText}` and the new VS Code command **WebVM:
Show Diagnostics in Terminal** opens a throwaway pseudoterminal that
prints the block on demand, even when nothing is failing.

`dumpRuntime` now surfaces three new signals that pinpoint the
iPad-Safari mode of failure:

* `outputBytes` — how many bytes the shell has ever printed
  (`0` means “bash spawned but never wrote a prompt”).
* `silentSpawns` — how many shell spawns ended with `outputBytes === 0`.
* `slowFirstOutput` — `true` once the first-output watchdog has fired.

A maintainer screenshot of the terminal is enough to triage.

## Audit summary (requirement 6)

* `grep` for `document.createElement|innerHTML|appendChild|alert\(|confirm\(|prompt\(|toast` across `web/glue` and `web/extensions` → 0 matches outside `node_modules`.
* `grep` for `showErrorMessage|showWarningMessage|showInformationMessage` → all three call paths route through `vscode.window`; the only call sites are the webvm-host extension (3) and the rust-analyzer-web extension (1).
* `grep` for `browser console` in user-facing strings → 0 matches. Remaining mentions are documentation comments in `debug.js`, `webvm-server.js`, `extension.js`, `sw.js`, and `console-filter.js` that explain *why* the iPadOS-Safari surface was retired.
* `web/index.html` and `web/glue/boot.css` document, in a header comment, that errors must surface through VS Code’s native notification API.

## Solution alternatives considered

* **Force-reload the page on activate**. Too aggressive; would wipe
  unsaved guest workspace changes for users who don’t hit the bug.
* **Ship a separate `unregister.js`** to nuke the service worker once,
  then re-install on the next visit. Doubles the install dance and
  leaves the cache-version drift unfixed.
* **Network-only with no SW**. Wipes offline support and breaks the
  CheerpX disk-shard caching that is essential to keep the page
  bootable on flaky connections.

Chosen: split strategy + epoch bump. Same UX guarantees as the original
SW, one-time eviction, no re-installation choreography.

## Files surveyed

```
web/sw.js
web/glue/boot.js
web/glue/boot.css
web/glue/notifications.js
web/glue/webvm-server.js
web/glue/debug.js
web/glue/console-filter.js
web/extensions/webvm-host/package.json
web/extensions/webvm-host/extension.js
web/extensions/rust-analyzer-web/extension.js
web/index.html
web/build/index.template.html
```

## Verification

* `node --test web/tests/*.test.mjs` → **293 / 293 passing.**
* Two test files most relevant to this PR:
  * `web/tests/sw-cache-strategy.test.mjs` — 13 tests covering the
    network-first / cache-first split, COOP/COEP synthesis, cache
    eviction, and the `-app{N}` epoch.
  * `web/tests/diagnostics-in-terminal.test.mjs` — 8 tests covering
    the terminal formatter, the new `vm.diagnostics` bus method, the
    extension command registration, and the boot.js advisory rewrite.
* Existing `web/tests/webvm-server.test.mjs` silent-shell test
  updated to assert the new in-terminal block instead of the dead-end
  console hint.
