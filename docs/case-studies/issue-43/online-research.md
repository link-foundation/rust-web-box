# Online research — issue #43

The brief in #43 asks us to search online for additional facts. Here is
what is — and is not — publicly documented about the two failure modes.

## 1. Service-worker cache pinning on GitHub Pages

* Chrome Developers, *Strategies for service worker caching*
  (<https://developer.chrome.com/docs/workbox/caching-strategies-overview>)
  — describes caching as a fetch-event strategy and explicitly calls out
  that different request classes should use different strategies.
* web.dev, *Offline cookbook*
  (<https://web.dev/articles/offline-cookbook>) — documents
  "network falling back to cache" and cache-first patterns and recommends
  composing strategies by URL/context. This is the split this PR adopts.
* web.dev, *Service worker caching and HTTP caching*
  (<https://web.dev/articles/service-worker-caching-and-http-caching>) —
  shows the cache-first pattern and the fact that service workers
  intercept HTTP requests before the network cache decision reaches the
  page. Confirms our RC‑1.
* GitHub Pages docs — confirms there is no way to set custom response
  headers (`Clear-Site-Data`, `Cache-Control: no-store`, etc.) per file,
  which rules out a header-only fix.
* `workbox-strategies` source — its `NetworkFirst` strategy is the
  canonical reference for the policy in `web/sw.js`. We did not import
  Workbox (it would add ~50KB to the install bundle and our SW is small
  enough to maintain by hand), but the behaviour is equivalent.

## 2. iPadOS Safari has no easy developer console

* Apple Developer Documentation, *Inspecting iOS and iPadOS*
  (<https://developer.apple.com/documentation/safari-developer-tools/inspecting-ios>)
  — documents inspection of iOS/iPadOS webpages from a connected Mac.
  Confirms the user-reported constraint from #43: without a nearby Mac,
  the browser console is not a practical support surface.
* Apple Developer Documentation, *Web Inspector*
  (<https://developer.apple.com/documentation/safari-developer-tools/web-inspector>)
  — identifies Web Inspector as the Safari tool for inspecting webpages,
  service workers, and JavaScript activity.
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

* VS Code Extension API, *Common Capabilities*
  (<https://code.visualstudio.com/api/extension-capabilities/common-capabilities>)
  — documents the native notification methods
  `window.showInformationMessage`, `window.showWarningMessage`, and
  `window.showErrorMessage`. The notification center module in this repo
  (`web/glue/notifications.js`) speaks exactly that grammar.
* VS Code UX Guidelines, *Notifications*
  (<https://code.visualstudio.com/api/ux-guidelines/notifications>) —
  describes VS Code notifications as information, warning, and error
  messages surfaced by the workbench. That matches requirement #43's
  "only notifications inside VSCode itself" constraint.
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
