# Online research and prior art

This file collects external sources that informed the analysis. Each
section names the source, summarizes its relevance, and links to the
original.

## A. VS Code Web extension hosting

* **Microsoft VS Code Web extension guide** —
  [code.visualstudio.com/api/extension-guides/web-extensions](https://code.visualstudio.com/api/extension-guides/web-extensions).
  Confirms `additionalBuiltinExtensions` accepts `UriComponents` and that
  `path` is a host‑absolute path, not page‑relative. Does **not** call out
  the gotcha for sub‑path deployments — this is the doc‑gap we will file
  upstream.
* **microsoft/vscode‑discussions #967 — Deploy vscode web with custom web extensions** —
  [github.com/microsoft/vscode-discussions/discussions/967](https://github.com/microsoft/vscode-discussions/discussions/967).
  Multiple deployers report the same shape of bug we hit (extensions
  resolve against the wrong base when the page lives at a sub‑path).
* **microsoft/vscode #192947 — Subpath support in Code serve‑web** —
  [github.com/microsoft/vscode/issues/192947](https://github.com/microsoft/vscode/issues/192947).
  Tracking issue for sub‑path serving in the official `code serve‑web`.
  Confirms that even Microsoft's own server doesn't handle every URL
  correctly under a `--server-base-path`.
* **microsoft/vscode #209601 — PWA app does not include base path** —
  [github.com/microsoft/vscode/issues/209601](https://github.com/microsoft/vscode/issues/209601).
  Same family of bugs: assets requested from `/x` instead of `/base/x`.
* **microsoft/vscode #145295 — Support extension packs in additionalBuiltinExtensions** —
  [github.com/microsoft/vscode/issues/145295](https://github.com/microsoft/vscode/issues/145295).
  Background on how the field is consumed.

**Takeaway**: this is a well‑known footgun and our fix mirrors the
pattern that vscode‑server users have to apply manually via
`--server-base-path`.

## B. CheerpX runtime + WebVM

* **CheerpX docs — Browser Deployment** —
  [cheerpx.io/docs](https://cheerpx.io/docs). Covers `CloudDevice.create`,
  `setCustomConsole`, and `Linux.create`. Does **not** document CORS
  requirements for custom disks; this is the doc‑gap we will file at
  `leaningtech/cheerpx`.
* **leaningtech/webvm reference** —
  [github.com/leaningtech/webvm](https://github.com/leaningtech/webvm).
  The canonical deployment that we model `glue/webvm-server.js` after.
  Hosts disks on `wss://disks.webvm.io` (their own origin → no CORS issue).
* **CheerpX 1.2 release notes** —
  [labs.leaningtech.com/blog/cheerpx-1.2](https://labs.leaningtech.com/blog/cheerpx-1.2).
  Documents the `setCustomConsole(writeFn, cols, rows)` signature we
  consume in `cheerpx-bridge.js:242`.

**Takeaway**: the WebVM reference deployment doesn't hit our CORS issue
because they self‑host the disk. We need either same‑origin hosting or a
CORS‑enabled mirror.

## C. Cross‑origin isolation on GitHub Pages

* **gzuidhof/coi-serviceworker** —
  [github.com/gzuidhof/coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)
  (MIT). The canonical workaround for static hosts that can't set
  COOP/COEP headers. Issue #2 in that repo discusses the
  `credentialless` upgrade path which is what we want for cross‑origin
  disk fetching.
* **web.dev — Cross‑Origin Isolation guide** —
  [web.dev/cross-origin-isolation-guide](https://web.dev/cross-origin-isolation-guide/).
  Confirms COOP `same-origin` + COEP `credentialless` is a recognized
  isolation pair.
* **Tom Ayac — "Setting the COOP and COEP headers on static hosting like GitHub Pages"** —
  [blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages](https://blog.tomayac.com/2025/03/08/setting-coop-coep-headers-on-static-hosting-like-github-pages/).
  End‑to‑end walkthrough of deploying SAB‑dependent apps to Pages using
  `coi-serviceworker`.
* **Wasmer docs — "Patching COOP & COEP headers for GitHub Pages Deployment"** —
  [docs.wasmer.io/sdk/wasmer-js/how-to/coop-coep-headers](https://docs.wasmer.io/sdk/wasmer-js/how-to/coop-coep-headers).
  Wasmer ship the same workaround for the same reason.
* **GitHub Community Discussion #13309 — Allow setting COOP and COEP headers in GitHub Pages** —
  [github.com/orgs/community/discussions/13309](https://github.com/orgs/community/discussions/13309).
  Multi‑year request for native header support. Still open as of writing.
* **whatwg/html #7745 — Should service workers be able to "emulate" COEP: credentialless on the document?** —
  [github.com/whatwg/html/issues/7745](https://github.com/whatwg/html/issues/7745).
  Spec‑level discussion confirming the SW workaround is the only
  available mechanism today.
* **jupyterlite/jupyterlite #1409 — Document the use of SharedArrayBuffer on GitHub Pages** —
  [github.com/jupyterlite/jupyterlite/issues/1409](https://github.com/jupyterlite/jupyterlite/issues/1409).
  JupyterLite hit the same problem and adopted `coi-serviceworker`.

**Takeaway**: there is no native fix on GitHub Pages today. The COI SW
workaround is what every WASM‑threading project on Pages uses.

## D. CORS on GitHub Releases assets

* **objects.githubusercontent.com / release-assets.githubusercontent.com**:
  empirically, neither sets `Access-Control-Allow-Origin`. Verified via
  `curl -sI -L`. There is no GitHub‑side flag to opt in.
* **Workarounds**:
  * Cloudflare Worker proxy with CORS headers added.
  * Cloudflare R2 / S3 bucket with public CORS.
  * Same‑origin mirror (Pages itself, with a smaller asset).

## E. WebContainers (StackBlitz) for comparison

* **WebContainers — Configuring Headers** —
  [webcontainers.io/guides/configuring-headers](https://webcontainers.io/guides/configuring-headers).
  Documents the hard requirement that the document must be cross‑origin
  isolated. Their own demos work on Pages because they ship the COI SW.
* **WebContainers vs. CheerpX comparison** — WebContainers run a WASM
  Node.js fork (no x86 binaries, no Linux syscalls). CheerpX runs an
  unmodified x86 Linux. Different tools, same hosting constraints.

## F. Similar projects we can learn from

* **wasmer.sh** — Web shell hosting Bash + Python via Wasmer. Uses
  `coi-serviceworker` and ships disks on a Cloudflare‑backed CDN.
* **container2wasm playground** —
  [github.com/ktock/container2wasm](https://github.com/ktock/container2wasm).
  Bakes container images into WASM blobs; same CORS constraints, solved
  by hosting on an asset CDN with CORS headers.
* **stackblitz.com / nodebox** — Same constraints, native solution
  (StackBlitz controls the headers on their hosting).

## G. Existing libraries we already use or could adopt

| Library                       | What it gives us                                                                            | License | Status      |
| ----------------------------- | ------------------------------------------------------------------------------------------- | ------- | ----------- |
| `vscode-web@1.91.1`           | VS Code Web bundle (vendored).                                                              | MIT     | adopted     |
| CheerpX 1.2.11                | x86 → WASM runtime (vendored).                                                              | LT EULA | adopted     |
| `coi-serviceworker`           | Synthesizes COOP/COEP headers on Pages.                                                     | MIT     | **to adopt** |
| `xterm.js`                    | Terminal renderer; already pulled in by `vscode-web`.                                       | MIT     | adopted     |
| `comlink`                     | Could simplify the BroadcastChannel bus.                                                    | Apache 2.0 | optional |

**Takeaway**: the only new dependency this case study recommends is
`coi-serviceworker`, and it's a single 5 KB file we can vendor as
`web/coi-serviceworker.js` (the project explicitly forbids CDN loading
because the SW must be served from the same origin).

## H. Why PR #2's screenshots looked correct

PR #2 was developed against `python -m http.server` rooted at
`web/`, where the document is at `/index.html` and `/extensions/...`
resolves to the deployed extension. None of the three root causes
manifest in that environment:

1. Extension paths resolve correctly (no sub‑path).
2. Disk fetch goes to `wss://disks.webvm.io` (the warm Alpine release
   wasn't even built yet at PR‑time, so the fallback was always used —
   masking the CORS issue).
3. Localhost is exempt from many cross‑origin restrictions.

This is a textbook example of "works on my machine" caused by
deployment‑topology drift between dev and prod.
