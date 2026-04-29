# Surrounding non‑blocking warnings

This document catalogues every non‑blocking message in
`evidence/console-first-load.txt`. None of these prevent the workbench
from booting; they appear *alongside* the P0 DataCloneError covered by
`analysis-coop-coep-bootstrap.md`. We document each one so future
regressions can quickly tell signal from noise.

## 1. `Ignoring the error while validating workspace folder webvm:/workspace - ENOPRO`

(*evidence/console-first-load.txt:5*)

Source: `vscode-web/out/vs/workbench/workbench.web.main.js`. VS Code
Web validates the configured `folderUri` shortly after the workbench
mounts — *before* the webvm‑host extension has finished activating
and registering its `FileSystemProvider` for the `webvm:` scheme. The
validator catches the `NoFileSystemProvider` (`ENOPRO`) error and
**logs it as a warning rather than crashing**, which is exactly the
right behaviour: the extension activates ~100 ms later (via
`onStartupFinished`), the provider registers, and the Explorer
populates with `hello_world.rs` + `Cargo.toml` correctly.

**Action**: none. Silencing this would require either:

(a) shipping the extension as a non‑lazy bootstrap (would slow boot,
    no user benefit), or
(b) patching `vscode-web` to suppress this specific warning (would
    break a future upgrade and goes against our policy of vendoring
    the upstream bundle unmodified).

The warning is a known VS Code Web behaviour and is also visible on
vscode.dev when extensions register file system providers from
`onStartupFinished`.

## 2. `An iframe which has both allow-scripts and allow-same-origin for its sandbox attribute can escape its sandboxing`

(*evidence/console-first-load.txt:11,17,18*)

Source: Chrome (`workbench.web.main.js` and the web worker extension
host iframe `webWorkerExtensionHostIframe.html`). Both iframes are
created by upstream `vscode-web` with `sandbox="allow-scripts allow-same-origin"`
to give the extension host access to its own origin. Chrome warns
that this combination "can escape its sandboxing" — the warning is
purely informational and applies to **any** consumer of `vscode-web`,
including vscode.dev itself.

**Action**: none. The sandbox attributes are determined upstream and
removing `allow-same-origin` would break extensions. The warning is a
constant on every load; we treat it as background noise.

## 3. `The web worker extension host is started in a same-origin iframe!`

(*evidence/console-first-load.txt:6*)

Source: `vscode-web/out/vs/workbench/workbench.web.main.js`. This is
an upstream design decision: when no dedicated `extensionHostWorker`
URL is provided, VS Code Web falls back to a same‑origin iframe for
the worker extension host. Same‑origin iframes are slightly less
isolated than `Worker` instances but remain functional. The message is
intentionally a **warning** to deployers who want the maximum
isolation level; we are aware of the trade‑off and accept it because
the alternative (separate origin for the extension host) requires
serving from two domains, which Pages can't do.

**Action**: none. Same‑origin extension host is the documented
fallback for static deployments.

## 4. `No search provider registered for scheme: webvm, waiting`

(*evidence/console-first-load.txt:25*)

Source: `vscode-web/out/vs/workbench/workbench.web.main.js`. The
"Search" view tries to register against every workspace folder's
scheme. We register a `FileSystemProvider` for `webvm:` (in
`web/extensions/webvm-host/extension.js`) but no `SearchProvider`. VS
Code Web logs an info‑level message and waits; if a search provider
later registers, the search view becomes available. If none does, the
search view shows "Search is not available for this workspace folder"
when the user opens it.

**Trade‑offs**:

* **Implement a no‑op search provider**: ~50 lines, returns empty
  results. Silences the message and gives the search view a friendly
  empty state instead of an error. Cost: every keystroke in the search
  box would still hit a no‑op handler, slightly slower than the native
  "no provider" path.
* **Implement a real search provider**: would need to ship a recursive
  walk of `webvm:` (which is currently page‑side IDB) and a content
  match. ~200 lines, useful but not in scope for issue #7.
* **Do nothing** (current state): one info message, search view shows
  "no provider" if opened. No user impact unless the user explicitly
  opens the search view.

**Action**: deferred to a follow‑up issue. The user impact of a search
view that shows "no provider" is small compared to the surface area
of implementing a search provider correctly. We document the trade‑off
here so a future contributor can pick it up.

## 5. `[ERROR] Access to fetch at '...rust-alpine.ext2' ... has been blocked by CORS policy`

(*evidence/console-first-load.txt:21,22*)

Source: Chrome's CORS preflight check on `cheerpx-bridge.js`'s
`probeUrl()` call. This is the **expected** failure mode documented in
`docs/case-studies/issue-3/analysis-disk-cors.md` — GitHub Releases
serves assets without `Access-Control-Allow-Origin`, so we probe
defensively, see the error, log a structured warning, and fall back
to the public WebVM Debian image:

```
[WARNING] [rust-web-box] warm disk ... is reachable but CORS-blocked
          (reason: cors-or-network); falling back to default disk.
```
(*evidence/console-first-load.txt:23*)

The error in the Chrome devtools is what Chrome **always** logs when
a fetch is CORS‑blocked; it is a Chrome quirk that the warning is
emitted at error severity even when the application code handles it
gracefully. We can't suppress it.

**Action**: none. The fallback already works; the noise is upstream
to us.

## 6. `Updating additional builtin extensions cache` / `Ignoring fetching additional builtin extensions from gallery as it is disabled`

(*evidence/console-first-load.txt:7,8,30,31,…*)

Source: `vscode-web`. Informational logs; the gallery is intentionally
disabled (we ship our extensions via `additionalBuiltinExtensions` so
no marketplace fetch is needed). Each extension activation triggers
one of these messages.

**Action**: none. They are informational and confirm the extension
manager is working as configured.

## Summary

After the issue‑#7 fix lands, the console for a successful boot will
show:

* the COOP/COEP reload happens once (one duplicate set of init logs),
* `crossOriginIsolated` flips to `true`,
* the CheerpX DataCloneError is gone,
* the rest of these warnings remain — they are upstream and harmless.

The case study acts as the source of truth so a future maintainer
seeing one of these messages doesn't waste time investigating it.
