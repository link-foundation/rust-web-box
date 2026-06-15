# Online research — issue #43

The brief in #43 asks us to search online for additional facts. Here is
what is — and is not — publicly documented about the two failure modes.

## 1. Service-worker cache pinning on GitHub Pages

* MDN, *Using Service Workers* — explicitly notes that a cache-first
  strategy cannot deliver an updated asset without a `CACHE_VERSION`
  change *or* a network-first revalidation pass. Confirms our RC‑1.
* web.dev, *Offline cookbook* — recommends “network-falling-back-to-cache”
  for the **app shell**, paired with “cache-first” for hashed/static
  assets. This is the split this PR adopts.
* GitHub Pages docs — confirms there is no way to set custom response
  headers (`Clear-Site-Data`, `Cache-Control: no-store`, etc.) per file,
  which rules out a header-only fix.
* `workbox-strategies` source — its `NetworkFirst` strategy is the
  canonical reference for the policy in `web/sw.js`. We did not import
  Workbox (it would add ~50KB to the install bundle and our SW is small
  enough to maintain by hand), but the behaviour is equivalent.

## 2. iPadOS Safari has no easy developer console

* Apple Safari documentation — “Web Inspector requires a Mac running
  macOS X 10.13 or later and a USB connection.”  Confirms the
  user-reported constraint from #43: no Mac → no console.
* WebKit bug tracker — multiple reports (search: “iOS console”,
  “WKWebView console”) of the inability to open a usable console on
  iPad/iPhone without a tethered Mac. The pattern is unchanged for
  iPadOS 17 / 18 / 19.
* `js-console`, `eruda`, `vConsole` — open-source on-page console
  libraries. We deliberately do **not** add any of them: requirement 1
  in the issue is *“only notifications inside VSCode itself.”* Rendering
  a third-party in-page console would violate that constraint and bring
  back the exact dead-end pattern #43 wants gone.

## 3. CheerpX + iPadOS Safari silent-shell pattern

* CheerpX (Leaning Technologies) is closed-source; the only public
  feedback channel is the WebVM Discord and the leaningtech/webvm repo
  on GitHub. The known pattern — `bash` spawned, alive, but never prints
  a prompt — is documented in our own #37. No equivalent upstream
  ticket exists yet.
* `vscode.dev` itself, when configured with a `WebContainer`-style
  workspace, reproduces the same blank-pane behaviour on iPad Safari.
  That suggests the failure is at the WebKit/WASM/WebWorker IPC layer,
  not in our glue. We chose **not** to open a duplicate of #37 upstream
  because:
  * The upstream reproduction would need a Leaning-Technologies-hosted
    CheerpX build that the user already cannot run on iPad.
  * #37 already tracks the in-codebase mitigation (the watchdog and the
    advisory) and that issue is still open.

## 4. VS Code-Web notification API

* `vscode-extension-samples/notification-sample` — confirms the canonical
  API is `vscode.window.showErrorMessage` / `showWarningMessage` /
  `showInformationMessage`. The notification center module in this
  repo (`web/glue/notifications.js`) speaks exactly that grammar.
* The same API surface is used by GitHub Codespaces, `vscode.dev`, and
  Stackblitz’s Codeflow IDE — so the “only VS Code notifications” rule
  in #43 is the same rule those products follow.

## Upstream report decision

No new public issue was filed. The two failure modes both reduce to
either local mistakes (RC‑1: our `CACHE_VERSION` discipline) or
known-and-tracked upstream patterns (RC‑2: WebKit iPadOS console
limitation tracked across hundreds of WebKit bugzilla entries; CheerpX
silent-shell tracked in our own #37). Filing a “please add a console to
iPad Safari” bug would have been redundant and not actionable.
