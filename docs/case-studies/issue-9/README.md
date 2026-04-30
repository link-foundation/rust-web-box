# Issue 9 Case Study: Pages Boot Fails On Warm Disk

Date: 2026-04-30

Issue: <https://github.com/link-foundation/rust-web-box/issues/9>
Pull request: <https://github.com/link-foundation/rust-web-box/pull/10>

## Evidence

- Issue snapshot: `evidence/issue-9.json`
- Issue comments snapshot: `evidence/issue-9-comments.json`
- Initial PR snapshot: `evidence/pr-10-initial.json`
- Reporter console screenshot: `screenshots/issue-9-console-boot.png`
- Reporter terminal screenshot: `screenshots/issue-9-terminal-exit.png`
- After-fix local browser screenshot: `screenshots/after-fix-local.png`
- After-fix Playwright console log: `evidence/playwright-console-after.log`
- Upstream WebVM device-selection reference: `evidence/webvm-WebVM.svelte`
- Upstream WebVM chunked deployment reference: `evidence/webvm-deploy.yml`
- Online research notes: `online-research.md`

The screenshots were downloaded from the GitHub issue with authenticated
`curl -L`, then validated as PNG files before inspection. The after-fix
browser screenshot was captured from the local dev server after the
reported console failures were removed.

## Reported Symptoms

The GitHub Pages app loaded the VS Code shell, but the VM boot path did
not reach a useful Rust terminal. The browser console showed these
important failures:

- The warm disk fetch to the `disk-latest` GitHub Release asset was
  blocked by CORS after redirecting to GitHub's release asset host.
- The runtime logged a warm-disk fallback warning, then CheerpX
  initialization failed with `DataCloneError`.
- The rust-analyzer extension tried to fetch `rust-analyzer.wasm`, which
  was not bundled, adding a noisy 404 unrelated to the disk failure.
- Source-map 404s and VS Code debug-global warnings were present but
  were not root causes of the VM boot failure.

## Root Cause

The old deployment contract mixed two incompatible ideas:

1. CI uploaded `rust-alpine.ext2` as a GitHub Release asset because the
   full disk image is too large for normal Git tracking.
2. Browser runtime code tried to mount that release download URL
   directly.

That direct browser path is not reliable. The release URL is reachable
server-side, but the browser-visible redirect target is not CORS-readable
for CheerpX's JS/XHR disk reads. `COEP: credentialless` does not fix
this because CORS-mode requests still require the target server to opt
in with CORS headers.

The runtime also treated every selected disk URL as a CheerpX
`CloudDevice`, even though upstream WebVM chooses the device type based
on disk layout. A Pages-hosted split image should use
`CheerpX.GitHubDevice`; a plain HTTP ext2 should use
`CheerpX.HttpBytesDevice`; the hosted WebVM `wss://` disk should use
`CheerpX.CloudDevice`.

## Fix

The browser now mounts a same-origin, Pages-hosted disk layout when the
Pages build has staged the warm image:

- The committed `web/disk/manifest.json` keeps the release source in
  `warm.source_release_url` and leaves `warm.url` unset so local and
  failed-staging builds fall back cleanly.
- `web/build/stage-pages-disk.mjs` downloads the rolling release asset
  in CI, writes `rust-alpine.ext2.meta`, and splits the disk into
  `rust-alpine.ext2.c000000.txt` style chunks, then rewrites `warm.url`
  to `./disk/rust-alpine.ext2`.
- `.github/workflows/pages.yml` stages those chunks before uploading the
  Pages artifact.
- `.github/workflows/disk-image.yml` triggers a Pages redeploy after
  publishing a fresh `disk-latest` release asset.
- `web/glue/cheerpx-bridge.js` resolves a full disk config, probes
  GitHubDevice disks through `.meta`, and creates the correct CheerpX
  device type.
- `web/sw.js` and `web/build/dev-server.mjs` use
  `Cross-Origin-Embedder-Policy: require-corp` now that the warm disk is
  same-origin.
- `web/extensions/rust-analyzer-web` only probes a WASM payload when
  package metadata declares one.
- `web/disk/build.sh` shrinks the ext2 image after population so Pages
  staging does not turn sparse free space into real artifact bytes.

## Regression Tests

The fix adds coverage for the failure mode instead of only changing the
manifest:

- `web/tests/disk-cors.test.mjs` verifies same-origin warm disks are
  probed via `.meta` and that browser warm URLs are not GitHub Release
  redirects.
- `web/tests/disk-staging.test.mjs` verifies chunk names, `.meta`
  content, stale chunk cleanup, and manifest conversion.
- `web/tests/cheerpx-bridge.test.mjs` verifies device selection for
  `github`, `bytes`, and `cloud` disks.
- `web/tests/boot-shell.test.mjs` verifies the workflow wiring, COEP
  policy, disk manifest contract, build-image shrinking, and
  rust-analyzer WASM opt-in behavior.
- `web/tests/pages-parity.test.mjs` verifies the local server emits the
  same `COOP/COEP` headers expected from Pages.

Local browser verification on 2026-04-30 reached the VS Code workbench
and WebVM shell prompt with `crossOriginIsolated === true`,
`process.env` present, and zero console errors. The remaining two
warnings came from the upstream VS Code web worker iframe sandbox path,
not from disk loading, rust-analyzer WASM probing, or the textmate debug
global.

Current local check logs are saved under `evidence/` for the web tests,
Rust checks, workbench build, file-size check, and `git diff --check`.

## Follow-up Risks

- The first Pages deploy after this PR may still fall back to the public
  WebVM disk until `disk-image.yml` publishes a fresh `disk-latest`
  release and retriggers Pages.
- Pages has an overall published-site size limit, so future disk growth
  should be watched. The build now runs `resize2fs -M` to avoid shipping
  sparse free space as chunk files.
