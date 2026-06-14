# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- changelog-insert-here -->

















## [0.17.0] - 2026-06-14

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

### Fixed
- Make release scripts resolve the publishable crate manifest when the repository root uses a Cargo workspace manifest.

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.

### Added
- Full MVP wiring for the in-browser Rust sandbox (issue #1):
  - `web/glue/cheerpx-bridge.js`: loads CheerpX (vendored, CDN fallback),
    boots a Linux VM against the public WebVM Debian image with an
    IndexedDB overlay for persistence.
  - `web/glue/webvm-bus.js`: request/response + event protocol over
    BroadcastChannel that connects the page (where CheerpX lives) to
    extension-host workers.
  - `web/glue/webvm-server.js`: page-side server that exposes the VM's
    file system and a process registry over the bus.
  - `web/extensions/webvm-host/`: VS Code Web extension implementing the
    `webvm:` `FileSystemProvider`, a `Pseudoterminal` over CheerpX bash,
    cargo task provider (`build`, `run`, `test`, `add`, `new`), and a
    status-bar Run button.
  - `web/extensions/rust-analyzer-web/`: VS Code Web extension stub that
    loads the rust-analyzer WASM artifact when bundled and contributes
    Rust language configuration plus lightweight diagnostics.
  - `web/build/build-workbench.mjs`: build step that vendors
    `vscode-web@1.91.1` + CheerpX 1.2.8 and renders `web/index.html`
    with workbench config that preinstalls our extensions.
  - `web/build/index.template.html`: workbench entry template.
  - `web/tests/webvm-bus.test.mjs`, `web/tests/cheerpx-bridge.test.mjs`:
    additional unit tests; total `node --test` count is now 26.
  - Service worker now caches glue assets and synthesizes COOP/COEP +
    CORP headers on same-origin assets.
  - `.github/workflows/pages.yml` runs the build step before uploading
    the Pages artifact.

### Changed
- `web/index.html` is now the workbench entry document. It renders a
  boot overlay with a five-step status (shell, shim, CheerpX, VM, VS
  Code) that resolves once the workbench mounts, then fades out.

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.

### Added
- JS-side workspace store (`web/glue/workspace-fs.js`) backed by
  IndexedDB. The `webvm:` `FileSystemProvider` now reads/writes from
  this store so the Explorer populates immediately on page load — the
  user sees `hello_world.rs`, `hello/Cargo.toml`, `hello/src/main.rs`,
  and `README.md` the moment VS Code mounts, instead of waiting 30+
  seconds for CheerpX to finish booting (issue #2 screenshot feedback).
- Two-stage bus: a workspace-only methods table serves `fs.*` requests
  while CheerpX is still loading; once the VM finishes booting, the
  bus hot-swaps to the full table that adds `proc.*` (terminal) and
  `cargo.*` support. Implemented via `setMethods` on the bus server so
  the swap happens without registering a duplicate message listener
  (which would double-respond to every request).
- `webvm-server.js` now mirrors the JS-side workspace into the guest's
  `/workspace/` directory using `cat <<EOF` heredocs sent to the
  persistent bash session. After priming, the terminal lands at
  `/workspace` and runs `ls -la` so the populated directory is visible
  immediately — exactly the "ls where hello_world.rs is visible"
  feedback from the user.
- Auto-open `hello_world.rs` on extension activation. The webvm-host
  extension's `activate()` now calls `vscode.window.showTextDocument`
  on `webvm:/workspace/hello_world.rs`, falling back to
  `hello/src/main.rs` and `README.md` if the user has deleted earlier
  files (their edits persist in IndexedDB across sessions).
- `disk-image.yml` workflow now auto-publishes `rust-alpine.ext2` to
  the `disk-latest` rolling release tag on every push to main. The
  `web/disk/manifest.json` warm URL points to that release, so the
  Pages site picks up the freshest Alpine + Rust image without manual
  intervention.

### Changed
- `web/disk/manifest.json` warm URL now resolves to
  `https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2`
  (was `null`).
- `cheerpx-bridge.js`'s `bootLinux()` now falls back to the public
  WebVM Debian image if the warm `CloudDevice.create()` call fails —
  this keeps the workbench coming up cleanly during the brief window
  between merging this PR and the disk-image workflow finishing on
  main. The disk URL probe also uses `mode: 'no-cors'` to keep CORS
  errors out of the devtools console while we're falling back.
- Terminal banner is now a single clean status pane: "Booting Linux
  VM…" → VM-stage updates → "Linux VM ready ✓" → "Workspace mirrored
  to /workspace — try `cargo run` in /workspace/hello", followed by
  the actual `ls -la /workspace` output. The previous flow echoed raw
  `cd` commands and surfaced `mesg: ttyname failed` noise from
  /etc/profile.d scripts.

### Fixed
- Explorer no longer shows an empty `workspace` with a warning icon
  while CheerpX is booting; the JS-side store always serves `fs.stat`
  / `fs.readDir` synchronously off IndexedDB.
- Issue #2 screenshot feedback ("no hello_world.rs in file browser, it
  should be as in user's home folder"): hello_world.rs is now visible
  AND pre-opened on first paint.
- Issue #2 screenshot feedback ("terminal shows lots of errors"): the
  prime script disables echo while heredocs stream, then `clear`s and
  runs `ls -la /workspace` so the user lands in a clean terminal with
  the populated directory listing.

### Fixed
- Terminal staircase indentation in the WebVM bash pane (issue #2 boot
  screenshot feedback). Bash inside CheerpX writes through
  `cx.setCustomConsole`, which is not a kernel TTY: there is no ONLCR
  mapping, so each newline arrives as a bare `\n`. VS Code's
  Pseudoterminal API (xterm.js underneath) requires `\r\n` — without the
  carriage return the cursor only moved down, not back to column 0,
  producing the visible staircase in the previous boot screenshots.
  `web/glue/webvm-server.js` now runs every stdout chunk through
  `createLfToCrlfNormaliser()` from `web/glue/terminal-stream.js` before
  broadcasting `proc.stdout`. The normaliser is stateful so a chunk
  boundary that splits an existing `\r\n` (CheerpX delivers `foo\r` in
  one chunk, `\nbar` in the next) does not produce `\r\r\n`. Existing
  CRLF passes through unchanged; bare `\r` (cargo's progress meter) is
  preserved.

### Added
- `web/glue/terminal-stream.js` with `createLfToCrlfNormaliser()` and
  the one-shot `lfToCrlf()` convenience used by the page-side WebVM
  server.
- `web/tests/terminal-stream.test.mjs` — eight unit tests covering
  every newline shape (lone LF, CRLF, bare CR, ANSI control sequences,
  empty input, the exact `ls -la /workspace` repro from the screenshot,
  and chunk boundaries split mid-CRLF).
- `web/tests/webvm-server.test.mjs` — four integration tests with a
  fake CheerpX handle, asserting that stdout written by the engine is
  normalised on the wire, vt != 1 channels are still filtered, and the
  in-memory bus transport stays sane.

### Changed
- `web/glue/webvm-server.js` now uses a streaming `TextDecoder`
  (`stream: true`) for stdout, so multi-byte UTF-8 split across CheerpX
  writes no longer decodes to U+FFFD before reaching the terminal.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).

### Fixed
- Fixed GitHub Pages warm-disk boot failures by staging the release-hosted Rust ext2 image into same-origin CheerpX GitHubDevice chunks and selecting the correct CheerpX block device at runtime.

### Fixed
- Kept WebVM workspace priming and editor-save mirroring out of the
  visible terminal by staging temporary CheerpX `/data` scripts instead
  of typing setup heredocs into the interactive bash session.

### Documentation
- Replaced the issue #11 case-study placeholder with terminal-noise
  evidence, root-cause analysis, online research, and verification logs.

# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.

### Fixed
- The deployed GitHub Pages workbench could not run `tree` or `cargo run`
  inside the in-browser terminal (issue #15). The CheerpX 1.2.11 runtime
  the project shipped emitted `TypeError: Cannot read properties of
  undefined (reading 'a1')` four times during Linux boot and failed
  `cx.run` with `CheerpException: Program exited with code 71`. Bumped
  the vendored runtime to **CheerpX 1.3.0** in `web/build/build-workbench.mjs`,
  `web/glue/cheerpx-bridge.js` (runtime version constant), and
  `web/sw.js` (cache key) — Linux now reaches `vmPhase: 'ready'` and
  `cx.run` returns `status: 0` for `tree --version` and the prebuilt
  `/workspace/target/release/hello` binary.
- `web/build/dev-server.mjs` now redirects `/rust-web-box` → `/rust-web-box/`
  when serving with a base prefix. Mirrors GitHub Pages canonicalisation
  so the same URL shape resolves the same way locally and on Pages.
- `globalThis.__rustWebBox.vmPhase` now reaches `'ready'`. Previously
  `boot.js` only forwarded phases out of `cheerpx-bridge`'s `onProgress`
  hook, which stops at `'starting Linux'`. The terminal `'ready'` phase
  is emitted from inside `web/glue/webvm-server.js` and was only ever
  visible on the BroadcastChannel — never on the page-level shim. The
  e2e harness keys `vmPhase === 'ready'` on that shim, so without this
  fix the local-e2e CI job would deadlock and time out at 180s waiting
  for a transition that could never happen. `startWebVMServer` now
  accepts an `onPhase` callback and `boot.js` threads it through a
  single `setPhase` helper that's the only thing that mutates `vmPhase`.

### Added
- `web/tests/helpers/cheerpx-page-harness.mjs` — reusable browser
  harness around [`browser-commander`](https://github.com/link-foundation/browser-commander).
  Wraps Chromium launch, COOP/COEP-aware dev-server boot, stage-1 shim
  wait, stage-2 Linux wait, and `cx.run` invocation. On either-stage
  timeout the thrown error is enriched with an in-page snapshot
  (`vmPhase`, has-vm/workspace/shim flags, recorded `vm.boot` history),
  the last 30 console messages, captured `console.error`/`pageerror`
  output, and the list of failed network requests — so a CI failure
  surfaces the *cause* of the stall rather than just `Timeout Xms
  exceeded`.
- `web/tests/e2e/local-pages-e2e.test.mjs` — local end-to-end suite that
  drives the freshly built `web/` artifact. Asserts CheerpX 1.3.0 runs
  `tree --version`, lists `/workspace`, and executes the prebuilt hello
  binary without leaking `CheerpException` into `console.error`.
- `web/tests/e2e/live-pages-e2e.test.mjs` — post-deploy end-to-end suite
  that drives `RUST_WEB_BOX_LIVE_URL`. Same assertions, against the URL
  GitHub Pages just published.
- `web/tests/package.json` + lockfile — pin `browser-commander` and
  `playwright` versions for the e2e harness.
- `.github/workflows/pages.yml` gains a `local-e2e` job (PRs + main, runs
  before deploy) and an `e2e` job (post-deploy, drives the live URL).
  The `build` job now stages the warm rust-alpine disk on PRs as well,
  with `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release
  asset.
- `docs/case-studies/issue-15/` — full case study with timeline,
  evidence (Playwright console logs + screenshots + per-step `cx.run`
  output), upstream-issue tracking, and the verification plan.

### Fixed
- Reduced default rust-web-box console noise with exact VS Code Web startup filtering, lazy namespaced debug logging, source-map stub generation, and a polished WebVM boot banner.
- Removed the duplicate default workspace task seed that still pointed at the old `/workspace/hello` project path.

### Fixed
- Kept the VS Code web workspace and WebVM `/workspace` in sync for editor saves, guest terminal edits, and file tree refreshes.
- Restored explicit manual-save behavior in the seeded workspace so unsaved editor changes show the normal dirty state before Ctrl+S.

### Fixed
- Show WebVM `target/` build artifacts in the VS Code Explorer by syncing skipped target file metadata instead of pruning the directory.

### Fixed
- Stopped duplicating typed characters in the WebVM terminal: `makePseudoterminal` and `makeCargoPty` now dispose the prior `proc.stdout`/`proc.exit` bus subscribers before re-binding when VS Code re-`open()`-s the pty (issue #27).
- Restored prompt-time sync performance and unblocked `cargo run` reacting to editor saves: the bash sync hook prunes `/workspace/target` again while still emitting a single `D` frame for the directory itself so the VS Code Explorer keeps showing it (issue #27).
- Prevented the deletion sweep from wiping cached `target/` metadata stubs when the prompt-time scan intentionally skips them (issue #27).
- Avoided double-installation of the `__rwb_sync_from_guest` `PROMPT_COMMAND` if `/root/.bash_profile` is re-sourced.
- Guarded auto-creation of the "WebVM bash" terminal so a re-`activate()` does not spawn a duplicate panel.

### Added
- Opt-in `globalThis.__RWB_DEBUG_TERMINAL_STREAM` trace at both the bus emitter (`web/glue/webvm-server.js`) and the pty subscriber (`web/extensions/webvm-host/extension.js`) for fast attribution of any future duplicate-output regression.
- `web/tests/extension-pty-listeners.test.mjs`: source-shape regression tests asserting every `bus.on('proc.stdout', …)` site is paired with a prior `detachBusListeners()` call.
- `web/tests/e2e/local-pages-e2e.test.mjs`: new e2e test that drives the bus directly, types a sentinel via `proc.write`, and asserts the marker appears exactly twice in `proc.stdout` (one bash echo + one program output) — strictly less than the doubled stream the bug produced.
- `docs/case-studies/issue-27/`: full case study with timeline, root causes, evidence, online research, and verification.

### Fixed
- Refreshed `target/` metadata from the WebVM on demand when VS Code reads target directories, so Cargo build artifacts can be expanded in the Explorer without scanning the full build tree after every prompt.
- Saved dirty VS Code editor buffers before forwarding terminal Enter or Cargo task commands, so the next real `cargo run` uses the latest editor content.
- Marked saved Rust/Cargo inputs newer than existing target artifacts, with a fingerprint invalidation fallback, so warm-disk Cargo runs rebuild after browser-side edits.

### Added
- Regression coverage for scoped target snapshots, on-demand target directory refreshes, and edited-source `cargo run` e2e verification.

## Fixed

- Kept repeated plain `cargo run` real after editing `src/main.rs` by pre-baking the warm disk with a lean dev profile and applying matching Cargo profile environment only when the guest disk advertises that profile.
- Tightened browser e2e coverage so fixed disks must complete the edited second `cargo run` and print the edited output instead of accepting a compile-path timeout.
- Preserved writable filesystem headroom in the minimized warm disk so edited rebuilds have space for fresh debug artifacts.
- Kept the disk-image smoke test's edited rebuild isolated to a disposable image copy so staged Pages chunks still contain the default sample project.
- Forced Cargo freshness after browser saves by aging existing target metadata instead of relying on CheerpX's guest clock or deleting fingerprint files.

## Changed

- The disk-image workflow now smoke-tests an edited `cargo run`, stages the freshly built disk chunks locally, and runs browser e2e against that exact disk before publishing it.

### Fixed

- Confirmed the in-browser build is real (a genuine `rustc`/`cargo` invocation inside the CheerpX x86 Linux VM, not a faked transcript) and documented the proof in `docs/case-studies/issue-33/`.
- Removed the injected per-command branding (`This binary was compiled inside CheerpX.` / `Compiled by Rust inside the browser via CheerpX.`) that made a real build look faked, and made the prebuilt disk binary and the editable workspace seed byte-for-byte identical to the canonical `cargo new` program so the first run matches every later run.
- Migrated existing browser workspaces that still hold the untouched branded seed to the plain `cargo new` program on next open, while preserving any user edits.

### Changed

- The disk-image smoke test and workspace/boot unit tests now assert the plain `Hello, world!` greeting and the absence of the removed branding.
- Browser e2e Stage C/D assert the greeting printed by `cargo run` equals the literal in the source on disk (a stronger anti-fake check) on disks built from current source, while staying version-independent against the still-published warm disk.

### Fixed

- Brave users no longer see `WebAssembly.Module(): expected 1 elements on the stack for fallthru` plus `Uncaught TypeError: e is not a function` when a transient GitHub Pages 503 hits a warm-disk chunk. The page now retries 5xx/408/429 and network errors on `.c{6-hex}.txt` chunk fetches with capped exponential backoff and full jitter before CheerpX sees the bytes, so a single bad chunk no longer poisons the JIT (issue #35).
- The boot toast no longer prints `Linux VM failed to boot: undefined` when a CheerpX worker rejects with an opaque error; failures are categorised (disk-503 / wasm-compile / worker-missing-export / network-blocked) and rendered with browser-aware hints (e.g. the Brave V8-JIT workaround for upstream brave-browser#36187).

### Added

- `__rustWebBox.diskDiag.attempts` records the last 50 warm-disk chunk fetch attempts; `__rustWebBox.diagnostics.events` records boot-time `unhandledrejection`/`error` events with their categorisation. Both are intended for the e2e harness and post-mortem inspection.
- Case study at `docs/case-studies/issue-35/` (timeline, root causes RC1–RC5, options table, online research, upstream CheerpX issue draft).

### Fixed
- Apply the dark theme by default (`workbench.colorTheme: "Default Dark Modern"`), matching vscode.dev. The workbench previously had no theme default and fell back to the OS `prefers-color-scheme`, rendering Light Modern (issue #37).
- Fix UI controls being clipped/misaligned on iPad Safari (and any browser with a classic scrollbar): pin the workbench with `position: fixed; inset: 0` instead of `width: 100vw; height: 100vh`, which on Safari resolves wider/taller than the visible viewport and gets cropped by `overflow: hidden` (issue #37).
- Remove the global `* { box-sizing: border-box }` reset from the VS Code workbench surface and scope it to the boot toast only; the reset shrank VS Code's fixed-width action buttons and tree expanders, causing the small-button/hover/expander offsets called out in PR review (issue #37).
- Add `viewport-fit=cover` and `env(safe-area-inset-*)` offsets so the workbench paints edge-to-edge and the boot toast clears the iPad notch/home-indicator.
- iPad-Safari terminal: root-caused the "terminal does not work" symptom to the CheerpX `OverlayDevice 'a1'` fresh-inode wedge (the same upstream bug as issues #15/#17, now triggered by interactive `bash --login` allocating a fresh `~/.bash_history` inode). Set `HISTFILE=/dev/null` everywhere bash starts so it no longer allocates that inode, reducing the wedge rate (issue #37).

### Changed
- Bump the vendored CheerpX runtime from 1.3.0 to the latest **1.3.3** across all code, vendored assets, the service-worker cache key, tests, and docs (issue #37, requirement R4). The 1.3.1–1.3.3 changelog contains no `OverlayDevice` fix, so the wedge mitigations remain in place.

### Added
- Interactive-shell **first-output watchdog**: when `bash` spawns but produces no output within the window, `runShellLoop` writes a visible, actionable advisory directly into the terminal (naming the upstream bug and the reload/Chromium workarounds) instead of leaving the iPad-Safari user staring at a blank pane, and records `silentSpawns`/`slowFirstOutput` diagnostics (issue #37).
- Interactive-shell health diagnostics: `runShellLoop` records spawn/exit/error/fast-cycle counts plus output-byte timing into the server runtime, surfaces a toast when the shell repeatedly fails to start, and exposes the data via `__rustWebBox.dump()`.
- Apple-platform detection in `browser-info` (`isSafari`/`isIOS`/`isIPad`, using `maxTouchPoints` since iPadOS Safari reports as "Macintosh"), reported in `dumpRuntime()` for actionable bug reports.
- Filed the CheerpX `OverlayDevice 'a1'` wedge upstream as [leaningtech/webvm#222](https://github.com/leaningtech/webvm/issues/222) — the single canonical report covering all three triggers (workspace prime, `cargo run`, interactive bash), with a reproducer, the shipped workarounds, and a fix suggestion (issue #37).
- Case study `docs/case-studies/issue-37/` with timeline, requirements checklist, root-cause analysis, online research, before/after iPad screenshots, e2e geometry coverage, and the upstream report.

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

### Added

- Opt-in in-VM performance tracing (issue #41): `vm.benchCargo` runs the user's **real** `cargo run` / `cargo build` / `cargo check` inside the guest across four phases (no-op run, one-line-edit run, edit build, edit check) plus an optional `rustc -Z time-passes` split, and ships per-phase wall-clock back over the existing OSC-frame stdout channel; `globalThis.__RWB_DEBUG_VM_TIMING` records per-`cx.run` wall-clock. Both are zero-overhead when off and reuse the real `cx.run` path, so the bottleneck can be measured in the browser on the real VM.
- A `cargo check` fast-feedback path: the warm disk pre-bakes `cargo check` and the seeded `.vscode/tasks.json` offers a `cargo check (fast)` task. `cargo check` skips codegen and linking, so it surfaces compile errors in seconds — it speeds up the edit→error loop, not `cargo run` itself.
- A measurement-driven performance case study in `docs/case-studies/issue-41/`, backed by a reproducible docker rig in `experiments/issue-41/`: native i386 syscall/linker measurements, the front-end/codegen/link time split, an anti-fake verification that commands run on the real VM, the decisive in-VM e2e A/B, and a ranked catalogue of every improvement option — including the `lld` linker swap that looked like the fix on native syscall counts but regressed the real VM and was reverted (see below).
- Two **on-demand-only** (`workflow_dispatch`) CI workflows so benchmarks never run on a local machine: `.github/workflows/perf-bench.yml` runs the native i386 measurement rig and the **real** in-VM `cargo` benchmark (with a read-only `mount`/`df`/`nproc` storage+CPU probe), and `.github/workflows/ui-e2e.yml` runs a full UI-driven end-to-end test. Both publish a Markdown job summary and upload artifacts under `docs/case-studies/issue-41/data/`.
- `web/tests/e2e/ui-driven-e2e.test.mjs` — a UI-driven e2e that drives the **real** VS Code Web UI in order: `cargo run` typed into the integrated terminal (assert the seed greeting) → edit `src/main.rs` in the Monaco editor with a unique per-run marker (real Ctrl+S `FileSystemProvider` save) → `cargo run` again (assert the **new** marker *and* `Compiling`). The brand-new marker + `Compiling` are the anti-fake gate: a cached or pre-baked binary cannot print a marker that did not exist until this run.

### Changed

- The disk-image smoke test and end-to-end test now verify the `cargo check` pre-bake and run `cargo check` on the edited source; the e2e additionally times a **real** edited `cargo run` in the booted CheerpX VM (180 s ceiling) so a rebuild regression fails CI. Existing untouched workspaces are migrated to the `tasks.json` that includes the `cargo check (fast)` task.

### Investigated, not shipped

- **Linking with `lld` instead of GNU `ld` was tried and reverted (issue #41).** On the i386 Alpine toolchain the disk ships, a one-line-edit rebuild issues ~85 % fewer filesystem syscalls with `lld` (≈14,700 → ≈2,150), which looked like the fix for the slow `cargo run`. But the project's own in-VM e2e proved the opposite: with `lld` the real edited `cargo run` went from ~58 s to a >180 s timeout, because CheerpX must x86→WASM-JIT the much larger LLVM linker on first use and that cold-JIT cost dwarfs the syscall saving. Native syscall count was the wrong proxy for in-VM wall-clock. The disk keeps GNU `ld`; the load-bearing speedup remains the lean dev profile + warm pre-bakes (issues #17/#31). Full evidence in `docs/case-studies/issue-41/`.

## [0.16.0] - 2026-06-10

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

### Fixed
- Make release scripts resolve the publishable crate manifest when the repository root uses a Cargo workspace manifest.

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.

### Added
- Full MVP wiring for the in-browser Rust sandbox (issue #1):
  - `web/glue/cheerpx-bridge.js`: loads CheerpX (vendored, CDN fallback),
    boots a Linux VM against the public WebVM Debian image with an
    IndexedDB overlay for persistence.
  - `web/glue/webvm-bus.js`: request/response + event protocol over
    BroadcastChannel that connects the page (where CheerpX lives) to
    extension-host workers.
  - `web/glue/webvm-server.js`: page-side server that exposes the VM's
    file system and a process registry over the bus.
  - `web/extensions/webvm-host/`: VS Code Web extension implementing the
    `webvm:` `FileSystemProvider`, a `Pseudoterminal` over CheerpX bash,
    cargo task provider (`build`, `run`, `test`, `add`, `new`), and a
    status-bar Run button.
  - `web/extensions/rust-analyzer-web/`: VS Code Web extension stub that
    loads the rust-analyzer WASM artifact when bundled and contributes
    Rust language configuration plus lightweight diagnostics.
  - `web/build/build-workbench.mjs`: build step that vendors
    `vscode-web@1.91.1` + CheerpX 1.2.8 and renders `web/index.html`
    with workbench config that preinstalls our extensions.
  - `web/build/index.template.html`: workbench entry template.
  - `web/tests/webvm-bus.test.mjs`, `web/tests/cheerpx-bridge.test.mjs`:
    additional unit tests; total `node --test` count is now 26.
  - Service worker now caches glue assets and synthesizes COOP/COEP +
    CORP headers on same-origin assets.
  - `.github/workflows/pages.yml` runs the build step before uploading
    the Pages artifact.

### Changed
- `web/index.html` is now the workbench entry document. It renders a
  boot overlay with a five-step status (shell, shim, CheerpX, VM, VS
  Code) that resolves once the workbench mounts, then fades out.

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.

### Added
- JS-side workspace store (`web/glue/workspace-fs.js`) backed by
  IndexedDB. The `webvm:` `FileSystemProvider` now reads/writes from
  this store so the Explorer populates immediately on page load — the
  user sees `hello_world.rs`, `hello/Cargo.toml`, `hello/src/main.rs`,
  and `README.md` the moment VS Code mounts, instead of waiting 30+
  seconds for CheerpX to finish booting (issue #2 screenshot feedback).
- Two-stage bus: a workspace-only methods table serves `fs.*` requests
  while CheerpX is still loading; once the VM finishes booting, the
  bus hot-swaps to the full table that adds `proc.*` (terminal) and
  `cargo.*` support. Implemented via `setMethods` on the bus server so
  the swap happens without registering a duplicate message listener
  (which would double-respond to every request).
- `webvm-server.js` now mirrors the JS-side workspace into the guest's
  `/workspace/` directory using `cat <<EOF` heredocs sent to the
  persistent bash session. After priming, the terminal lands at
  `/workspace` and runs `ls -la` so the populated directory is visible
  immediately — exactly the "ls where hello_world.rs is visible"
  feedback from the user.
- Auto-open `hello_world.rs` on extension activation. The webvm-host
  extension's `activate()` now calls `vscode.window.showTextDocument`
  on `webvm:/workspace/hello_world.rs`, falling back to
  `hello/src/main.rs` and `README.md` if the user has deleted earlier
  files (their edits persist in IndexedDB across sessions).
- `disk-image.yml` workflow now auto-publishes `rust-alpine.ext2` to
  the `disk-latest` rolling release tag on every push to main. The
  `web/disk/manifest.json` warm URL points to that release, so the
  Pages site picks up the freshest Alpine + Rust image without manual
  intervention.

### Changed
- `web/disk/manifest.json` warm URL now resolves to
  `https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2`
  (was `null`).
- `cheerpx-bridge.js`'s `bootLinux()` now falls back to the public
  WebVM Debian image if the warm `CloudDevice.create()` call fails —
  this keeps the workbench coming up cleanly during the brief window
  between merging this PR and the disk-image workflow finishing on
  main. The disk URL probe also uses `mode: 'no-cors'` to keep CORS
  errors out of the devtools console while we're falling back.
- Terminal banner is now a single clean status pane: "Booting Linux
  VM…" → VM-stage updates → "Linux VM ready ✓" → "Workspace mirrored
  to /workspace — try `cargo run` in /workspace/hello", followed by
  the actual `ls -la /workspace` output. The previous flow echoed raw
  `cd` commands and surfaced `mesg: ttyname failed` noise from
  /etc/profile.d scripts.

### Fixed
- Explorer no longer shows an empty `workspace` with a warning icon
  while CheerpX is booting; the JS-side store always serves `fs.stat`
  / `fs.readDir` synchronously off IndexedDB.
- Issue #2 screenshot feedback ("no hello_world.rs in file browser, it
  should be as in user's home folder"): hello_world.rs is now visible
  AND pre-opened on first paint.
- Issue #2 screenshot feedback ("terminal shows lots of errors"): the
  prime script disables echo while heredocs stream, then `clear`s and
  runs `ls -la /workspace` so the user lands in a clean terminal with
  the populated directory listing.

### Fixed
- Terminal staircase indentation in the WebVM bash pane (issue #2 boot
  screenshot feedback). Bash inside CheerpX writes through
  `cx.setCustomConsole`, which is not a kernel TTY: there is no ONLCR
  mapping, so each newline arrives as a bare `\n`. VS Code's
  Pseudoterminal API (xterm.js underneath) requires `\r\n` — without the
  carriage return the cursor only moved down, not back to column 0,
  producing the visible staircase in the previous boot screenshots.
  `web/glue/webvm-server.js` now runs every stdout chunk through
  `createLfToCrlfNormaliser()` from `web/glue/terminal-stream.js` before
  broadcasting `proc.stdout`. The normaliser is stateful so a chunk
  boundary that splits an existing `\r\n` (CheerpX delivers `foo\r` in
  one chunk, `\nbar` in the next) does not produce `\r\r\n`. Existing
  CRLF passes through unchanged; bare `\r` (cargo's progress meter) is
  preserved.

### Added
- `web/glue/terminal-stream.js` with `createLfToCrlfNormaliser()` and
  the one-shot `lfToCrlf()` convenience used by the page-side WebVM
  server.
- `web/tests/terminal-stream.test.mjs` — eight unit tests covering
  every newline shape (lone LF, CRLF, bare CR, ANSI control sequences,
  empty input, the exact `ls -la /workspace` repro from the screenshot,
  and chunk boundaries split mid-CRLF).
- `web/tests/webvm-server.test.mjs` — four integration tests with a
  fake CheerpX handle, asserting that stdout written by the engine is
  normalised on the wire, vt != 1 channels are still filtered, and the
  in-memory bus transport stays sane.

### Changed
- `web/glue/webvm-server.js` now uses a streaming `TextDecoder`
  (`stream: true`) for stdout, so multi-byte UTF-8 split across CheerpX
  writes no longer decodes to U+FFFD before reaching the terminal.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).

### Fixed
- Fixed GitHub Pages warm-disk boot failures by staging the release-hosted Rust ext2 image into same-origin CheerpX GitHubDevice chunks and selecting the correct CheerpX block device at runtime.

### Fixed
- Kept WebVM workspace priming and editor-save mirroring out of the
  visible terminal by staging temporary CheerpX `/data` scripts instead
  of typing setup heredocs into the interactive bash session.

### Documentation
- Replaced the issue #11 case-study placeholder with terminal-noise
  evidence, root-cause analysis, online research, and verification logs.

# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.

### Fixed
- The deployed GitHub Pages workbench could not run `tree` or `cargo run`
  inside the in-browser terminal (issue #15). The CheerpX 1.2.11 runtime
  the project shipped emitted `TypeError: Cannot read properties of
  undefined (reading 'a1')` four times during Linux boot and failed
  `cx.run` with `CheerpException: Program exited with code 71`. Bumped
  the vendored runtime to **CheerpX 1.3.0** in `web/build/build-workbench.mjs`,
  `web/glue/cheerpx-bridge.js` (runtime version constant), and
  `web/sw.js` (cache key) — Linux now reaches `vmPhase: 'ready'` and
  `cx.run` returns `status: 0` for `tree --version` and the prebuilt
  `/workspace/target/release/hello` binary.
- `web/build/dev-server.mjs` now redirects `/rust-web-box` → `/rust-web-box/`
  when serving with a base prefix. Mirrors GitHub Pages canonicalisation
  so the same URL shape resolves the same way locally and on Pages.
- `globalThis.__rustWebBox.vmPhase` now reaches `'ready'`. Previously
  `boot.js` only forwarded phases out of `cheerpx-bridge`'s `onProgress`
  hook, which stops at `'starting Linux'`. The terminal `'ready'` phase
  is emitted from inside `web/glue/webvm-server.js` and was only ever
  visible on the BroadcastChannel — never on the page-level shim. The
  e2e harness keys `vmPhase === 'ready'` on that shim, so without this
  fix the local-e2e CI job would deadlock and time out at 180s waiting
  for a transition that could never happen. `startWebVMServer` now
  accepts an `onPhase` callback and `boot.js` threads it through a
  single `setPhase` helper that's the only thing that mutates `vmPhase`.

### Added
- `web/tests/helpers/cheerpx-page-harness.mjs` — reusable browser
  harness around [`browser-commander`](https://github.com/link-foundation/browser-commander).
  Wraps Chromium launch, COOP/COEP-aware dev-server boot, stage-1 shim
  wait, stage-2 Linux wait, and `cx.run` invocation. On either-stage
  timeout the thrown error is enriched with an in-page snapshot
  (`vmPhase`, has-vm/workspace/shim flags, recorded `vm.boot` history),
  the last 30 console messages, captured `console.error`/`pageerror`
  output, and the list of failed network requests — so a CI failure
  surfaces the *cause* of the stall rather than just `Timeout Xms
  exceeded`.
- `web/tests/e2e/local-pages-e2e.test.mjs` — local end-to-end suite that
  drives the freshly built `web/` artifact. Asserts CheerpX 1.3.0 runs
  `tree --version`, lists `/workspace`, and executes the prebuilt hello
  binary without leaking `CheerpException` into `console.error`.
- `web/tests/e2e/live-pages-e2e.test.mjs` — post-deploy end-to-end suite
  that drives `RUST_WEB_BOX_LIVE_URL`. Same assertions, against the URL
  GitHub Pages just published.
- `web/tests/package.json` + lockfile — pin `browser-commander` and
  `playwright` versions for the e2e harness.
- `.github/workflows/pages.yml` gains a `local-e2e` job (PRs + main, runs
  before deploy) and an `e2e` job (post-deploy, drives the live URL).
  The `build` job now stages the warm rust-alpine disk on PRs as well,
  with `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release
  asset.
- `docs/case-studies/issue-15/` — full case study with timeline,
  evidence (Playwright console logs + screenshots + per-step `cx.run`
  output), upstream-issue tracking, and the verification plan.

### Fixed
- Reduced default rust-web-box console noise with exact VS Code Web startup filtering, lazy namespaced debug logging, source-map stub generation, and a polished WebVM boot banner.
- Removed the duplicate default workspace task seed that still pointed at the old `/workspace/hello` project path.

### Fixed
- Kept the VS Code web workspace and WebVM `/workspace` in sync for editor saves, guest terminal edits, and file tree refreshes.
- Restored explicit manual-save behavior in the seeded workspace so unsaved editor changes show the normal dirty state before Ctrl+S.

### Fixed
- Show WebVM `target/` build artifacts in the VS Code Explorer by syncing skipped target file metadata instead of pruning the directory.

### Fixed
- Stopped duplicating typed characters in the WebVM terminal: `makePseudoterminal` and `makeCargoPty` now dispose the prior `proc.stdout`/`proc.exit` bus subscribers before re-binding when VS Code re-`open()`-s the pty (issue #27).
- Restored prompt-time sync performance and unblocked `cargo run` reacting to editor saves: the bash sync hook prunes `/workspace/target` again while still emitting a single `D` frame for the directory itself so the VS Code Explorer keeps showing it (issue #27).
- Prevented the deletion sweep from wiping cached `target/` metadata stubs when the prompt-time scan intentionally skips them (issue #27).
- Avoided double-installation of the `__rwb_sync_from_guest` `PROMPT_COMMAND` if `/root/.bash_profile` is re-sourced.
- Guarded auto-creation of the "WebVM bash" terminal so a re-`activate()` does not spawn a duplicate panel.

### Added
- Opt-in `globalThis.__RWB_DEBUG_TERMINAL_STREAM` trace at both the bus emitter (`web/glue/webvm-server.js`) and the pty subscriber (`web/extensions/webvm-host/extension.js`) for fast attribution of any future duplicate-output regression.
- `web/tests/extension-pty-listeners.test.mjs`: source-shape regression tests asserting every `bus.on('proc.stdout', …)` site is paired with a prior `detachBusListeners()` call.
- `web/tests/e2e/local-pages-e2e.test.mjs`: new e2e test that drives the bus directly, types a sentinel via `proc.write`, and asserts the marker appears exactly twice in `proc.stdout` (one bash echo + one program output) — strictly less than the doubled stream the bug produced.
- `docs/case-studies/issue-27/`: full case study with timeline, root causes, evidence, online research, and verification.

### Fixed
- Refreshed `target/` metadata from the WebVM on demand when VS Code reads target directories, so Cargo build artifacts can be expanded in the Explorer without scanning the full build tree after every prompt.
- Saved dirty VS Code editor buffers before forwarding terminal Enter or Cargo task commands, so the next real `cargo run` uses the latest editor content.
- Marked saved Rust/Cargo inputs newer than existing target artifacts, with a fingerprint invalidation fallback, so warm-disk Cargo runs rebuild after browser-side edits.

### Added
- Regression coverage for scoped target snapshots, on-demand target directory refreshes, and edited-source `cargo run` e2e verification.

## Fixed

- Kept repeated plain `cargo run` real after editing `src/main.rs` by pre-baking the warm disk with a lean dev profile and applying matching Cargo profile environment only when the guest disk advertises that profile.
- Tightened browser e2e coverage so fixed disks must complete the edited second `cargo run` and print the edited output instead of accepting a compile-path timeout.
- Preserved writable filesystem headroom in the minimized warm disk so edited rebuilds have space for fresh debug artifacts.
- Kept the disk-image smoke test's edited rebuild isolated to a disposable image copy so staged Pages chunks still contain the default sample project.
- Forced Cargo freshness after browser saves by aging existing target metadata instead of relying on CheerpX's guest clock or deleting fingerprint files.

## Changed

- The disk-image workflow now smoke-tests an edited `cargo run`, stages the freshly built disk chunks locally, and runs browser e2e against that exact disk before publishing it.

### Fixed

- Confirmed the in-browser build is real (a genuine `rustc`/`cargo` invocation inside the CheerpX x86 Linux VM, not a faked transcript) and documented the proof in `docs/case-studies/issue-33/`.
- Removed the injected per-command branding (`This binary was compiled inside CheerpX.` / `Compiled by Rust inside the browser via CheerpX.`) that made a real build look faked, and made the prebuilt disk binary and the editable workspace seed byte-for-byte identical to the canonical `cargo new` program so the first run matches every later run.
- Migrated existing browser workspaces that still hold the untouched branded seed to the plain `cargo new` program on next open, while preserving any user edits.

### Changed

- The disk-image smoke test and workspace/boot unit tests now assert the plain `Hello, world!` greeting and the absence of the removed branding.
- Browser e2e Stage C/D assert the greeting printed by `cargo run` equals the literal in the source on disk (a stronger anti-fake check) on disks built from current source, while staying version-independent against the still-published warm disk.

### Fixed

- Brave users no longer see `WebAssembly.Module(): expected 1 elements on the stack for fallthru` plus `Uncaught TypeError: e is not a function` when a transient GitHub Pages 503 hits a warm-disk chunk. The page now retries 5xx/408/429 and network errors on `.c{6-hex}.txt` chunk fetches with capped exponential backoff and full jitter before CheerpX sees the bytes, so a single bad chunk no longer poisons the JIT (issue #35).
- The boot toast no longer prints `Linux VM failed to boot: undefined` when a CheerpX worker rejects with an opaque error; failures are categorised (disk-503 / wasm-compile / worker-missing-export / network-blocked) and rendered with browser-aware hints (e.g. the Brave V8-JIT workaround for upstream brave-browser#36187).

### Added

- `__rustWebBox.diskDiag.attempts` records the last 50 warm-disk chunk fetch attempts; `__rustWebBox.diagnostics.events` records boot-time `unhandledrejection`/`error` events with their categorisation. Both are intended for the e2e harness and post-mortem inspection.
- Case study at `docs/case-studies/issue-35/` (timeline, root causes RC1–RC5, options table, online research, upstream CheerpX issue draft).

### Fixed
- Apply the dark theme by default (`workbench.colorTheme: "Default Dark Modern"`), matching vscode.dev. The workbench previously had no theme default and fell back to the OS `prefers-color-scheme`, rendering Light Modern (issue #37).
- Fix UI controls being clipped/misaligned on iPad Safari (and any browser with a classic scrollbar): pin the workbench with `position: fixed; inset: 0` instead of `width: 100vw; height: 100vh`, which on Safari resolves wider/taller than the visible viewport and gets cropped by `overflow: hidden` (issue #37).
- Remove the global `* { box-sizing: border-box }` reset from the VS Code workbench surface and scope it to the boot toast only; the reset shrank VS Code's fixed-width action buttons and tree expanders, causing the small-button/hover/expander offsets called out in PR review (issue #37).
- Add `viewport-fit=cover` and `env(safe-area-inset-*)` offsets so the workbench paints edge-to-edge and the boot toast clears the iPad notch/home-indicator.
- iPad-Safari terminal: root-caused the "terminal does not work" symptom to the CheerpX `OverlayDevice 'a1'` fresh-inode wedge (the same upstream bug as issues #15/#17, now triggered by interactive `bash --login` allocating a fresh `~/.bash_history` inode). Set `HISTFILE=/dev/null` everywhere bash starts so it no longer allocates that inode, reducing the wedge rate (issue #37).

### Changed
- Bump the vendored CheerpX runtime from 1.3.0 to the latest **1.3.3** across all code, vendored assets, the service-worker cache key, tests, and docs (issue #37, requirement R4). The 1.3.1–1.3.3 changelog contains no `OverlayDevice` fix, so the wedge mitigations remain in place.

### Added
- Interactive-shell **first-output watchdog**: when `bash` spawns but produces no output within the window, `runShellLoop` writes a visible, actionable advisory directly into the terminal (naming the upstream bug and the reload/Chromium workarounds) instead of leaving the iPad-Safari user staring at a blank pane, and records `silentSpawns`/`slowFirstOutput` diagnostics (issue #37).
- Interactive-shell health diagnostics: `runShellLoop` records spawn/exit/error/fast-cycle counts plus output-byte timing into the server runtime, surfaces a toast when the shell repeatedly fails to start, and exposes the data via `__rustWebBox.dump()`.
- Apple-platform detection in `browser-info` (`isSafari`/`isIOS`/`isIPad`, using `maxTouchPoints` since iPadOS Safari reports as "Macintosh"), reported in `dumpRuntime()` for actionable bug reports.
- Filed the CheerpX `OverlayDevice 'a1'` wedge upstream as [leaningtech/webvm#222](https://github.com/leaningtech/webvm/issues/222) — the single canonical report covering all three triggers (workspace prime, `cargo run`, interactive bash), with a reproducer, the shipped workarounds, and a fix suggestion (issue #37).
- Case study `docs/case-studies/issue-37/` with timeline, requirements checklist, root-cause analysis, online research, before/after iPad screenshots, e2e geometry coverage, and the upstream report.

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

## [0.15.0] - 2026-06-10

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

### Fixed
- Make release scripts resolve the publishable crate manifest when the repository root uses a Cargo workspace manifest.

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.

### Added
- Full MVP wiring for the in-browser Rust sandbox (issue #1):
  - `web/glue/cheerpx-bridge.js`: loads CheerpX (vendored, CDN fallback),
    boots a Linux VM against the public WebVM Debian image with an
    IndexedDB overlay for persistence.
  - `web/glue/webvm-bus.js`: request/response + event protocol over
    BroadcastChannel that connects the page (where CheerpX lives) to
    extension-host workers.
  - `web/glue/webvm-server.js`: page-side server that exposes the VM's
    file system and a process registry over the bus.
  - `web/extensions/webvm-host/`: VS Code Web extension implementing the
    `webvm:` `FileSystemProvider`, a `Pseudoterminal` over CheerpX bash,
    cargo task provider (`build`, `run`, `test`, `add`, `new`), and a
    status-bar Run button.
  - `web/extensions/rust-analyzer-web/`: VS Code Web extension stub that
    loads the rust-analyzer WASM artifact when bundled and contributes
    Rust language configuration plus lightweight diagnostics.
  - `web/build/build-workbench.mjs`: build step that vendors
    `vscode-web@1.91.1` + CheerpX 1.2.8 and renders `web/index.html`
    with workbench config that preinstalls our extensions.
  - `web/build/index.template.html`: workbench entry template.
  - `web/tests/webvm-bus.test.mjs`, `web/tests/cheerpx-bridge.test.mjs`:
    additional unit tests; total `node --test` count is now 26.
  - Service worker now caches glue assets and synthesizes COOP/COEP +
    CORP headers on same-origin assets.
  - `.github/workflows/pages.yml` runs the build step before uploading
    the Pages artifact.

### Changed
- `web/index.html` is now the workbench entry document. It renders a
  boot overlay with a five-step status (shell, shim, CheerpX, VM, VS
  Code) that resolves once the workbench mounts, then fades out.

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.

### Added
- JS-side workspace store (`web/glue/workspace-fs.js`) backed by
  IndexedDB. The `webvm:` `FileSystemProvider` now reads/writes from
  this store so the Explorer populates immediately on page load — the
  user sees `hello_world.rs`, `hello/Cargo.toml`, `hello/src/main.rs`,
  and `README.md` the moment VS Code mounts, instead of waiting 30+
  seconds for CheerpX to finish booting (issue #2 screenshot feedback).
- Two-stage bus: a workspace-only methods table serves `fs.*` requests
  while CheerpX is still loading; once the VM finishes booting, the
  bus hot-swaps to the full table that adds `proc.*` (terminal) and
  `cargo.*` support. Implemented via `setMethods` on the bus server so
  the swap happens without registering a duplicate message listener
  (which would double-respond to every request).
- `webvm-server.js` now mirrors the JS-side workspace into the guest's
  `/workspace/` directory using `cat <<EOF` heredocs sent to the
  persistent bash session. After priming, the terminal lands at
  `/workspace` and runs `ls -la` so the populated directory is visible
  immediately — exactly the "ls where hello_world.rs is visible"
  feedback from the user.
- Auto-open `hello_world.rs` on extension activation. The webvm-host
  extension's `activate()` now calls `vscode.window.showTextDocument`
  on `webvm:/workspace/hello_world.rs`, falling back to
  `hello/src/main.rs` and `README.md` if the user has deleted earlier
  files (their edits persist in IndexedDB across sessions).
- `disk-image.yml` workflow now auto-publishes `rust-alpine.ext2` to
  the `disk-latest` rolling release tag on every push to main. The
  `web/disk/manifest.json` warm URL points to that release, so the
  Pages site picks up the freshest Alpine + Rust image without manual
  intervention.

### Changed
- `web/disk/manifest.json` warm URL now resolves to
  `https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2`
  (was `null`).
- `cheerpx-bridge.js`'s `bootLinux()` now falls back to the public
  WebVM Debian image if the warm `CloudDevice.create()` call fails —
  this keeps the workbench coming up cleanly during the brief window
  between merging this PR and the disk-image workflow finishing on
  main. The disk URL probe also uses `mode: 'no-cors'` to keep CORS
  errors out of the devtools console while we're falling back.
- Terminal banner is now a single clean status pane: "Booting Linux
  VM…" → VM-stage updates → "Linux VM ready ✓" → "Workspace mirrored
  to /workspace — try `cargo run` in /workspace/hello", followed by
  the actual `ls -la /workspace` output. The previous flow echoed raw
  `cd` commands and surfaced `mesg: ttyname failed` noise from
  /etc/profile.d scripts.

### Fixed
- Explorer no longer shows an empty `workspace` with a warning icon
  while CheerpX is booting; the JS-side store always serves `fs.stat`
  / `fs.readDir` synchronously off IndexedDB.
- Issue #2 screenshot feedback ("no hello_world.rs in file browser, it
  should be as in user's home folder"): hello_world.rs is now visible
  AND pre-opened on first paint.
- Issue #2 screenshot feedback ("terminal shows lots of errors"): the
  prime script disables echo while heredocs stream, then `clear`s and
  runs `ls -la /workspace` so the user lands in a clean terminal with
  the populated directory listing.

### Fixed
- Terminal staircase indentation in the WebVM bash pane (issue #2 boot
  screenshot feedback). Bash inside CheerpX writes through
  `cx.setCustomConsole`, which is not a kernel TTY: there is no ONLCR
  mapping, so each newline arrives as a bare `\n`. VS Code's
  Pseudoterminal API (xterm.js underneath) requires `\r\n` — without the
  carriage return the cursor only moved down, not back to column 0,
  producing the visible staircase in the previous boot screenshots.
  `web/glue/webvm-server.js` now runs every stdout chunk through
  `createLfToCrlfNormaliser()` from `web/glue/terminal-stream.js` before
  broadcasting `proc.stdout`. The normaliser is stateful so a chunk
  boundary that splits an existing `\r\n` (CheerpX delivers `foo\r` in
  one chunk, `\nbar` in the next) does not produce `\r\r\n`. Existing
  CRLF passes through unchanged; bare `\r` (cargo's progress meter) is
  preserved.

### Added
- `web/glue/terminal-stream.js` with `createLfToCrlfNormaliser()` and
  the one-shot `lfToCrlf()` convenience used by the page-side WebVM
  server.
- `web/tests/terminal-stream.test.mjs` — eight unit tests covering
  every newline shape (lone LF, CRLF, bare CR, ANSI control sequences,
  empty input, the exact `ls -la /workspace` repro from the screenshot,
  and chunk boundaries split mid-CRLF).
- `web/tests/webvm-server.test.mjs` — four integration tests with a
  fake CheerpX handle, asserting that stdout written by the engine is
  normalised on the wire, vt != 1 channels are still filtered, and the
  in-memory bus transport stays sane.

### Changed
- `web/glue/webvm-server.js` now uses a streaming `TextDecoder`
  (`stream: true`) for stdout, so multi-byte UTF-8 split across CheerpX
  writes no longer decodes to U+FFFD before reaching the terminal.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).

### Fixed
- Fixed GitHub Pages warm-disk boot failures by staging the release-hosted Rust ext2 image into same-origin CheerpX GitHubDevice chunks and selecting the correct CheerpX block device at runtime.

### Fixed
- Kept WebVM workspace priming and editor-save mirroring out of the
  visible terminal by staging temporary CheerpX `/data` scripts instead
  of typing setup heredocs into the interactive bash session.

### Documentation
- Replaced the issue #11 case-study placeholder with terminal-noise
  evidence, root-cause analysis, online research, and verification logs.

# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.

### Fixed
- The deployed GitHub Pages workbench could not run `tree` or `cargo run`
  inside the in-browser terminal (issue #15). The CheerpX 1.2.11 runtime
  the project shipped emitted `TypeError: Cannot read properties of
  undefined (reading 'a1')` four times during Linux boot and failed
  `cx.run` with `CheerpException: Program exited with code 71`. Bumped
  the vendored runtime to **CheerpX 1.3.0** in `web/build/build-workbench.mjs`,
  `web/glue/cheerpx-bridge.js` (runtime version constant), and
  `web/sw.js` (cache key) — Linux now reaches `vmPhase: 'ready'` and
  `cx.run` returns `status: 0` for `tree --version` and the prebuilt
  `/workspace/target/release/hello` binary.
- `web/build/dev-server.mjs` now redirects `/rust-web-box` → `/rust-web-box/`
  when serving with a base prefix. Mirrors GitHub Pages canonicalisation
  so the same URL shape resolves the same way locally and on Pages.
- `globalThis.__rustWebBox.vmPhase` now reaches `'ready'`. Previously
  `boot.js` only forwarded phases out of `cheerpx-bridge`'s `onProgress`
  hook, which stops at `'starting Linux'`. The terminal `'ready'` phase
  is emitted from inside `web/glue/webvm-server.js` and was only ever
  visible on the BroadcastChannel — never on the page-level shim. The
  e2e harness keys `vmPhase === 'ready'` on that shim, so without this
  fix the local-e2e CI job would deadlock and time out at 180s waiting
  for a transition that could never happen. `startWebVMServer` now
  accepts an `onPhase` callback and `boot.js` threads it through a
  single `setPhase` helper that's the only thing that mutates `vmPhase`.

### Added
- `web/tests/helpers/cheerpx-page-harness.mjs` — reusable browser
  harness around [`browser-commander`](https://github.com/link-foundation/browser-commander).
  Wraps Chromium launch, COOP/COEP-aware dev-server boot, stage-1 shim
  wait, stage-2 Linux wait, and `cx.run` invocation. On either-stage
  timeout the thrown error is enriched with an in-page snapshot
  (`vmPhase`, has-vm/workspace/shim flags, recorded `vm.boot` history),
  the last 30 console messages, captured `console.error`/`pageerror`
  output, and the list of failed network requests — so a CI failure
  surfaces the *cause* of the stall rather than just `Timeout Xms
  exceeded`.
- `web/tests/e2e/local-pages-e2e.test.mjs` — local end-to-end suite that
  drives the freshly built `web/` artifact. Asserts CheerpX 1.3.0 runs
  `tree --version`, lists `/workspace`, and executes the prebuilt hello
  binary without leaking `CheerpException` into `console.error`.
- `web/tests/e2e/live-pages-e2e.test.mjs` — post-deploy end-to-end suite
  that drives `RUST_WEB_BOX_LIVE_URL`. Same assertions, against the URL
  GitHub Pages just published.
- `web/tests/package.json` + lockfile — pin `browser-commander` and
  `playwright` versions for the e2e harness.
- `.github/workflows/pages.yml` gains a `local-e2e` job (PRs + main, runs
  before deploy) and an `e2e` job (post-deploy, drives the live URL).
  The `build` job now stages the warm rust-alpine disk on PRs as well,
  with `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release
  asset.
- `docs/case-studies/issue-15/` — full case study with timeline,
  evidence (Playwright console logs + screenshots + per-step `cx.run`
  output), upstream-issue tracking, and the verification plan.

### Fixed
- Reduced default rust-web-box console noise with exact VS Code Web startup filtering, lazy namespaced debug logging, source-map stub generation, and a polished WebVM boot banner.
- Removed the duplicate default workspace task seed that still pointed at the old `/workspace/hello` project path.

### Fixed
- Kept the VS Code web workspace and WebVM `/workspace` in sync for editor saves, guest terminal edits, and file tree refreshes.
- Restored explicit manual-save behavior in the seeded workspace so unsaved editor changes show the normal dirty state before Ctrl+S.

### Fixed
- Show WebVM `target/` build artifacts in the VS Code Explorer by syncing skipped target file metadata instead of pruning the directory.

### Fixed
- Stopped duplicating typed characters in the WebVM terminal: `makePseudoterminal` and `makeCargoPty` now dispose the prior `proc.stdout`/`proc.exit` bus subscribers before re-binding when VS Code re-`open()`-s the pty (issue #27).
- Restored prompt-time sync performance and unblocked `cargo run` reacting to editor saves: the bash sync hook prunes `/workspace/target` again while still emitting a single `D` frame for the directory itself so the VS Code Explorer keeps showing it (issue #27).
- Prevented the deletion sweep from wiping cached `target/` metadata stubs when the prompt-time scan intentionally skips them (issue #27).
- Avoided double-installation of the `__rwb_sync_from_guest` `PROMPT_COMMAND` if `/root/.bash_profile` is re-sourced.
- Guarded auto-creation of the "WebVM bash" terminal so a re-`activate()` does not spawn a duplicate panel.

### Added
- Opt-in `globalThis.__RWB_DEBUG_TERMINAL_STREAM` trace at both the bus emitter (`web/glue/webvm-server.js`) and the pty subscriber (`web/extensions/webvm-host/extension.js`) for fast attribution of any future duplicate-output regression.
- `web/tests/extension-pty-listeners.test.mjs`: source-shape regression tests asserting every `bus.on('proc.stdout', …)` site is paired with a prior `detachBusListeners()` call.
- `web/tests/e2e/local-pages-e2e.test.mjs`: new e2e test that drives the bus directly, types a sentinel via `proc.write`, and asserts the marker appears exactly twice in `proc.stdout` (one bash echo + one program output) — strictly less than the doubled stream the bug produced.
- `docs/case-studies/issue-27/`: full case study with timeline, root causes, evidence, online research, and verification.

### Fixed
- Refreshed `target/` metadata from the WebVM on demand when VS Code reads target directories, so Cargo build artifacts can be expanded in the Explorer without scanning the full build tree after every prompt.
- Saved dirty VS Code editor buffers before forwarding terminal Enter or Cargo task commands, so the next real `cargo run` uses the latest editor content.
- Marked saved Rust/Cargo inputs newer than existing target artifacts, with a fingerprint invalidation fallback, so warm-disk Cargo runs rebuild after browser-side edits.

### Added
- Regression coverage for scoped target snapshots, on-demand target directory refreshes, and edited-source `cargo run` e2e verification.

## Fixed

- Kept repeated plain `cargo run` real after editing `src/main.rs` by pre-baking the warm disk with a lean dev profile and applying matching Cargo profile environment only when the guest disk advertises that profile.
- Tightened browser e2e coverage so fixed disks must complete the edited second `cargo run` and print the edited output instead of accepting a compile-path timeout.
- Preserved writable filesystem headroom in the minimized warm disk so edited rebuilds have space for fresh debug artifacts.
- Kept the disk-image smoke test's edited rebuild isolated to a disposable image copy so staged Pages chunks still contain the default sample project.
- Forced Cargo freshness after browser saves by aging existing target metadata instead of relying on CheerpX's guest clock or deleting fingerprint files.

## Changed

- The disk-image workflow now smoke-tests an edited `cargo run`, stages the freshly built disk chunks locally, and runs browser e2e against that exact disk before publishing it.

### Fixed

- Confirmed the in-browser build is real (a genuine `rustc`/`cargo` invocation inside the CheerpX x86 Linux VM, not a faked transcript) and documented the proof in `docs/case-studies/issue-33/`.
- Removed the injected per-command branding (`This binary was compiled inside CheerpX.` / `Compiled by Rust inside the browser via CheerpX.`) that made a real build look faked, and made the prebuilt disk binary and the editable workspace seed byte-for-byte identical to the canonical `cargo new` program so the first run matches every later run.
- Migrated existing browser workspaces that still hold the untouched branded seed to the plain `cargo new` program on next open, while preserving any user edits.

### Changed

- The disk-image smoke test and workspace/boot unit tests now assert the plain `Hello, world!` greeting and the absence of the removed branding.
- Browser e2e Stage C/D assert the greeting printed by `cargo run` equals the literal in the source on disk (a stronger anti-fake check) on disks built from current source, while staying version-independent against the still-published warm disk.

### Fixed

- Brave users no longer see `WebAssembly.Module(): expected 1 elements on the stack for fallthru` plus `Uncaught TypeError: e is not a function` when a transient GitHub Pages 503 hits a warm-disk chunk. The page now retries 5xx/408/429 and network errors on `.c{6-hex}.txt` chunk fetches with capped exponential backoff and full jitter before CheerpX sees the bytes, so a single bad chunk no longer poisons the JIT (issue #35).
- The boot toast no longer prints `Linux VM failed to boot: undefined` when a CheerpX worker rejects with an opaque error; failures are categorised (disk-503 / wasm-compile / worker-missing-export / network-blocked) and rendered with browser-aware hints (e.g. the Brave V8-JIT workaround for upstream brave-browser#36187).

### Added

- `__rustWebBox.diskDiag.attempts` records the last 50 warm-disk chunk fetch attempts; `__rustWebBox.diagnostics.events` records boot-time `unhandledrejection`/`error` events with their categorisation. Both are intended for the e2e harness and post-mortem inspection.
- Case study at `docs/case-studies/issue-35/` (timeline, root causes RC1–RC5, options table, online research, upstream CheerpX issue draft).

### Fixed
- Apply the dark theme by default (`workbench.colorTheme: "Default Dark Modern"`), matching vscode.dev. The workbench previously had no theme default and fell back to the OS `prefers-color-scheme`, rendering Light Modern (issue #37).
- Fix UI controls being clipped/misaligned on iPad Safari (and any browser with a classic scrollbar): pin the workbench with `position: fixed; inset: 0` instead of `width: 100vw; height: 100vh`, which on Safari resolves wider/taller than the visible viewport and gets cropped by `overflow: hidden` (issue #37).
- Remove the global `* { box-sizing: border-box }` reset from the VS Code workbench surface and scope it to the boot toast only; the reset shrank VS Code's fixed-width action buttons and tree expanders, causing the small-button/hover/expander offsets called out in PR review (issue #37).
- Add `viewport-fit=cover` and `env(safe-area-inset-*)` offsets so the workbench paints edge-to-edge and the boot toast clears the iPad notch/home-indicator.
- iPad-Safari terminal: root-caused the "terminal does not work" symptom to the CheerpX `OverlayDevice 'a1'` fresh-inode wedge (the same upstream bug as issues #15/#17, now triggered by interactive `bash --login` allocating a fresh `~/.bash_history` inode). Set `HISTFILE=/dev/null` everywhere bash starts so it no longer allocates that inode, reducing the wedge rate (issue #37).

### Changed
- Bump the vendored CheerpX runtime from 1.3.0 to the latest **1.3.3** across all code, vendored assets, the service-worker cache key, tests, and docs (issue #37, requirement R4). The 1.3.1–1.3.3 changelog contains no `OverlayDevice` fix, so the wedge mitigations remain in place.

### Added
- Interactive-shell **first-output watchdog**: when `bash` spawns but produces no output within the window, `runShellLoop` writes a visible, actionable advisory directly into the terminal (naming the upstream bug and the reload/Chromium workarounds) instead of leaving the iPad-Safari user staring at a blank pane, and records `silentSpawns`/`slowFirstOutput` diagnostics (issue #37).
- Interactive-shell health diagnostics: `runShellLoop` records spawn/exit/error/fast-cycle counts plus output-byte timing into the server runtime, surfaces a toast when the shell repeatedly fails to start, and exposes the data via `__rustWebBox.dump()`.
- Apple-platform detection in `browser-info` (`isSafari`/`isIOS`/`isIPad`, using `maxTouchPoints` since iPadOS Safari reports as "Macintosh"), reported in `dumpRuntime()` for actionable bug reports.
- Filed the CheerpX `OverlayDevice 'a1'` wedge upstream as [leaningtech/webvm#222](https://github.com/leaningtech/webvm/issues/222) — the single canonical report covering all three triggers (workspace prime, `cargo run`, interactive bash), with a reproducer, the shipped workarounds, and a fix suggestion (issue #37).
- Case study `docs/case-studies/issue-37/` with timeline, requirements checklist, root-cause analysis, online research, before/after iPad screenshots, e2e geometry coverage, and the upstream report.

## [0.14.0] - 2026-05-29

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

### Fixed
- Make release scripts resolve the publishable crate manifest when the repository root uses a Cargo workspace manifest.

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.

### Added
- Full MVP wiring for the in-browser Rust sandbox (issue #1):
  - `web/glue/cheerpx-bridge.js`: loads CheerpX (vendored, CDN fallback),
    boots a Linux VM against the public WebVM Debian image with an
    IndexedDB overlay for persistence.
  - `web/glue/webvm-bus.js`: request/response + event protocol over
    BroadcastChannel that connects the page (where CheerpX lives) to
    extension-host workers.
  - `web/glue/webvm-server.js`: page-side server that exposes the VM's
    file system and a process registry over the bus.
  - `web/extensions/webvm-host/`: VS Code Web extension implementing the
    `webvm:` `FileSystemProvider`, a `Pseudoterminal` over CheerpX bash,
    cargo task provider (`build`, `run`, `test`, `add`, `new`), and a
    status-bar Run button.
  - `web/extensions/rust-analyzer-web/`: VS Code Web extension stub that
    loads the rust-analyzer WASM artifact when bundled and contributes
    Rust language configuration plus lightweight diagnostics.
  - `web/build/build-workbench.mjs`: build step that vendors
    `vscode-web@1.91.1` + CheerpX 1.2.8 and renders `web/index.html`
    with workbench config that preinstalls our extensions.
  - `web/build/index.template.html`: workbench entry template.
  - `web/tests/webvm-bus.test.mjs`, `web/tests/cheerpx-bridge.test.mjs`:
    additional unit tests; total `node --test` count is now 26.
  - Service worker now caches glue assets and synthesizes COOP/COEP +
    CORP headers on same-origin assets.
  - `.github/workflows/pages.yml` runs the build step before uploading
    the Pages artifact.

### Changed
- `web/index.html` is now the workbench entry document. It renders a
  boot overlay with a five-step status (shell, shim, CheerpX, VM, VS
  Code) that resolves once the workbench mounts, then fades out.

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.

### Added
- JS-side workspace store (`web/glue/workspace-fs.js`) backed by
  IndexedDB. The `webvm:` `FileSystemProvider` now reads/writes from
  this store so the Explorer populates immediately on page load — the
  user sees `hello_world.rs`, `hello/Cargo.toml`, `hello/src/main.rs`,
  and `README.md` the moment VS Code mounts, instead of waiting 30+
  seconds for CheerpX to finish booting (issue #2 screenshot feedback).
- Two-stage bus: a workspace-only methods table serves `fs.*` requests
  while CheerpX is still loading; once the VM finishes booting, the
  bus hot-swaps to the full table that adds `proc.*` (terminal) and
  `cargo.*` support. Implemented via `setMethods` on the bus server so
  the swap happens without registering a duplicate message listener
  (which would double-respond to every request).
- `webvm-server.js` now mirrors the JS-side workspace into the guest's
  `/workspace/` directory using `cat <<EOF` heredocs sent to the
  persistent bash session. After priming, the terminal lands at
  `/workspace` and runs `ls -la` so the populated directory is visible
  immediately — exactly the "ls where hello_world.rs is visible"
  feedback from the user.
- Auto-open `hello_world.rs` on extension activation. The webvm-host
  extension's `activate()` now calls `vscode.window.showTextDocument`
  on `webvm:/workspace/hello_world.rs`, falling back to
  `hello/src/main.rs` and `README.md` if the user has deleted earlier
  files (their edits persist in IndexedDB across sessions).
- `disk-image.yml` workflow now auto-publishes `rust-alpine.ext2` to
  the `disk-latest` rolling release tag on every push to main. The
  `web/disk/manifest.json` warm URL points to that release, so the
  Pages site picks up the freshest Alpine + Rust image without manual
  intervention.

### Changed
- `web/disk/manifest.json` warm URL now resolves to
  `https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2`
  (was `null`).
- `cheerpx-bridge.js`'s `bootLinux()` now falls back to the public
  WebVM Debian image if the warm `CloudDevice.create()` call fails —
  this keeps the workbench coming up cleanly during the brief window
  between merging this PR and the disk-image workflow finishing on
  main. The disk URL probe also uses `mode: 'no-cors'` to keep CORS
  errors out of the devtools console while we're falling back.
- Terminal banner is now a single clean status pane: "Booting Linux
  VM…" → VM-stage updates → "Linux VM ready ✓" → "Workspace mirrored
  to /workspace — try `cargo run` in /workspace/hello", followed by
  the actual `ls -la /workspace` output. The previous flow echoed raw
  `cd` commands and surfaced `mesg: ttyname failed` noise from
  /etc/profile.d scripts.

### Fixed
- Explorer no longer shows an empty `workspace` with a warning icon
  while CheerpX is booting; the JS-side store always serves `fs.stat`
  / `fs.readDir` synchronously off IndexedDB.
- Issue #2 screenshot feedback ("no hello_world.rs in file browser, it
  should be as in user's home folder"): hello_world.rs is now visible
  AND pre-opened on first paint.
- Issue #2 screenshot feedback ("terminal shows lots of errors"): the
  prime script disables echo while heredocs stream, then `clear`s and
  runs `ls -la /workspace` so the user lands in a clean terminal with
  the populated directory listing.

### Fixed
- Terminal staircase indentation in the WebVM bash pane (issue #2 boot
  screenshot feedback). Bash inside CheerpX writes through
  `cx.setCustomConsole`, which is not a kernel TTY: there is no ONLCR
  mapping, so each newline arrives as a bare `\n`. VS Code's
  Pseudoterminal API (xterm.js underneath) requires `\r\n` — without the
  carriage return the cursor only moved down, not back to column 0,
  producing the visible staircase in the previous boot screenshots.
  `web/glue/webvm-server.js` now runs every stdout chunk through
  `createLfToCrlfNormaliser()` from `web/glue/terminal-stream.js` before
  broadcasting `proc.stdout`. The normaliser is stateful so a chunk
  boundary that splits an existing `\r\n` (CheerpX delivers `foo\r` in
  one chunk, `\nbar` in the next) does not produce `\r\r\n`. Existing
  CRLF passes through unchanged; bare `\r` (cargo's progress meter) is
  preserved.

### Added
- `web/glue/terminal-stream.js` with `createLfToCrlfNormaliser()` and
  the one-shot `lfToCrlf()` convenience used by the page-side WebVM
  server.
- `web/tests/terminal-stream.test.mjs` — eight unit tests covering
  every newline shape (lone LF, CRLF, bare CR, ANSI control sequences,
  empty input, the exact `ls -la /workspace` repro from the screenshot,
  and chunk boundaries split mid-CRLF).
- `web/tests/webvm-server.test.mjs` — four integration tests with a
  fake CheerpX handle, asserting that stdout written by the engine is
  normalised on the wire, vt != 1 channels are still filtered, and the
  in-memory bus transport stays sane.

### Changed
- `web/glue/webvm-server.js` now uses a streaming `TextDecoder`
  (`stream: true`) for stdout, so multi-byte UTF-8 split across CheerpX
  writes no longer decodes to U+FFFD before reaching the terminal.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).

### Fixed
- Fixed GitHub Pages warm-disk boot failures by staging the release-hosted Rust ext2 image into same-origin CheerpX GitHubDevice chunks and selecting the correct CheerpX block device at runtime.

### Fixed
- Kept WebVM workspace priming and editor-save mirroring out of the
  visible terminal by staging temporary CheerpX `/data` scripts instead
  of typing setup heredocs into the interactive bash session.

### Documentation
- Replaced the issue #11 case-study placeholder with terminal-noise
  evidence, root-cause analysis, online research, and verification logs.

# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.

### Fixed
- The deployed GitHub Pages workbench could not run `tree` or `cargo run`
  inside the in-browser terminal (issue #15). The CheerpX 1.2.11 runtime
  the project shipped emitted `TypeError: Cannot read properties of
  undefined (reading 'a1')` four times during Linux boot and failed
  `cx.run` with `CheerpException: Program exited with code 71`. Bumped
  the vendored runtime to **CheerpX 1.3.0** in `web/build/build-workbench.mjs`,
  `web/glue/cheerpx-bridge.js` (runtime version constant), and
  `web/sw.js` (cache key) — Linux now reaches `vmPhase: 'ready'` and
  `cx.run` returns `status: 0` for `tree --version` and the prebuilt
  `/workspace/target/release/hello` binary.
- `web/build/dev-server.mjs` now redirects `/rust-web-box` → `/rust-web-box/`
  when serving with a base prefix. Mirrors GitHub Pages canonicalisation
  so the same URL shape resolves the same way locally and on Pages.
- `globalThis.__rustWebBox.vmPhase` now reaches `'ready'`. Previously
  `boot.js` only forwarded phases out of `cheerpx-bridge`'s `onProgress`
  hook, which stops at `'starting Linux'`. The terminal `'ready'` phase
  is emitted from inside `web/glue/webvm-server.js` and was only ever
  visible on the BroadcastChannel — never on the page-level shim. The
  e2e harness keys `vmPhase === 'ready'` on that shim, so without this
  fix the local-e2e CI job would deadlock and time out at 180s waiting
  for a transition that could never happen. `startWebVMServer` now
  accepts an `onPhase` callback and `boot.js` threads it through a
  single `setPhase` helper that's the only thing that mutates `vmPhase`.

### Added
- `web/tests/helpers/cheerpx-page-harness.mjs` — reusable browser
  harness around [`browser-commander`](https://github.com/link-foundation/browser-commander).
  Wraps Chromium launch, COOP/COEP-aware dev-server boot, stage-1 shim
  wait, stage-2 Linux wait, and `cx.run` invocation. On either-stage
  timeout the thrown error is enriched with an in-page snapshot
  (`vmPhase`, has-vm/workspace/shim flags, recorded `vm.boot` history),
  the last 30 console messages, captured `console.error`/`pageerror`
  output, and the list of failed network requests — so a CI failure
  surfaces the *cause* of the stall rather than just `Timeout Xms
  exceeded`.
- `web/tests/e2e/local-pages-e2e.test.mjs` — local end-to-end suite that
  drives the freshly built `web/` artifact. Asserts CheerpX 1.3.0 runs
  `tree --version`, lists `/workspace`, and executes the prebuilt hello
  binary without leaking `CheerpException` into `console.error`.
- `web/tests/e2e/live-pages-e2e.test.mjs` — post-deploy end-to-end suite
  that drives `RUST_WEB_BOX_LIVE_URL`. Same assertions, against the URL
  GitHub Pages just published.
- `web/tests/package.json` + lockfile — pin `browser-commander` and
  `playwright` versions for the e2e harness.
- `.github/workflows/pages.yml` gains a `local-e2e` job (PRs + main, runs
  before deploy) and an `e2e` job (post-deploy, drives the live URL).
  The `build` job now stages the warm rust-alpine disk on PRs as well,
  with `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release
  asset.
- `docs/case-studies/issue-15/` — full case study with timeline,
  evidence (Playwright console logs + screenshots + per-step `cx.run`
  output), upstream-issue tracking, and the verification plan.

### Fixed
- Reduced default rust-web-box console noise with exact VS Code Web startup filtering, lazy namespaced debug logging, source-map stub generation, and a polished WebVM boot banner.
- Removed the duplicate default workspace task seed that still pointed at the old `/workspace/hello` project path.

### Fixed
- Kept the VS Code web workspace and WebVM `/workspace` in sync for editor saves, guest terminal edits, and file tree refreshes.
- Restored explicit manual-save behavior in the seeded workspace so unsaved editor changes show the normal dirty state before Ctrl+S.

### Fixed
- Show WebVM `target/` build artifacts in the VS Code Explorer by syncing skipped target file metadata instead of pruning the directory.

### Fixed
- Stopped duplicating typed characters in the WebVM terminal: `makePseudoterminal` and `makeCargoPty` now dispose the prior `proc.stdout`/`proc.exit` bus subscribers before re-binding when VS Code re-`open()`-s the pty (issue #27).
- Restored prompt-time sync performance and unblocked `cargo run` reacting to editor saves: the bash sync hook prunes `/workspace/target` again while still emitting a single `D` frame for the directory itself so the VS Code Explorer keeps showing it (issue #27).
- Prevented the deletion sweep from wiping cached `target/` metadata stubs when the prompt-time scan intentionally skips them (issue #27).
- Avoided double-installation of the `__rwb_sync_from_guest` `PROMPT_COMMAND` if `/root/.bash_profile` is re-sourced.
- Guarded auto-creation of the "WebVM bash" terminal so a re-`activate()` does not spawn a duplicate panel.

### Added
- Opt-in `globalThis.__RWB_DEBUG_TERMINAL_STREAM` trace at both the bus emitter (`web/glue/webvm-server.js`) and the pty subscriber (`web/extensions/webvm-host/extension.js`) for fast attribution of any future duplicate-output regression.
- `web/tests/extension-pty-listeners.test.mjs`: source-shape regression tests asserting every `bus.on('proc.stdout', …)` site is paired with a prior `detachBusListeners()` call.
- `web/tests/e2e/local-pages-e2e.test.mjs`: new e2e test that drives the bus directly, types a sentinel via `proc.write`, and asserts the marker appears exactly twice in `proc.stdout` (one bash echo + one program output) — strictly less than the doubled stream the bug produced.
- `docs/case-studies/issue-27/`: full case study with timeline, root causes, evidence, online research, and verification.

### Fixed
- Refreshed `target/` metadata from the WebVM on demand when VS Code reads target directories, so Cargo build artifacts can be expanded in the Explorer without scanning the full build tree after every prompt.
- Saved dirty VS Code editor buffers before forwarding terminal Enter or Cargo task commands, so the next real `cargo run` uses the latest editor content.
- Marked saved Rust/Cargo inputs newer than existing target artifacts, with a fingerprint invalidation fallback, so warm-disk Cargo runs rebuild after browser-side edits.

### Added
- Regression coverage for scoped target snapshots, on-demand target directory refreshes, and edited-source `cargo run` e2e verification.

## Fixed

- Kept repeated plain `cargo run` real after editing `src/main.rs` by pre-baking the warm disk with a lean dev profile and applying matching Cargo profile environment only when the guest disk advertises that profile.
- Tightened browser e2e coverage so fixed disks must complete the edited second `cargo run` and print the edited output instead of accepting a compile-path timeout.
- Preserved writable filesystem headroom in the minimized warm disk so edited rebuilds have space for fresh debug artifacts.
- Kept the disk-image smoke test's edited rebuild isolated to a disposable image copy so staged Pages chunks still contain the default sample project.
- Forced Cargo freshness after browser saves by aging existing target metadata instead of relying on CheerpX's guest clock or deleting fingerprint files.

## Changed

- The disk-image workflow now smoke-tests an edited `cargo run`, stages the freshly built disk chunks locally, and runs browser e2e against that exact disk before publishing it.

### Fixed

- Confirmed the in-browser build is real (a genuine `rustc`/`cargo` invocation inside the CheerpX x86 Linux VM, not a faked transcript) and documented the proof in `docs/case-studies/issue-33/`.
- Removed the injected per-command branding (`This binary was compiled inside CheerpX.` / `Compiled by Rust inside the browser via CheerpX.`) that made a real build look faked, and made the prebuilt disk binary and the editable workspace seed byte-for-byte identical to the canonical `cargo new` program so the first run matches every later run.
- Migrated existing browser workspaces that still hold the untouched branded seed to the plain `cargo new` program on next open, while preserving any user edits.

### Changed

- The disk-image smoke test and workspace/boot unit tests now assert the plain `Hello, world!` greeting and the absence of the removed branding.
- Browser e2e Stage C/D assert the greeting printed by `cargo run` equals the literal in the source on disk (a stronger anti-fake check) on disks built from current source, while staying version-independent against the still-published warm disk.

### Fixed

- Brave users no longer see `WebAssembly.Module(): expected 1 elements on the stack for fallthru` plus `Uncaught TypeError: e is not a function` when a transient GitHub Pages 503 hits a warm-disk chunk. The page now retries 5xx/408/429 and network errors on `.c{6-hex}.txt` chunk fetches with capped exponential backoff and full jitter before CheerpX sees the bytes, so a single bad chunk no longer poisons the JIT (issue #35).
- The boot toast no longer prints `Linux VM failed to boot: undefined` when a CheerpX worker rejects with an opaque error; failures are categorised (disk-503 / wasm-compile / worker-missing-export / network-blocked) and rendered with browser-aware hints (e.g. the Brave V8-JIT workaround for upstream brave-browser#36187).

### Added

- `__rustWebBox.diskDiag.attempts` records the last 50 warm-disk chunk fetch attempts; `__rustWebBox.diagnostics.events` records boot-time `unhandledrejection`/`error` events with their categorisation. Both are intended for the e2e harness and post-mortem inspection.
- Case study at `docs/case-studies/issue-35/` (timeline, root causes RC1–RC5, options table, online research, upstream CheerpX issue draft).

## [0.13.0] - 2026-05-28

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

### Fixed
- Make release scripts resolve the publishable crate manifest when the repository root uses a Cargo workspace manifest.

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.

### Added
- Full MVP wiring for the in-browser Rust sandbox (issue #1):
  - `web/glue/cheerpx-bridge.js`: loads CheerpX (vendored, CDN fallback),
    boots a Linux VM against the public WebVM Debian image with an
    IndexedDB overlay for persistence.
  - `web/glue/webvm-bus.js`: request/response + event protocol over
    BroadcastChannel that connects the page (where CheerpX lives) to
    extension-host workers.
  - `web/glue/webvm-server.js`: page-side server that exposes the VM's
    file system and a process registry over the bus.
  - `web/extensions/webvm-host/`: VS Code Web extension implementing the
    `webvm:` `FileSystemProvider`, a `Pseudoterminal` over CheerpX bash,
    cargo task provider (`build`, `run`, `test`, `add`, `new`), and a
    status-bar Run button.
  - `web/extensions/rust-analyzer-web/`: VS Code Web extension stub that
    loads the rust-analyzer WASM artifact when bundled and contributes
    Rust language configuration plus lightweight diagnostics.
  - `web/build/build-workbench.mjs`: build step that vendors
    `vscode-web@1.91.1` + CheerpX 1.2.8 and renders `web/index.html`
    with workbench config that preinstalls our extensions.
  - `web/build/index.template.html`: workbench entry template.
  - `web/tests/webvm-bus.test.mjs`, `web/tests/cheerpx-bridge.test.mjs`:
    additional unit tests; total `node --test` count is now 26.
  - Service worker now caches glue assets and synthesizes COOP/COEP +
    CORP headers on same-origin assets.
  - `.github/workflows/pages.yml` runs the build step before uploading
    the Pages artifact.

### Changed
- `web/index.html` is now the workbench entry document. It renders a
  boot overlay with a five-step status (shell, shim, CheerpX, VM, VS
  Code) that resolves once the workbench mounts, then fades out.

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.

### Added
- JS-side workspace store (`web/glue/workspace-fs.js`) backed by
  IndexedDB. The `webvm:` `FileSystemProvider` now reads/writes from
  this store so the Explorer populates immediately on page load — the
  user sees `hello_world.rs`, `hello/Cargo.toml`, `hello/src/main.rs`,
  and `README.md` the moment VS Code mounts, instead of waiting 30+
  seconds for CheerpX to finish booting (issue #2 screenshot feedback).
- Two-stage bus: a workspace-only methods table serves `fs.*` requests
  while CheerpX is still loading; once the VM finishes booting, the
  bus hot-swaps to the full table that adds `proc.*` (terminal) and
  `cargo.*` support. Implemented via `setMethods` on the bus server so
  the swap happens without registering a duplicate message listener
  (which would double-respond to every request).
- `webvm-server.js` now mirrors the JS-side workspace into the guest's
  `/workspace/` directory using `cat <<EOF` heredocs sent to the
  persistent bash session. After priming, the terminal lands at
  `/workspace` and runs `ls -la` so the populated directory is visible
  immediately — exactly the "ls where hello_world.rs is visible"
  feedback from the user.
- Auto-open `hello_world.rs` on extension activation. The webvm-host
  extension's `activate()` now calls `vscode.window.showTextDocument`
  on `webvm:/workspace/hello_world.rs`, falling back to
  `hello/src/main.rs` and `README.md` if the user has deleted earlier
  files (their edits persist in IndexedDB across sessions).
- `disk-image.yml` workflow now auto-publishes `rust-alpine.ext2` to
  the `disk-latest` rolling release tag on every push to main. The
  `web/disk/manifest.json` warm URL points to that release, so the
  Pages site picks up the freshest Alpine + Rust image without manual
  intervention.

### Changed
- `web/disk/manifest.json` warm URL now resolves to
  `https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2`
  (was `null`).
- `cheerpx-bridge.js`'s `bootLinux()` now falls back to the public
  WebVM Debian image if the warm `CloudDevice.create()` call fails —
  this keeps the workbench coming up cleanly during the brief window
  between merging this PR and the disk-image workflow finishing on
  main. The disk URL probe also uses `mode: 'no-cors'` to keep CORS
  errors out of the devtools console while we're falling back.
- Terminal banner is now a single clean status pane: "Booting Linux
  VM…" → VM-stage updates → "Linux VM ready ✓" → "Workspace mirrored
  to /workspace — try `cargo run` in /workspace/hello", followed by
  the actual `ls -la /workspace` output. The previous flow echoed raw
  `cd` commands and surfaced `mesg: ttyname failed` noise from
  /etc/profile.d scripts.

### Fixed
- Explorer no longer shows an empty `workspace` with a warning icon
  while CheerpX is booting; the JS-side store always serves `fs.stat`
  / `fs.readDir` synchronously off IndexedDB.
- Issue #2 screenshot feedback ("no hello_world.rs in file browser, it
  should be as in user's home folder"): hello_world.rs is now visible
  AND pre-opened on first paint.
- Issue #2 screenshot feedback ("terminal shows lots of errors"): the
  prime script disables echo while heredocs stream, then `clear`s and
  runs `ls -la /workspace` so the user lands in a clean terminal with
  the populated directory listing.

### Fixed
- Terminal staircase indentation in the WebVM bash pane (issue #2 boot
  screenshot feedback). Bash inside CheerpX writes through
  `cx.setCustomConsole`, which is not a kernel TTY: there is no ONLCR
  mapping, so each newline arrives as a bare `\n`. VS Code's
  Pseudoterminal API (xterm.js underneath) requires `\r\n` — without the
  carriage return the cursor only moved down, not back to column 0,
  producing the visible staircase in the previous boot screenshots.
  `web/glue/webvm-server.js` now runs every stdout chunk through
  `createLfToCrlfNormaliser()` from `web/glue/terminal-stream.js` before
  broadcasting `proc.stdout`. The normaliser is stateful so a chunk
  boundary that splits an existing `\r\n` (CheerpX delivers `foo\r` in
  one chunk, `\nbar` in the next) does not produce `\r\r\n`. Existing
  CRLF passes through unchanged; bare `\r` (cargo's progress meter) is
  preserved.

### Added
- `web/glue/terminal-stream.js` with `createLfToCrlfNormaliser()` and
  the one-shot `lfToCrlf()` convenience used by the page-side WebVM
  server.
- `web/tests/terminal-stream.test.mjs` — eight unit tests covering
  every newline shape (lone LF, CRLF, bare CR, ANSI control sequences,
  empty input, the exact `ls -la /workspace` repro from the screenshot,
  and chunk boundaries split mid-CRLF).
- `web/tests/webvm-server.test.mjs` — four integration tests with a
  fake CheerpX handle, asserting that stdout written by the engine is
  normalised on the wire, vt != 1 channels are still filtered, and the
  in-memory bus transport stays sane.

### Changed
- `web/glue/webvm-server.js` now uses a streaming `TextDecoder`
  (`stream: true`) for stdout, so multi-byte UTF-8 split across CheerpX
  writes no longer decodes to U+FFFD before reaching the terminal.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).

### Fixed
- Fixed GitHub Pages warm-disk boot failures by staging the release-hosted Rust ext2 image into same-origin CheerpX GitHubDevice chunks and selecting the correct CheerpX block device at runtime.

### Fixed
- Kept WebVM workspace priming and editor-save mirroring out of the
  visible terminal by staging temporary CheerpX `/data` scripts instead
  of typing setup heredocs into the interactive bash session.

### Documentation
- Replaced the issue #11 case-study placeholder with terminal-noise
  evidence, root-cause analysis, online research, and verification logs.

# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.

### Fixed
- The deployed GitHub Pages workbench could not run `tree` or `cargo run`
  inside the in-browser terminal (issue #15). The CheerpX 1.2.11 runtime
  the project shipped emitted `TypeError: Cannot read properties of
  undefined (reading 'a1')` four times during Linux boot and failed
  `cx.run` with `CheerpException: Program exited with code 71`. Bumped
  the vendored runtime to **CheerpX 1.3.0** in `web/build/build-workbench.mjs`,
  `web/glue/cheerpx-bridge.js` (runtime version constant), and
  `web/sw.js` (cache key) — Linux now reaches `vmPhase: 'ready'` and
  `cx.run` returns `status: 0` for `tree --version` and the prebuilt
  `/workspace/target/release/hello` binary.
- `web/build/dev-server.mjs` now redirects `/rust-web-box` → `/rust-web-box/`
  when serving with a base prefix. Mirrors GitHub Pages canonicalisation
  so the same URL shape resolves the same way locally and on Pages.
- `globalThis.__rustWebBox.vmPhase` now reaches `'ready'`. Previously
  `boot.js` only forwarded phases out of `cheerpx-bridge`'s `onProgress`
  hook, which stops at `'starting Linux'`. The terminal `'ready'` phase
  is emitted from inside `web/glue/webvm-server.js` and was only ever
  visible on the BroadcastChannel — never on the page-level shim. The
  e2e harness keys `vmPhase === 'ready'` on that shim, so without this
  fix the local-e2e CI job would deadlock and time out at 180s waiting
  for a transition that could never happen. `startWebVMServer` now
  accepts an `onPhase` callback and `boot.js` threads it through a
  single `setPhase` helper that's the only thing that mutates `vmPhase`.

### Added
- `web/tests/helpers/cheerpx-page-harness.mjs` — reusable browser
  harness around [`browser-commander`](https://github.com/link-foundation/browser-commander).
  Wraps Chromium launch, COOP/COEP-aware dev-server boot, stage-1 shim
  wait, stage-2 Linux wait, and `cx.run` invocation. On either-stage
  timeout the thrown error is enriched with an in-page snapshot
  (`vmPhase`, has-vm/workspace/shim flags, recorded `vm.boot` history),
  the last 30 console messages, captured `console.error`/`pageerror`
  output, and the list of failed network requests — so a CI failure
  surfaces the *cause* of the stall rather than just `Timeout Xms
  exceeded`.
- `web/tests/e2e/local-pages-e2e.test.mjs` — local end-to-end suite that
  drives the freshly built `web/` artifact. Asserts CheerpX 1.3.0 runs
  `tree --version`, lists `/workspace`, and executes the prebuilt hello
  binary without leaking `CheerpException` into `console.error`.
- `web/tests/e2e/live-pages-e2e.test.mjs` — post-deploy end-to-end suite
  that drives `RUST_WEB_BOX_LIVE_URL`. Same assertions, against the URL
  GitHub Pages just published.
- `web/tests/package.json` + lockfile — pin `browser-commander` and
  `playwright` versions for the e2e harness.
- `.github/workflows/pages.yml` gains a `local-e2e` job (PRs + main, runs
  before deploy) and an `e2e` job (post-deploy, drives the live URL).
  The `build` job now stages the warm rust-alpine disk on PRs as well,
  with `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release
  asset.
- `docs/case-studies/issue-15/` — full case study with timeline,
  evidence (Playwright console logs + screenshots + per-step `cx.run`
  output), upstream-issue tracking, and the verification plan.

### Fixed
- Reduced default rust-web-box console noise with exact VS Code Web startup filtering, lazy namespaced debug logging, source-map stub generation, and a polished WebVM boot banner.
- Removed the duplicate default workspace task seed that still pointed at the old `/workspace/hello` project path.

### Fixed
- Kept the VS Code web workspace and WebVM `/workspace` in sync for editor saves, guest terminal edits, and file tree refreshes.
- Restored explicit manual-save behavior in the seeded workspace so unsaved editor changes show the normal dirty state before Ctrl+S.

### Fixed
- Show WebVM `target/` build artifacts in the VS Code Explorer by syncing skipped target file metadata instead of pruning the directory.

### Fixed
- Stopped duplicating typed characters in the WebVM terminal: `makePseudoterminal` and `makeCargoPty` now dispose the prior `proc.stdout`/`proc.exit` bus subscribers before re-binding when VS Code re-`open()`-s the pty (issue #27).
- Restored prompt-time sync performance and unblocked `cargo run` reacting to editor saves: the bash sync hook prunes `/workspace/target` again while still emitting a single `D` frame for the directory itself so the VS Code Explorer keeps showing it (issue #27).
- Prevented the deletion sweep from wiping cached `target/` metadata stubs when the prompt-time scan intentionally skips them (issue #27).
- Avoided double-installation of the `__rwb_sync_from_guest` `PROMPT_COMMAND` if `/root/.bash_profile` is re-sourced.
- Guarded auto-creation of the "WebVM bash" terminal so a re-`activate()` does not spawn a duplicate panel.

### Added
- Opt-in `globalThis.__RWB_DEBUG_TERMINAL_STREAM` trace at both the bus emitter (`web/glue/webvm-server.js`) and the pty subscriber (`web/extensions/webvm-host/extension.js`) for fast attribution of any future duplicate-output regression.
- `web/tests/extension-pty-listeners.test.mjs`: source-shape regression tests asserting every `bus.on('proc.stdout', …)` site is paired with a prior `detachBusListeners()` call.
- `web/tests/e2e/local-pages-e2e.test.mjs`: new e2e test that drives the bus directly, types a sentinel via `proc.write`, and asserts the marker appears exactly twice in `proc.stdout` (one bash echo + one program output) — strictly less than the doubled stream the bug produced.
- `docs/case-studies/issue-27/`: full case study with timeline, root causes, evidence, online research, and verification.

### Fixed
- Refreshed `target/` metadata from the WebVM on demand when VS Code reads target directories, so Cargo build artifacts can be expanded in the Explorer without scanning the full build tree after every prompt.
- Saved dirty VS Code editor buffers before forwarding terminal Enter or Cargo task commands, so the next real `cargo run` uses the latest editor content.
- Marked saved Rust/Cargo inputs newer than existing target artifacts, with a fingerprint invalidation fallback, so warm-disk Cargo runs rebuild after browser-side edits.

### Added
- Regression coverage for scoped target snapshots, on-demand target directory refreshes, and edited-source `cargo run` e2e verification.

## Fixed

- Kept repeated plain `cargo run` real after editing `src/main.rs` by pre-baking the warm disk with a lean dev profile and applying matching Cargo profile environment only when the guest disk advertises that profile.
- Tightened browser e2e coverage so fixed disks must complete the edited second `cargo run` and print the edited output instead of accepting a compile-path timeout.
- Preserved writable filesystem headroom in the minimized warm disk so edited rebuilds have space for fresh debug artifacts.
- Kept the disk-image smoke test's edited rebuild isolated to a disposable image copy so staged Pages chunks still contain the default sample project.
- Forced Cargo freshness after browser saves by aging existing target metadata instead of relying on CheerpX's guest clock or deleting fingerprint files.

## Changed

- The disk-image workflow now smoke-tests an edited `cargo run`, stages the freshly built disk chunks locally, and runs browser e2e against that exact disk before publishing it.

### Fixed

- Confirmed the in-browser build is real (a genuine `rustc`/`cargo` invocation inside the CheerpX x86 Linux VM, not a faked transcript) and documented the proof in `docs/case-studies/issue-33/`.
- Removed the injected per-command branding (`This binary was compiled inside CheerpX.` / `Compiled by Rust inside the browser via CheerpX.`) that made a real build look faked, and made the prebuilt disk binary and the editable workspace seed byte-for-byte identical to the canonical `cargo new` program so the first run matches every later run.
- Migrated existing browser workspaces that still hold the untouched branded seed to the plain `cargo new` program on next open, while preserving any user edits.

### Changed

- The disk-image smoke test and workspace/boot unit tests now assert the plain `Hello, world!` greeting and the absence of the removed branding.
- Browser e2e Stage C/D assert the greeting printed by `cargo run` equals the literal in the source on disk (a stronger anti-fake check) on disks built from current source, while staying version-independent against the still-published warm disk.

## [0.12.0] - 2026-05-10

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

### Fixed
- Make release scripts resolve the publishable crate manifest when the repository root uses a Cargo workspace manifest.

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.

### Added
- Full MVP wiring for the in-browser Rust sandbox (issue #1):
  - `web/glue/cheerpx-bridge.js`: loads CheerpX (vendored, CDN fallback),
    boots a Linux VM against the public WebVM Debian image with an
    IndexedDB overlay for persistence.
  - `web/glue/webvm-bus.js`: request/response + event protocol over
    BroadcastChannel that connects the page (where CheerpX lives) to
    extension-host workers.
  - `web/glue/webvm-server.js`: page-side server that exposes the VM's
    file system and a process registry over the bus.
  - `web/extensions/webvm-host/`: VS Code Web extension implementing the
    `webvm:` `FileSystemProvider`, a `Pseudoterminal` over CheerpX bash,
    cargo task provider (`build`, `run`, `test`, `add`, `new`), and a
    status-bar Run button.
  - `web/extensions/rust-analyzer-web/`: VS Code Web extension stub that
    loads the rust-analyzer WASM artifact when bundled and contributes
    Rust language configuration plus lightweight diagnostics.
  - `web/build/build-workbench.mjs`: build step that vendors
    `vscode-web@1.91.1` + CheerpX 1.2.8 and renders `web/index.html`
    with workbench config that preinstalls our extensions.
  - `web/build/index.template.html`: workbench entry template.
  - `web/tests/webvm-bus.test.mjs`, `web/tests/cheerpx-bridge.test.mjs`:
    additional unit tests; total `node --test` count is now 26.
  - Service worker now caches glue assets and synthesizes COOP/COEP +
    CORP headers on same-origin assets.
  - `.github/workflows/pages.yml` runs the build step before uploading
    the Pages artifact.

### Changed
- `web/index.html` is now the workbench entry document. It renders a
  boot overlay with a five-step status (shell, shim, CheerpX, VM, VS
  Code) that resolves once the workbench mounts, then fades out.

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.

### Added
- JS-side workspace store (`web/glue/workspace-fs.js`) backed by
  IndexedDB. The `webvm:` `FileSystemProvider` now reads/writes from
  this store so the Explorer populates immediately on page load — the
  user sees `hello_world.rs`, `hello/Cargo.toml`, `hello/src/main.rs`,
  and `README.md` the moment VS Code mounts, instead of waiting 30+
  seconds for CheerpX to finish booting (issue #2 screenshot feedback).
- Two-stage bus: a workspace-only methods table serves `fs.*` requests
  while CheerpX is still loading; once the VM finishes booting, the
  bus hot-swaps to the full table that adds `proc.*` (terminal) and
  `cargo.*` support. Implemented via `setMethods` on the bus server so
  the swap happens without registering a duplicate message listener
  (which would double-respond to every request).
- `webvm-server.js` now mirrors the JS-side workspace into the guest's
  `/workspace/` directory using `cat <<EOF` heredocs sent to the
  persistent bash session. After priming, the terminal lands at
  `/workspace` and runs `ls -la` so the populated directory is visible
  immediately — exactly the "ls where hello_world.rs is visible"
  feedback from the user.
- Auto-open `hello_world.rs` on extension activation. The webvm-host
  extension's `activate()` now calls `vscode.window.showTextDocument`
  on `webvm:/workspace/hello_world.rs`, falling back to
  `hello/src/main.rs` and `README.md` if the user has deleted earlier
  files (their edits persist in IndexedDB across sessions).
- `disk-image.yml` workflow now auto-publishes `rust-alpine.ext2` to
  the `disk-latest` rolling release tag on every push to main. The
  `web/disk/manifest.json` warm URL points to that release, so the
  Pages site picks up the freshest Alpine + Rust image without manual
  intervention.

### Changed
- `web/disk/manifest.json` warm URL now resolves to
  `https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2`
  (was `null`).
- `cheerpx-bridge.js`'s `bootLinux()` now falls back to the public
  WebVM Debian image if the warm `CloudDevice.create()` call fails —
  this keeps the workbench coming up cleanly during the brief window
  between merging this PR and the disk-image workflow finishing on
  main. The disk URL probe also uses `mode: 'no-cors'` to keep CORS
  errors out of the devtools console while we're falling back.
- Terminal banner is now a single clean status pane: "Booting Linux
  VM…" → VM-stage updates → "Linux VM ready ✓" → "Workspace mirrored
  to /workspace — try `cargo run` in /workspace/hello", followed by
  the actual `ls -la /workspace` output. The previous flow echoed raw
  `cd` commands and surfaced `mesg: ttyname failed` noise from
  /etc/profile.d scripts.

### Fixed
- Explorer no longer shows an empty `workspace` with a warning icon
  while CheerpX is booting; the JS-side store always serves `fs.stat`
  / `fs.readDir` synchronously off IndexedDB.
- Issue #2 screenshot feedback ("no hello_world.rs in file browser, it
  should be as in user's home folder"): hello_world.rs is now visible
  AND pre-opened on first paint.
- Issue #2 screenshot feedback ("terminal shows lots of errors"): the
  prime script disables echo while heredocs stream, then `clear`s and
  runs `ls -la /workspace` so the user lands in a clean terminal with
  the populated directory listing.

### Fixed
- Terminal staircase indentation in the WebVM bash pane (issue #2 boot
  screenshot feedback). Bash inside CheerpX writes through
  `cx.setCustomConsole`, which is not a kernel TTY: there is no ONLCR
  mapping, so each newline arrives as a bare `\n`. VS Code's
  Pseudoterminal API (xterm.js underneath) requires `\r\n` — without the
  carriage return the cursor only moved down, not back to column 0,
  producing the visible staircase in the previous boot screenshots.
  `web/glue/webvm-server.js` now runs every stdout chunk through
  `createLfToCrlfNormaliser()` from `web/glue/terminal-stream.js` before
  broadcasting `proc.stdout`. The normaliser is stateful so a chunk
  boundary that splits an existing `\r\n` (CheerpX delivers `foo\r` in
  one chunk, `\nbar` in the next) does not produce `\r\r\n`. Existing
  CRLF passes through unchanged; bare `\r` (cargo's progress meter) is
  preserved.

### Added
- `web/glue/terminal-stream.js` with `createLfToCrlfNormaliser()` and
  the one-shot `lfToCrlf()` convenience used by the page-side WebVM
  server.
- `web/tests/terminal-stream.test.mjs` — eight unit tests covering
  every newline shape (lone LF, CRLF, bare CR, ANSI control sequences,
  empty input, the exact `ls -la /workspace` repro from the screenshot,
  and chunk boundaries split mid-CRLF).
- `web/tests/webvm-server.test.mjs` — four integration tests with a
  fake CheerpX handle, asserting that stdout written by the engine is
  normalised on the wire, vt != 1 channels are still filtered, and the
  in-memory bus transport stays sane.

### Changed
- `web/glue/webvm-server.js` now uses a streaming `TextDecoder`
  (`stream: true`) for stdout, so multi-byte UTF-8 split across CheerpX
  writes no longer decodes to U+FFFD before reaching the terminal.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).

### Fixed
- Fixed GitHub Pages warm-disk boot failures by staging the release-hosted Rust ext2 image into same-origin CheerpX GitHubDevice chunks and selecting the correct CheerpX block device at runtime.

### Fixed
- Kept WebVM workspace priming and editor-save mirroring out of the
  visible terminal by staging temporary CheerpX `/data` scripts instead
  of typing setup heredocs into the interactive bash session.

### Documentation
- Replaced the issue #11 case-study placeholder with terminal-noise
  evidence, root-cause analysis, online research, and verification logs.

# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.

### Fixed
- The deployed GitHub Pages workbench could not run `tree` or `cargo run`
  inside the in-browser terminal (issue #15). The CheerpX 1.2.11 runtime
  the project shipped emitted `TypeError: Cannot read properties of
  undefined (reading 'a1')` four times during Linux boot and failed
  `cx.run` with `CheerpException: Program exited with code 71`. Bumped
  the vendored runtime to **CheerpX 1.3.0** in `web/build/build-workbench.mjs`,
  `web/glue/cheerpx-bridge.js` (runtime version constant), and
  `web/sw.js` (cache key) — Linux now reaches `vmPhase: 'ready'` and
  `cx.run` returns `status: 0` for `tree --version` and the prebuilt
  `/workspace/target/release/hello` binary.
- `web/build/dev-server.mjs` now redirects `/rust-web-box` → `/rust-web-box/`
  when serving with a base prefix. Mirrors GitHub Pages canonicalisation
  so the same URL shape resolves the same way locally and on Pages.
- `globalThis.__rustWebBox.vmPhase` now reaches `'ready'`. Previously
  `boot.js` only forwarded phases out of `cheerpx-bridge`'s `onProgress`
  hook, which stops at `'starting Linux'`. The terminal `'ready'` phase
  is emitted from inside `web/glue/webvm-server.js` and was only ever
  visible on the BroadcastChannel — never on the page-level shim. The
  e2e harness keys `vmPhase === 'ready'` on that shim, so without this
  fix the local-e2e CI job would deadlock and time out at 180s waiting
  for a transition that could never happen. `startWebVMServer` now
  accepts an `onPhase` callback and `boot.js` threads it through a
  single `setPhase` helper that's the only thing that mutates `vmPhase`.

### Added
- `web/tests/helpers/cheerpx-page-harness.mjs` — reusable browser
  harness around [`browser-commander`](https://github.com/link-foundation/browser-commander).
  Wraps Chromium launch, COOP/COEP-aware dev-server boot, stage-1 shim
  wait, stage-2 Linux wait, and `cx.run` invocation. On either-stage
  timeout the thrown error is enriched with an in-page snapshot
  (`vmPhase`, has-vm/workspace/shim flags, recorded `vm.boot` history),
  the last 30 console messages, captured `console.error`/`pageerror`
  output, and the list of failed network requests — so a CI failure
  surfaces the *cause* of the stall rather than just `Timeout Xms
  exceeded`.
- `web/tests/e2e/local-pages-e2e.test.mjs` — local end-to-end suite that
  drives the freshly built `web/` artifact. Asserts CheerpX 1.3.0 runs
  `tree --version`, lists `/workspace`, and executes the prebuilt hello
  binary without leaking `CheerpException` into `console.error`.
- `web/tests/e2e/live-pages-e2e.test.mjs` — post-deploy end-to-end suite
  that drives `RUST_WEB_BOX_LIVE_URL`. Same assertions, against the URL
  GitHub Pages just published.
- `web/tests/package.json` + lockfile — pin `browser-commander` and
  `playwright` versions for the e2e harness.
- `.github/workflows/pages.yml` gains a `local-e2e` job (PRs + main, runs
  before deploy) and an `e2e` job (post-deploy, drives the live URL).
  The `build` job now stages the warm rust-alpine disk on PRs as well,
  with `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release
  asset.
- `docs/case-studies/issue-15/` — full case study with timeline,
  evidence (Playwright console logs + screenshots + per-step `cx.run`
  output), upstream-issue tracking, and the verification plan.

### Fixed
- Reduced default rust-web-box console noise with exact VS Code Web startup filtering, lazy namespaced debug logging, source-map stub generation, and a polished WebVM boot banner.
- Removed the duplicate default workspace task seed that still pointed at the old `/workspace/hello` project path.

### Fixed
- Kept the VS Code web workspace and WebVM `/workspace` in sync for editor saves, guest terminal edits, and file tree refreshes.
- Restored explicit manual-save behavior in the seeded workspace so unsaved editor changes show the normal dirty state before Ctrl+S.

### Fixed
- Show WebVM `target/` build artifacts in the VS Code Explorer by syncing skipped target file metadata instead of pruning the directory.

### Fixed
- Stopped duplicating typed characters in the WebVM terminal: `makePseudoterminal` and `makeCargoPty` now dispose the prior `proc.stdout`/`proc.exit` bus subscribers before re-binding when VS Code re-`open()`-s the pty (issue #27).
- Restored prompt-time sync performance and unblocked `cargo run` reacting to editor saves: the bash sync hook prunes `/workspace/target` again while still emitting a single `D` frame for the directory itself so the VS Code Explorer keeps showing it (issue #27).
- Prevented the deletion sweep from wiping cached `target/` metadata stubs when the prompt-time scan intentionally skips them (issue #27).
- Avoided double-installation of the `__rwb_sync_from_guest` `PROMPT_COMMAND` if `/root/.bash_profile` is re-sourced.
- Guarded auto-creation of the "WebVM bash" terminal so a re-`activate()` does not spawn a duplicate panel.

### Added
- Opt-in `globalThis.__RWB_DEBUG_TERMINAL_STREAM` trace at both the bus emitter (`web/glue/webvm-server.js`) and the pty subscriber (`web/extensions/webvm-host/extension.js`) for fast attribution of any future duplicate-output regression.
- `web/tests/extension-pty-listeners.test.mjs`: source-shape regression tests asserting every `bus.on('proc.stdout', …)` site is paired with a prior `detachBusListeners()` call.
- `web/tests/e2e/local-pages-e2e.test.mjs`: new e2e test that drives the bus directly, types a sentinel via `proc.write`, and asserts the marker appears exactly twice in `proc.stdout` (one bash echo + one program output) — strictly less than the doubled stream the bug produced.
- `docs/case-studies/issue-27/`: full case study with timeline, root causes, evidence, online research, and verification.

### Fixed
- Refreshed `target/` metadata from the WebVM on demand when VS Code reads target directories, so Cargo build artifacts can be expanded in the Explorer without scanning the full build tree after every prompt.
- Saved dirty VS Code editor buffers before forwarding terminal Enter or Cargo task commands, so the next real `cargo run` uses the latest editor content.
- Marked saved Rust/Cargo inputs newer than existing target artifacts, with a fingerprint invalidation fallback, so warm-disk Cargo runs rebuild after browser-side edits.

### Added
- Regression coverage for scoped target snapshots, on-demand target directory refreshes, and edited-source `cargo run` e2e verification.

## Fixed

- Kept repeated plain `cargo run` real after editing `src/main.rs` by pre-baking the warm disk with a lean dev profile and applying matching Cargo profile environment only when the guest disk advertises that profile.
- Tightened browser e2e coverage so fixed disks must complete the edited second `cargo run` and print the edited output instead of accepting a compile-path timeout.
- Preserved writable filesystem headroom in the minimized warm disk so edited rebuilds have space for fresh debug artifacts.
- Kept the disk-image smoke test's edited rebuild isolated to a disposable image copy so staged Pages chunks still contain the default sample project.
- Forced Cargo freshness after browser saves by aging existing target metadata instead of relying on CheerpX's guest clock or deleting fingerprint files.

## Changed

- The disk-image workflow now smoke-tests an edited `cargo run`, stages the freshly built disk chunks locally, and runs browser e2e against that exact disk before publishing it.

## [0.11.0] - 2026-05-09

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

### Fixed
- Make release scripts resolve the publishable crate manifest when the repository root uses a Cargo workspace manifest.

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.

### Added
- Full MVP wiring for the in-browser Rust sandbox (issue #1):
  - `web/glue/cheerpx-bridge.js`: loads CheerpX (vendored, CDN fallback),
    boots a Linux VM against the public WebVM Debian image with an
    IndexedDB overlay for persistence.
  - `web/glue/webvm-bus.js`: request/response + event protocol over
    BroadcastChannel that connects the page (where CheerpX lives) to
    extension-host workers.
  - `web/glue/webvm-server.js`: page-side server that exposes the VM's
    file system and a process registry over the bus.
  - `web/extensions/webvm-host/`: VS Code Web extension implementing the
    `webvm:` `FileSystemProvider`, a `Pseudoterminal` over CheerpX bash,
    cargo task provider (`build`, `run`, `test`, `add`, `new`), and a
    status-bar Run button.
  - `web/extensions/rust-analyzer-web/`: VS Code Web extension stub that
    loads the rust-analyzer WASM artifact when bundled and contributes
    Rust language configuration plus lightweight diagnostics.
  - `web/build/build-workbench.mjs`: build step that vendors
    `vscode-web@1.91.1` + CheerpX 1.2.8 and renders `web/index.html`
    with workbench config that preinstalls our extensions.
  - `web/build/index.template.html`: workbench entry template.
  - `web/tests/webvm-bus.test.mjs`, `web/tests/cheerpx-bridge.test.mjs`:
    additional unit tests; total `node --test` count is now 26.
  - Service worker now caches glue assets and synthesizes COOP/COEP +
    CORP headers on same-origin assets.
  - `.github/workflows/pages.yml` runs the build step before uploading
    the Pages artifact.

### Changed
- `web/index.html` is now the workbench entry document. It renders a
  boot overlay with a five-step status (shell, shim, CheerpX, VM, VS
  Code) that resolves once the workbench mounts, then fades out.

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.

### Added
- JS-side workspace store (`web/glue/workspace-fs.js`) backed by
  IndexedDB. The `webvm:` `FileSystemProvider` now reads/writes from
  this store so the Explorer populates immediately on page load — the
  user sees `hello_world.rs`, `hello/Cargo.toml`, `hello/src/main.rs`,
  and `README.md` the moment VS Code mounts, instead of waiting 30+
  seconds for CheerpX to finish booting (issue #2 screenshot feedback).
- Two-stage bus: a workspace-only methods table serves `fs.*` requests
  while CheerpX is still loading; once the VM finishes booting, the
  bus hot-swaps to the full table that adds `proc.*` (terminal) and
  `cargo.*` support. Implemented via `setMethods` on the bus server so
  the swap happens without registering a duplicate message listener
  (which would double-respond to every request).
- `webvm-server.js` now mirrors the JS-side workspace into the guest's
  `/workspace/` directory using `cat <<EOF` heredocs sent to the
  persistent bash session. After priming, the terminal lands at
  `/workspace` and runs `ls -la` so the populated directory is visible
  immediately — exactly the "ls where hello_world.rs is visible"
  feedback from the user.
- Auto-open `hello_world.rs` on extension activation. The webvm-host
  extension's `activate()` now calls `vscode.window.showTextDocument`
  on `webvm:/workspace/hello_world.rs`, falling back to
  `hello/src/main.rs` and `README.md` if the user has deleted earlier
  files (their edits persist in IndexedDB across sessions).
- `disk-image.yml` workflow now auto-publishes `rust-alpine.ext2` to
  the `disk-latest` rolling release tag on every push to main. The
  `web/disk/manifest.json` warm URL points to that release, so the
  Pages site picks up the freshest Alpine + Rust image without manual
  intervention.

### Changed
- `web/disk/manifest.json` warm URL now resolves to
  `https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2`
  (was `null`).
- `cheerpx-bridge.js`'s `bootLinux()` now falls back to the public
  WebVM Debian image if the warm `CloudDevice.create()` call fails —
  this keeps the workbench coming up cleanly during the brief window
  between merging this PR and the disk-image workflow finishing on
  main. The disk URL probe also uses `mode: 'no-cors'` to keep CORS
  errors out of the devtools console while we're falling back.
- Terminal banner is now a single clean status pane: "Booting Linux
  VM…" → VM-stage updates → "Linux VM ready ✓" → "Workspace mirrored
  to /workspace — try `cargo run` in /workspace/hello", followed by
  the actual `ls -la /workspace` output. The previous flow echoed raw
  `cd` commands and surfaced `mesg: ttyname failed` noise from
  /etc/profile.d scripts.

### Fixed
- Explorer no longer shows an empty `workspace` with a warning icon
  while CheerpX is booting; the JS-side store always serves `fs.stat`
  / `fs.readDir` synchronously off IndexedDB.
- Issue #2 screenshot feedback ("no hello_world.rs in file browser, it
  should be as in user's home folder"): hello_world.rs is now visible
  AND pre-opened on first paint.
- Issue #2 screenshot feedback ("terminal shows lots of errors"): the
  prime script disables echo while heredocs stream, then `clear`s and
  runs `ls -la /workspace` so the user lands in a clean terminal with
  the populated directory listing.

### Fixed
- Terminal staircase indentation in the WebVM bash pane (issue #2 boot
  screenshot feedback). Bash inside CheerpX writes through
  `cx.setCustomConsole`, which is not a kernel TTY: there is no ONLCR
  mapping, so each newline arrives as a bare `\n`. VS Code's
  Pseudoterminal API (xterm.js underneath) requires `\r\n` — without the
  carriage return the cursor only moved down, not back to column 0,
  producing the visible staircase in the previous boot screenshots.
  `web/glue/webvm-server.js` now runs every stdout chunk through
  `createLfToCrlfNormaliser()` from `web/glue/terminal-stream.js` before
  broadcasting `proc.stdout`. The normaliser is stateful so a chunk
  boundary that splits an existing `\r\n` (CheerpX delivers `foo\r` in
  one chunk, `\nbar` in the next) does not produce `\r\r\n`. Existing
  CRLF passes through unchanged; bare `\r` (cargo's progress meter) is
  preserved.

### Added
- `web/glue/terminal-stream.js` with `createLfToCrlfNormaliser()` and
  the one-shot `lfToCrlf()` convenience used by the page-side WebVM
  server.
- `web/tests/terminal-stream.test.mjs` — eight unit tests covering
  every newline shape (lone LF, CRLF, bare CR, ANSI control sequences,
  empty input, the exact `ls -la /workspace` repro from the screenshot,
  and chunk boundaries split mid-CRLF).
- `web/tests/webvm-server.test.mjs` — four integration tests with a
  fake CheerpX handle, asserting that stdout written by the engine is
  normalised on the wire, vt != 1 channels are still filtered, and the
  in-memory bus transport stays sane.

### Changed
- `web/glue/webvm-server.js` now uses a streaming `TextDecoder`
  (`stream: true`) for stdout, so multi-byte UTF-8 split across CheerpX
  writes no longer decodes to U+FFFD before reaching the terminal.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).

### Fixed
- Fixed GitHub Pages warm-disk boot failures by staging the release-hosted Rust ext2 image into same-origin CheerpX GitHubDevice chunks and selecting the correct CheerpX block device at runtime.

### Fixed
- Kept WebVM workspace priming and editor-save mirroring out of the
  visible terminal by staging temporary CheerpX `/data` scripts instead
  of typing setup heredocs into the interactive bash session.

### Documentation
- Replaced the issue #11 case-study placeholder with terminal-noise
  evidence, root-cause analysis, online research, and verification logs.

# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.

### Fixed
- The deployed GitHub Pages workbench could not run `tree` or `cargo run`
  inside the in-browser terminal (issue #15). The CheerpX 1.2.11 runtime
  the project shipped emitted `TypeError: Cannot read properties of
  undefined (reading 'a1')` four times during Linux boot and failed
  `cx.run` with `CheerpException: Program exited with code 71`. Bumped
  the vendored runtime to **CheerpX 1.3.0** in `web/build/build-workbench.mjs`,
  `web/glue/cheerpx-bridge.js` (runtime version constant), and
  `web/sw.js` (cache key) — Linux now reaches `vmPhase: 'ready'` and
  `cx.run` returns `status: 0` for `tree --version` and the prebuilt
  `/workspace/target/release/hello` binary.
- `web/build/dev-server.mjs` now redirects `/rust-web-box` → `/rust-web-box/`
  when serving with a base prefix. Mirrors GitHub Pages canonicalisation
  so the same URL shape resolves the same way locally and on Pages.
- `globalThis.__rustWebBox.vmPhase` now reaches `'ready'`. Previously
  `boot.js` only forwarded phases out of `cheerpx-bridge`'s `onProgress`
  hook, which stops at `'starting Linux'`. The terminal `'ready'` phase
  is emitted from inside `web/glue/webvm-server.js` and was only ever
  visible on the BroadcastChannel — never on the page-level shim. The
  e2e harness keys `vmPhase === 'ready'` on that shim, so without this
  fix the local-e2e CI job would deadlock and time out at 180s waiting
  for a transition that could never happen. `startWebVMServer` now
  accepts an `onPhase` callback and `boot.js` threads it through a
  single `setPhase` helper that's the only thing that mutates `vmPhase`.

### Added
- `web/tests/helpers/cheerpx-page-harness.mjs` — reusable browser
  harness around [`browser-commander`](https://github.com/link-foundation/browser-commander).
  Wraps Chromium launch, COOP/COEP-aware dev-server boot, stage-1 shim
  wait, stage-2 Linux wait, and `cx.run` invocation. On either-stage
  timeout the thrown error is enriched with an in-page snapshot
  (`vmPhase`, has-vm/workspace/shim flags, recorded `vm.boot` history),
  the last 30 console messages, captured `console.error`/`pageerror`
  output, and the list of failed network requests — so a CI failure
  surfaces the *cause* of the stall rather than just `Timeout Xms
  exceeded`.
- `web/tests/e2e/local-pages-e2e.test.mjs` — local end-to-end suite that
  drives the freshly built `web/` artifact. Asserts CheerpX 1.3.0 runs
  `tree --version`, lists `/workspace`, and executes the prebuilt hello
  binary without leaking `CheerpException` into `console.error`.
- `web/tests/e2e/live-pages-e2e.test.mjs` — post-deploy end-to-end suite
  that drives `RUST_WEB_BOX_LIVE_URL`. Same assertions, against the URL
  GitHub Pages just published.
- `web/tests/package.json` + lockfile — pin `browser-commander` and
  `playwright` versions for the e2e harness.
- `.github/workflows/pages.yml` gains a `local-e2e` job (PRs + main, runs
  before deploy) and an `e2e` job (post-deploy, drives the live URL).
  The `build` job now stages the warm rust-alpine disk on PRs as well,
  with `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release
  asset.
- `docs/case-studies/issue-15/` — full case study with timeline,
  evidence (Playwright console logs + screenshots + per-step `cx.run`
  output), upstream-issue tracking, and the verification plan.

### Fixed
- Reduced default rust-web-box console noise with exact VS Code Web startup filtering, lazy namespaced debug logging, source-map stub generation, and a polished WebVM boot banner.
- Removed the duplicate default workspace task seed that still pointed at the old `/workspace/hello` project path.

### Fixed
- Kept the VS Code web workspace and WebVM `/workspace` in sync for editor saves, guest terminal edits, and file tree refreshes.
- Restored explicit manual-save behavior in the seeded workspace so unsaved editor changes show the normal dirty state before Ctrl+S.

### Fixed
- Show WebVM `target/` build artifacts in the VS Code Explorer by syncing skipped target file metadata instead of pruning the directory.

### Fixed
- Stopped duplicating typed characters in the WebVM terminal: `makePseudoterminal` and `makeCargoPty` now dispose the prior `proc.stdout`/`proc.exit` bus subscribers before re-binding when VS Code re-`open()`-s the pty (issue #27).
- Restored prompt-time sync performance and unblocked `cargo run` reacting to editor saves: the bash sync hook prunes `/workspace/target` again while still emitting a single `D` frame for the directory itself so the VS Code Explorer keeps showing it (issue #27).
- Prevented the deletion sweep from wiping cached `target/` metadata stubs when the prompt-time scan intentionally skips them (issue #27).
- Avoided double-installation of the `__rwb_sync_from_guest` `PROMPT_COMMAND` if `/root/.bash_profile` is re-sourced.
- Guarded auto-creation of the "WebVM bash" terminal so a re-`activate()` does not spawn a duplicate panel.

### Added
- Opt-in `globalThis.__RWB_DEBUG_TERMINAL_STREAM` trace at both the bus emitter (`web/glue/webvm-server.js`) and the pty subscriber (`web/extensions/webvm-host/extension.js`) for fast attribution of any future duplicate-output regression.
- `web/tests/extension-pty-listeners.test.mjs`: source-shape regression tests asserting every `bus.on('proc.stdout', …)` site is paired with a prior `detachBusListeners()` call.
- `web/tests/e2e/local-pages-e2e.test.mjs`: new e2e test that drives the bus directly, types a sentinel via `proc.write`, and asserts the marker appears exactly twice in `proc.stdout` (one bash echo + one program output) — strictly less than the doubled stream the bug produced.
- `docs/case-studies/issue-27/`: full case study with timeline, root causes, evidence, online research, and verification.

### Fixed
- Refreshed `target/` metadata from the WebVM on demand when VS Code reads target directories, so Cargo build artifacts can be expanded in the Explorer without scanning the full build tree after every prompt.
- Saved dirty VS Code editor buffers before forwarding terminal Enter or Cargo task commands, so the next real `cargo run` uses the latest editor content.
- Marked saved Rust/Cargo inputs newer than existing target artifacts, with a fingerprint invalidation fallback, so warm-disk Cargo runs rebuild after browser-side edits.

### Added
- Regression coverage for scoped target snapshots, on-demand target directory refreshes, and edited-source `cargo run` e2e verification.

## [0.10.0] - 2026-05-09

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

### Fixed
- Make release scripts resolve the publishable crate manifest when the repository root uses a Cargo workspace manifest.

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.

### Added
- Full MVP wiring for the in-browser Rust sandbox (issue #1):
  - `web/glue/cheerpx-bridge.js`: loads CheerpX (vendored, CDN fallback),
    boots a Linux VM against the public WebVM Debian image with an
    IndexedDB overlay for persistence.
  - `web/glue/webvm-bus.js`: request/response + event protocol over
    BroadcastChannel that connects the page (where CheerpX lives) to
    extension-host workers.
  - `web/glue/webvm-server.js`: page-side server that exposes the VM's
    file system and a process registry over the bus.
  - `web/extensions/webvm-host/`: VS Code Web extension implementing the
    `webvm:` `FileSystemProvider`, a `Pseudoterminal` over CheerpX bash,
    cargo task provider (`build`, `run`, `test`, `add`, `new`), and a
    status-bar Run button.
  - `web/extensions/rust-analyzer-web/`: VS Code Web extension stub that
    loads the rust-analyzer WASM artifact when bundled and contributes
    Rust language configuration plus lightweight diagnostics.
  - `web/build/build-workbench.mjs`: build step that vendors
    `vscode-web@1.91.1` + CheerpX 1.2.8 and renders `web/index.html`
    with workbench config that preinstalls our extensions.
  - `web/build/index.template.html`: workbench entry template.
  - `web/tests/webvm-bus.test.mjs`, `web/tests/cheerpx-bridge.test.mjs`:
    additional unit tests; total `node --test` count is now 26.
  - Service worker now caches glue assets and synthesizes COOP/COEP +
    CORP headers on same-origin assets.
  - `.github/workflows/pages.yml` runs the build step before uploading
    the Pages artifact.

### Changed
- `web/index.html` is now the workbench entry document. It renders a
  boot overlay with a five-step status (shell, shim, CheerpX, VM, VS
  Code) that resolves once the workbench mounts, then fades out.

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.

### Added
- JS-side workspace store (`web/glue/workspace-fs.js`) backed by
  IndexedDB. The `webvm:` `FileSystemProvider` now reads/writes from
  this store so the Explorer populates immediately on page load — the
  user sees `hello_world.rs`, `hello/Cargo.toml`, `hello/src/main.rs`,
  and `README.md` the moment VS Code mounts, instead of waiting 30+
  seconds for CheerpX to finish booting (issue #2 screenshot feedback).
- Two-stage bus: a workspace-only methods table serves `fs.*` requests
  while CheerpX is still loading; once the VM finishes booting, the
  bus hot-swaps to the full table that adds `proc.*` (terminal) and
  `cargo.*` support. Implemented via `setMethods` on the bus server so
  the swap happens without registering a duplicate message listener
  (which would double-respond to every request).
- `webvm-server.js` now mirrors the JS-side workspace into the guest's
  `/workspace/` directory using `cat <<EOF` heredocs sent to the
  persistent bash session. After priming, the terminal lands at
  `/workspace` and runs `ls -la` so the populated directory is visible
  immediately — exactly the "ls where hello_world.rs is visible"
  feedback from the user.
- Auto-open `hello_world.rs` on extension activation. The webvm-host
  extension's `activate()` now calls `vscode.window.showTextDocument`
  on `webvm:/workspace/hello_world.rs`, falling back to
  `hello/src/main.rs` and `README.md` if the user has deleted earlier
  files (their edits persist in IndexedDB across sessions).
- `disk-image.yml` workflow now auto-publishes `rust-alpine.ext2` to
  the `disk-latest` rolling release tag on every push to main. The
  `web/disk/manifest.json` warm URL points to that release, so the
  Pages site picks up the freshest Alpine + Rust image without manual
  intervention.

### Changed
- `web/disk/manifest.json` warm URL now resolves to
  `https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2`
  (was `null`).
- `cheerpx-bridge.js`'s `bootLinux()` now falls back to the public
  WebVM Debian image if the warm `CloudDevice.create()` call fails —
  this keeps the workbench coming up cleanly during the brief window
  between merging this PR and the disk-image workflow finishing on
  main. The disk URL probe also uses `mode: 'no-cors'` to keep CORS
  errors out of the devtools console while we're falling back.
- Terminal banner is now a single clean status pane: "Booting Linux
  VM…" → VM-stage updates → "Linux VM ready ✓" → "Workspace mirrored
  to /workspace — try `cargo run` in /workspace/hello", followed by
  the actual `ls -la /workspace` output. The previous flow echoed raw
  `cd` commands and surfaced `mesg: ttyname failed` noise from
  /etc/profile.d scripts.

### Fixed
- Explorer no longer shows an empty `workspace` with a warning icon
  while CheerpX is booting; the JS-side store always serves `fs.stat`
  / `fs.readDir` synchronously off IndexedDB.
- Issue #2 screenshot feedback ("no hello_world.rs in file browser, it
  should be as in user's home folder"): hello_world.rs is now visible
  AND pre-opened on first paint.
- Issue #2 screenshot feedback ("terminal shows lots of errors"): the
  prime script disables echo while heredocs stream, then `clear`s and
  runs `ls -la /workspace` so the user lands in a clean terminal with
  the populated directory listing.

### Fixed
- Terminal staircase indentation in the WebVM bash pane (issue #2 boot
  screenshot feedback). Bash inside CheerpX writes through
  `cx.setCustomConsole`, which is not a kernel TTY: there is no ONLCR
  mapping, so each newline arrives as a bare `\n`. VS Code's
  Pseudoterminal API (xterm.js underneath) requires `\r\n` — without the
  carriage return the cursor only moved down, not back to column 0,
  producing the visible staircase in the previous boot screenshots.
  `web/glue/webvm-server.js` now runs every stdout chunk through
  `createLfToCrlfNormaliser()` from `web/glue/terminal-stream.js` before
  broadcasting `proc.stdout`. The normaliser is stateful so a chunk
  boundary that splits an existing `\r\n` (CheerpX delivers `foo\r` in
  one chunk, `\nbar` in the next) does not produce `\r\r\n`. Existing
  CRLF passes through unchanged; bare `\r` (cargo's progress meter) is
  preserved.

### Added
- `web/glue/terminal-stream.js` with `createLfToCrlfNormaliser()` and
  the one-shot `lfToCrlf()` convenience used by the page-side WebVM
  server.
- `web/tests/terminal-stream.test.mjs` — eight unit tests covering
  every newline shape (lone LF, CRLF, bare CR, ANSI control sequences,
  empty input, the exact `ls -la /workspace` repro from the screenshot,
  and chunk boundaries split mid-CRLF).
- `web/tests/webvm-server.test.mjs` — four integration tests with a
  fake CheerpX handle, asserting that stdout written by the engine is
  normalised on the wire, vt != 1 channels are still filtered, and the
  in-memory bus transport stays sane.

### Changed
- `web/glue/webvm-server.js` now uses a streaming `TextDecoder`
  (`stream: true`) for stdout, so multi-byte UTF-8 split across CheerpX
  writes no longer decodes to U+FFFD before reaching the terminal.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).

### Fixed
- Fixed GitHub Pages warm-disk boot failures by staging the release-hosted Rust ext2 image into same-origin CheerpX GitHubDevice chunks and selecting the correct CheerpX block device at runtime.

### Fixed
- Kept WebVM workspace priming and editor-save mirroring out of the
  visible terminal by staging temporary CheerpX `/data` scripts instead
  of typing setup heredocs into the interactive bash session.

### Documentation
- Replaced the issue #11 case-study placeholder with terminal-noise
  evidence, root-cause analysis, online research, and verification logs.

# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.

### Fixed
- The deployed GitHub Pages workbench could not run `tree` or `cargo run`
  inside the in-browser terminal (issue #15). The CheerpX 1.2.11 runtime
  the project shipped emitted `TypeError: Cannot read properties of
  undefined (reading 'a1')` four times during Linux boot and failed
  `cx.run` with `CheerpException: Program exited with code 71`. Bumped
  the vendored runtime to **CheerpX 1.3.0** in `web/build/build-workbench.mjs`,
  `web/glue/cheerpx-bridge.js` (runtime version constant), and
  `web/sw.js` (cache key) — Linux now reaches `vmPhase: 'ready'` and
  `cx.run` returns `status: 0` for `tree --version` and the prebuilt
  `/workspace/target/release/hello` binary.
- `web/build/dev-server.mjs` now redirects `/rust-web-box` → `/rust-web-box/`
  when serving with a base prefix. Mirrors GitHub Pages canonicalisation
  so the same URL shape resolves the same way locally and on Pages.
- `globalThis.__rustWebBox.vmPhase` now reaches `'ready'`. Previously
  `boot.js` only forwarded phases out of `cheerpx-bridge`'s `onProgress`
  hook, which stops at `'starting Linux'`. The terminal `'ready'` phase
  is emitted from inside `web/glue/webvm-server.js` and was only ever
  visible on the BroadcastChannel — never on the page-level shim. The
  e2e harness keys `vmPhase === 'ready'` on that shim, so without this
  fix the local-e2e CI job would deadlock and time out at 180s waiting
  for a transition that could never happen. `startWebVMServer` now
  accepts an `onPhase` callback and `boot.js` threads it through a
  single `setPhase` helper that's the only thing that mutates `vmPhase`.

### Added
- `web/tests/helpers/cheerpx-page-harness.mjs` — reusable browser
  harness around [`browser-commander`](https://github.com/link-foundation/browser-commander).
  Wraps Chromium launch, COOP/COEP-aware dev-server boot, stage-1 shim
  wait, stage-2 Linux wait, and `cx.run` invocation. On either-stage
  timeout the thrown error is enriched with an in-page snapshot
  (`vmPhase`, has-vm/workspace/shim flags, recorded `vm.boot` history),
  the last 30 console messages, captured `console.error`/`pageerror`
  output, and the list of failed network requests — so a CI failure
  surfaces the *cause* of the stall rather than just `Timeout Xms
  exceeded`.
- `web/tests/e2e/local-pages-e2e.test.mjs` — local end-to-end suite that
  drives the freshly built `web/` artifact. Asserts CheerpX 1.3.0 runs
  `tree --version`, lists `/workspace`, and executes the prebuilt hello
  binary without leaking `CheerpException` into `console.error`.
- `web/tests/e2e/live-pages-e2e.test.mjs` — post-deploy end-to-end suite
  that drives `RUST_WEB_BOX_LIVE_URL`. Same assertions, against the URL
  GitHub Pages just published.
- `web/tests/package.json` + lockfile — pin `browser-commander` and
  `playwright` versions for the e2e harness.
- `.github/workflows/pages.yml` gains a `local-e2e` job (PRs + main, runs
  before deploy) and an `e2e` job (post-deploy, drives the live URL).
  The `build` job now stages the warm rust-alpine disk on PRs as well,
  with `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release
  asset.
- `docs/case-studies/issue-15/` — full case study with timeline,
  evidence (Playwright console logs + screenshots + per-step `cx.run`
  output), upstream-issue tracking, and the verification plan.

### Fixed
- Reduced default rust-web-box console noise with exact VS Code Web startup filtering, lazy namespaced debug logging, source-map stub generation, and a polished WebVM boot banner.
- Removed the duplicate default workspace task seed that still pointed at the old `/workspace/hello` project path.

### Fixed
- Kept the VS Code web workspace and WebVM `/workspace` in sync for editor saves, guest terminal edits, and file tree refreshes.
- Restored explicit manual-save behavior in the seeded workspace so unsaved editor changes show the normal dirty state before Ctrl+S.

### Fixed
- Show WebVM `target/` build artifacts in the VS Code Explorer by syncing skipped target file metadata instead of pruning the directory.

### Fixed
- Stopped duplicating typed characters in the WebVM terminal: `makePseudoterminal` and `makeCargoPty` now dispose the prior `proc.stdout`/`proc.exit` bus subscribers before re-binding when VS Code re-`open()`-s the pty (issue #27).
- Restored prompt-time sync performance and unblocked `cargo run` reacting to editor saves: the bash sync hook prunes `/workspace/target` again while still emitting a single `D` frame for the directory itself so the VS Code Explorer keeps showing it (issue #27).
- Prevented the deletion sweep from wiping cached `target/` metadata stubs when the prompt-time scan intentionally skips them (issue #27).
- Avoided double-installation of the `__rwb_sync_from_guest` `PROMPT_COMMAND` if `/root/.bash_profile` is re-sourced.
- Guarded auto-creation of the "WebVM bash" terminal so a re-`activate()` does not spawn a duplicate panel.

### Added
- Opt-in `globalThis.__RWB_DEBUG_TERMINAL_STREAM` trace at both the bus emitter (`web/glue/webvm-server.js`) and the pty subscriber (`web/extensions/webvm-host/extension.js`) for fast attribution of any future duplicate-output regression.
- `web/tests/extension-pty-listeners.test.mjs`: source-shape regression tests asserting every `bus.on('proc.stdout', …)` site is paired with a prior `detachBusListeners()` call.
- `web/tests/e2e/local-pages-e2e.test.mjs`: new e2e test that drives the bus directly, types a sentinel via `proc.write`, and asserts the marker appears exactly twice in `proc.stdout` (one bash echo + one program output) — strictly less than the doubled stream the bug produced.
- `docs/case-studies/issue-27/`: full case study with timeline, root causes, evidence, online research, and verification.

## [0.9.0] - 2026-05-09

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

### Fixed
- Make release scripts resolve the publishable crate manifest when the repository root uses a Cargo workspace manifest.

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.

### Added
- Full MVP wiring for the in-browser Rust sandbox (issue #1):
  - `web/glue/cheerpx-bridge.js`: loads CheerpX (vendored, CDN fallback),
    boots a Linux VM against the public WebVM Debian image with an
    IndexedDB overlay for persistence.
  - `web/glue/webvm-bus.js`: request/response + event protocol over
    BroadcastChannel that connects the page (where CheerpX lives) to
    extension-host workers.
  - `web/glue/webvm-server.js`: page-side server that exposes the VM's
    file system and a process registry over the bus.
  - `web/extensions/webvm-host/`: VS Code Web extension implementing the
    `webvm:` `FileSystemProvider`, a `Pseudoterminal` over CheerpX bash,
    cargo task provider (`build`, `run`, `test`, `add`, `new`), and a
    status-bar Run button.
  - `web/extensions/rust-analyzer-web/`: VS Code Web extension stub that
    loads the rust-analyzer WASM artifact when bundled and contributes
    Rust language configuration plus lightweight diagnostics.
  - `web/build/build-workbench.mjs`: build step that vendors
    `vscode-web@1.91.1` + CheerpX 1.2.8 and renders `web/index.html`
    with workbench config that preinstalls our extensions.
  - `web/build/index.template.html`: workbench entry template.
  - `web/tests/webvm-bus.test.mjs`, `web/tests/cheerpx-bridge.test.mjs`:
    additional unit tests; total `node --test` count is now 26.
  - Service worker now caches glue assets and synthesizes COOP/COEP +
    CORP headers on same-origin assets.
  - `.github/workflows/pages.yml` runs the build step before uploading
    the Pages artifact.

### Changed
- `web/index.html` is now the workbench entry document. It renders a
  boot overlay with a five-step status (shell, shim, CheerpX, VM, VS
  Code) that resolves once the workbench mounts, then fades out.

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.

### Added
- JS-side workspace store (`web/glue/workspace-fs.js`) backed by
  IndexedDB. The `webvm:` `FileSystemProvider` now reads/writes from
  this store so the Explorer populates immediately on page load — the
  user sees `hello_world.rs`, `hello/Cargo.toml`, `hello/src/main.rs`,
  and `README.md` the moment VS Code mounts, instead of waiting 30+
  seconds for CheerpX to finish booting (issue #2 screenshot feedback).
- Two-stage bus: a workspace-only methods table serves `fs.*` requests
  while CheerpX is still loading; once the VM finishes booting, the
  bus hot-swaps to the full table that adds `proc.*` (terminal) and
  `cargo.*` support. Implemented via `setMethods` on the bus server so
  the swap happens without registering a duplicate message listener
  (which would double-respond to every request).
- `webvm-server.js` now mirrors the JS-side workspace into the guest's
  `/workspace/` directory using `cat <<EOF` heredocs sent to the
  persistent bash session. After priming, the terminal lands at
  `/workspace` and runs `ls -la` so the populated directory is visible
  immediately — exactly the "ls where hello_world.rs is visible"
  feedback from the user.
- Auto-open `hello_world.rs` on extension activation. The webvm-host
  extension's `activate()` now calls `vscode.window.showTextDocument`
  on `webvm:/workspace/hello_world.rs`, falling back to
  `hello/src/main.rs` and `README.md` if the user has deleted earlier
  files (their edits persist in IndexedDB across sessions).
- `disk-image.yml` workflow now auto-publishes `rust-alpine.ext2` to
  the `disk-latest` rolling release tag on every push to main. The
  `web/disk/manifest.json` warm URL points to that release, so the
  Pages site picks up the freshest Alpine + Rust image without manual
  intervention.

### Changed
- `web/disk/manifest.json` warm URL now resolves to
  `https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2`
  (was `null`).
- `cheerpx-bridge.js`'s `bootLinux()` now falls back to the public
  WebVM Debian image if the warm `CloudDevice.create()` call fails —
  this keeps the workbench coming up cleanly during the brief window
  between merging this PR and the disk-image workflow finishing on
  main. The disk URL probe also uses `mode: 'no-cors'` to keep CORS
  errors out of the devtools console while we're falling back.
- Terminal banner is now a single clean status pane: "Booting Linux
  VM…" → VM-stage updates → "Linux VM ready ✓" → "Workspace mirrored
  to /workspace — try `cargo run` in /workspace/hello", followed by
  the actual `ls -la /workspace` output. The previous flow echoed raw
  `cd` commands and surfaced `mesg: ttyname failed` noise from
  /etc/profile.d scripts.

### Fixed
- Explorer no longer shows an empty `workspace` with a warning icon
  while CheerpX is booting; the JS-side store always serves `fs.stat`
  / `fs.readDir` synchronously off IndexedDB.
- Issue #2 screenshot feedback ("no hello_world.rs in file browser, it
  should be as in user's home folder"): hello_world.rs is now visible
  AND pre-opened on first paint.
- Issue #2 screenshot feedback ("terminal shows lots of errors"): the
  prime script disables echo while heredocs stream, then `clear`s and
  runs `ls -la /workspace` so the user lands in a clean terminal with
  the populated directory listing.

### Fixed
- Terminal staircase indentation in the WebVM bash pane (issue #2 boot
  screenshot feedback). Bash inside CheerpX writes through
  `cx.setCustomConsole`, which is not a kernel TTY: there is no ONLCR
  mapping, so each newline arrives as a bare `\n`. VS Code's
  Pseudoterminal API (xterm.js underneath) requires `\r\n` — without the
  carriage return the cursor only moved down, not back to column 0,
  producing the visible staircase in the previous boot screenshots.
  `web/glue/webvm-server.js` now runs every stdout chunk through
  `createLfToCrlfNormaliser()` from `web/glue/terminal-stream.js` before
  broadcasting `proc.stdout`. The normaliser is stateful so a chunk
  boundary that splits an existing `\r\n` (CheerpX delivers `foo\r` in
  one chunk, `\nbar` in the next) does not produce `\r\r\n`. Existing
  CRLF passes through unchanged; bare `\r` (cargo's progress meter) is
  preserved.

### Added
- `web/glue/terminal-stream.js` with `createLfToCrlfNormaliser()` and
  the one-shot `lfToCrlf()` convenience used by the page-side WebVM
  server.
- `web/tests/terminal-stream.test.mjs` — eight unit tests covering
  every newline shape (lone LF, CRLF, bare CR, ANSI control sequences,
  empty input, the exact `ls -la /workspace` repro from the screenshot,
  and chunk boundaries split mid-CRLF).
- `web/tests/webvm-server.test.mjs` — four integration tests with a
  fake CheerpX handle, asserting that stdout written by the engine is
  normalised on the wire, vt != 1 channels are still filtered, and the
  in-memory bus transport stays sane.

### Changed
- `web/glue/webvm-server.js` now uses a streaming `TextDecoder`
  (`stream: true`) for stdout, so multi-byte UTF-8 split across CheerpX
  writes no longer decodes to U+FFFD before reaching the terminal.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).

### Fixed
- Fixed GitHub Pages warm-disk boot failures by staging the release-hosted Rust ext2 image into same-origin CheerpX GitHubDevice chunks and selecting the correct CheerpX block device at runtime.

### Fixed
- Kept WebVM workspace priming and editor-save mirroring out of the
  visible terminal by staging temporary CheerpX `/data` scripts instead
  of typing setup heredocs into the interactive bash session.

### Documentation
- Replaced the issue #11 case-study placeholder with terminal-noise
  evidence, root-cause analysis, online research, and verification logs.

# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.

### Fixed
- The deployed GitHub Pages workbench could not run `tree` or `cargo run`
  inside the in-browser terminal (issue #15). The CheerpX 1.2.11 runtime
  the project shipped emitted `TypeError: Cannot read properties of
  undefined (reading 'a1')` four times during Linux boot and failed
  `cx.run` with `CheerpException: Program exited with code 71`. Bumped
  the vendored runtime to **CheerpX 1.3.0** in `web/build/build-workbench.mjs`,
  `web/glue/cheerpx-bridge.js` (runtime version constant), and
  `web/sw.js` (cache key) — Linux now reaches `vmPhase: 'ready'` and
  `cx.run` returns `status: 0` for `tree --version` and the prebuilt
  `/workspace/target/release/hello` binary.
- `web/build/dev-server.mjs` now redirects `/rust-web-box` → `/rust-web-box/`
  when serving with a base prefix. Mirrors GitHub Pages canonicalisation
  so the same URL shape resolves the same way locally and on Pages.
- `globalThis.__rustWebBox.vmPhase` now reaches `'ready'`. Previously
  `boot.js` only forwarded phases out of `cheerpx-bridge`'s `onProgress`
  hook, which stops at `'starting Linux'`. The terminal `'ready'` phase
  is emitted from inside `web/glue/webvm-server.js` and was only ever
  visible on the BroadcastChannel — never on the page-level shim. The
  e2e harness keys `vmPhase === 'ready'` on that shim, so without this
  fix the local-e2e CI job would deadlock and time out at 180s waiting
  for a transition that could never happen. `startWebVMServer` now
  accepts an `onPhase` callback and `boot.js` threads it through a
  single `setPhase` helper that's the only thing that mutates `vmPhase`.

### Added
- `web/tests/helpers/cheerpx-page-harness.mjs` — reusable browser
  harness around [`browser-commander`](https://github.com/link-foundation/browser-commander).
  Wraps Chromium launch, COOP/COEP-aware dev-server boot, stage-1 shim
  wait, stage-2 Linux wait, and `cx.run` invocation. On either-stage
  timeout the thrown error is enriched with an in-page snapshot
  (`vmPhase`, has-vm/workspace/shim flags, recorded `vm.boot` history),
  the last 30 console messages, captured `console.error`/`pageerror`
  output, and the list of failed network requests — so a CI failure
  surfaces the *cause* of the stall rather than just `Timeout Xms
  exceeded`.
- `web/tests/e2e/local-pages-e2e.test.mjs` — local end-to-end suite that
  drives the freshly built `web/` artifact. Asserts CheerpX 1.3.0 runs
  `tree --version`, lists `/workspace`, and executes the prebuilt hello
  binary without leaking `CheerpException` into `console.error`.
- `web/tests/e2e/live-pages-e2e.test.mjs` — post-deploy end-to-end suite
  that drives `RUST_WEB_BOX_LIVE_URL`. Same assertions, against the URL
  GitHub Pages just published.
- `web/tests/package.json` + lockfile — pin `browser-commander` and
  `playwright` versions for the e2e harness.
- `.github/workflows/pages.yml` gains a `local-e2e` job (PRs + main, runs
  before deploy) and an `e2e` job (post-deploy, drives the live URL).
  The `build` job now stages the warm rust-alpine disk on PRs as well,
  with `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release
  asset.
- `docs/case-studies/issue-15/` — full case study with timeline,
  evidence (Playwright console logs + screenshots + per-step `cx.run`
  output), upstream-issue tracking, and the verification plan.

### Fixed
- Reduced default rust-web-box console noise with exact VS Code Web startup filtering, lazy namespaced debug logging, source-map stub generation, and a polished WebVM boot banner.
- Removed the duplicate default workspace task seed that still pointed at the old `/workspace/hello` project path.

### Fixed
- Kept the VS Code web workspace and WebVM `/workspace` in sync for editor saves, guest terminal edits, and file tree refreshes.
- Restored explicit manual-save behavior in the seeded workspace so unsaved editor changes show the normal dirty state before Ctrl+S.

### Fixed
- Show WebVM `target/` build artifacts in the VS Code Explorer by syncing skipped target file metadata instead of pruning the directory.

## [0.8.0] - 2026-05-02

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

### Fixed
- Make release scripts resolve the publishable crate manifest when the repository root uses a Cargo workspace manifest.

### Added
- Foundation slice for the in-browser Rust sandbox (issue #1):
  - `web/` static-site root with boot shell, service worker, and placeholder
    directories for the VS Code Web bundle, CheerpX runtime, web extensions,
    and disk image.
  - `web/glue/network-shim.js`: page-level shim that mediates WebVM network
    traffic — direct fetch for `static.crates.io` / `crates.io`, sequential
    CORS-proxy fallback for `index.crates.io`, and explicit blocking
    elsewhere.
  - `web/tests/network-shim.test.mjs`: 11 tests covering routing, fallback
    ordering, error aggregation, and init-forwarding (`node --test`).
  - `.github/workflows/pages.yml`: runs the shim tests, packages `web/`,
    and deploys to GitHub Pages on push to `main`.
  - `docs/architecture.md`: status of every component vs the issue's
    acceptance criteria.

### Added
- Full MVP wiring for the in-browser Rust sandbox (issue #1):
  - `web/glue/cheerpx-bridge.js`: loads CheerpX (vendored, CDN fallback),
    boots a Linux VM against the public WebVM Debian image with an
    IndexedDB overlay for persistence.
  - `web/glue/webvm-bus.js`: request/response + event protocol over
    BroadcastChannel that connects the page (where CheerpX lives) to
    extension-host workers.
  - `web/glue/webvm-server.js`: page-side server that exposes the VM's
    file system and a process registry over the bus.
  - `web/extensions/webvm-host/`: VS Code Web extension implementing the
    `webvm:` `FileSystemProvider`, a `Pseudoterminal` over CheerpX bash,
    cargo task provider (`build`, `run`, `test`, `add`, `new`), and a
    status-bar Run button.
  - `web/extensions/rust-analyzer-web/`: VS Code Web extension stub that
    loads the rust-analyzer WASM artifact when bundled and contributes
    Rust language configuration plus lightweight diagnostics.
  - `web/build/build-workbench.mjs`: build step that vendors
    `vscode-web@1.91.1` + CheerpX 1.2.8 and renders `web/index.html`
    with workbench config that preinstalls our extensions.
  - `web/build/index.template.html`: workbench entry template.
  - `web/tests/webvm-bus.test.mjs`, `web/tests/cheerpx-bridge.test.mjs`:
    additional unit tests; total `node --test` count is now 26.
  - Service worker now caches glue assets and synthesizes COOP/COEP +
    CORP headers on same-origin assets.
  - `.github/workflows/pages.yml` runs the build step before uploading
    the Pages artifact.

### Changed
- `web/index.html` is now the workbench entry document. It renders a
  boot overlay with a five-step status (shell, shim, CheerpX, VM, VS
  Code) that resolves once the workbench mounts, then fades out.

### Added
- Alpine-based disk-image build pipeline (issue #1, "smallest possible
  Linux distro" feedback):
  - `web/disk/Dockerfile.disk` — `i386/alpine:3.20` + `bash`, `curl`,
    `gcc`, `musl-dev`, `pkgconfig`, `openssl-dev`, `rust`, `cargo`,
    `vim`, `nano`. Ships a pre-built `cargo new --bin hello` project at
    `/workspace/hello` so the first `cargo run` only re-links.
  - `web/disk/build.sh` — docker → ext2 export with QEMU-backed i386
    builds and a loopback-mounted populate step.
  - `.github/workflows/disk-image.yml` — builds the image on every push
    that touches `web/disk/**`, smoke-tests the resulting ext2 contains
    `/bin/bash`, `/usr/bin/cargo`, and `/workspace/hello/Cargo.toml`,
    uploads it as a workflow artifact, and (on `workflow_dispatch` with
    a `release_tag` input) publishes it as a GitHub Release asset.
- Full CheerpX 1.2.11 vendoring: the build script now mirrors the
  engine's complete asset set (`cx`, `cxcore`, `cxbridge`, `cheerpOS`,
  `workerclock`, `tun/{direct,tailscale_tun*,wasm_exec,ipstack}`) so
  Pages serves a self-sufficient runtime — no mid-boot CDN dependency.
- `attachConsole(cx, {cols, rows})` helper in `cheerpx-bridge.js` that
  uses CheerpX's documented `setCustomConsole(writeFn, c, r)` API
  (returning a `cxReadFunc(charCode)`), matching leaningtech/webvm's
  reference exactly. Replaces the textContent-mutating sink.
- `resolveDiskUrl()` reads `web/disk/manifest.json` at runtime and
  picks `warm.url` (Alpine + Rust release asset) when set, falling
  back to `default.url` (public WebVM Debian) so the page boots even
  before the disk-image release pipeline has run.

### Changed
- The page now mounts the workbench directly into `<body>` with no
  custom UI overlay, exactly like vscode.dev. The previous five-stage
  boot card was replaced with an inline "Booting Linux VM…" status
  rendered inside the VS Code terminal pane (the `webvm-host`
  Pseudoterminal animates a loading indicator until `vm.status`
  reports the VM ready, then drops into bash).
- `webvm-host` extension now auto-opens a `WebVM bash` terminal on
  activation so users land in a working shell with zero clicks.
- Workbench entry template uses the upstream AMD-loader bootstrap
  (`vs/loader.js` + `webPackagePaths.js` + `workbench.web.main.js`),
  matching microsoft/vscode's `workbench.html` verbatim. Drops the
  ESM-style entry that doesn't exist in the published `vscode-web`
  package layout.
- Pinned CheerpX from 1.2.8 to **1.2.11** (latest stable).
- Mount stack in `bootLinux()` now mirrors leaningtech/webvm's reference
  (adds `WebDevice@/web`, `DataDevice@/data`, `devpts`, `sys`) so all
  documented CheerpX callbacks keep working.
- `webvm-server.js` runs a single persistent `/bin/bash --login` loop;
  every visible terminal subscribes to the same stdout stream and
  pushes input through `setCustomConsole`'s `cxReadFunc`. Matches the
  leaningtech/webvm pattern exactly.
- Service worker cache key bumped to
  `rust-web-box-v2-vscode1.91.1-cheerpx1.2.11`.

### Fixed
- `web/cheerpx/cx.esm.js` was being requested at the wrong base path
  when imported from `boot.js`; switched to `import.meta.url`-relative
  resolution so the vendored copy loads first and the CDN fallback only
  triggers when the build script hasn't run.
- `package.nls.json` 404s for our two extensions on workbench load.

### Added
- JS-side workspace store (`web/glue/workspace-fs.js`) backed by
  IndexedDB. The `webvm:` `FileSystemProvider` now reads/writes from
  this store so the Explorer populates immediately on page load — the
  user sees `hello_world.rs`, `hello/Cargo.toml`, `hello/src/main.rs`,
  and `README.md` the moment VS Code mounts, instead of waiting 30+
  seconds for CheerpX to finish booting (issue #2 screenshot feedback).
- Two-stage bus: a workspace-only methods table serves `fs.*` requests
  while CheerpX is still loading; once the VM finishes booting, the
  bus hot-swaps to the full table that adds `proc.*` (terminal) and
  `cargo.*` support. Implemented via `setMethods` on the bus server so
  the swap happens without registering a duplicate message listener
  (which would double-respond to every request).
- `webvm-server.js` now mirrors the JS-side workspace into the guest's
  `/workspace/` directory using `cat <<EOF` heredocs sent to the
  persistent bash session. After priming, the terminal lands at
  `/workspace` and runs `ls -la` so the populated directory is visible
  immediately — exactly the "ls where hello_world.rs is visible"
  feedback from the user.
- Auto-open `hello_world.rs` on extension activation. The webvm-host
  extension's `activate()` now calls `vscode.window.showTextDocument`
  on `webvm:/workspace/hello_world.rs`, falling back to
  `hello/src/main.rs` and `README.md` if the user has deleted earlier
  files (their edits persist in IndexedDB across sessions).
- `disk-image.yml` workflow now auto-publishes `rust-alpine.ext2` to
  the `disk-latest` rolling release tag on every push to main. The
  `web/disk/manifest.json` warm URL points to that release, so the
  Pages site picks up the freshest Alpine + Rust image without manual
  intervention.

### Changed
- `web/disk/manifest.json` warm URL now resolves to
  `https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2`
  (was `null`).
- `cheerpx-bridge.js`'s `bootLinux()` now falls back to the public
  WebVM Debian image if the warm `CloudDevice.create()` call fails —
  this keeps the workbench coming up cleanly during the brief window
  between merging this PR and the disk-image workflow finishing on
  main. The disk URL probe also uses `mode: 'no-cors'` to keep CORS
  errors out of the devtools console while we're falling back.
- Terminal banner is now a single clean status pane: "Booting Linux
  VM…" → VM-stage updates → "Linux VM ready ✓" → "Workspace mirrored
  to /workspace — try `cargo run` in /workspace/hello", followed by
  the actual `ls -la /workspace` output. The previous flow echoed raw
  `cd` commands and surfaced `mesg: ttyname failed` noise from
  /etc/profile.d scripts.

### Fixed
- Explorer no longer shows an empty `workspace` with a warning icon
  while CheerpX is booting; the JS-side store always serves `fs.stat`
  / `fs.readDir` synchronously off IndexedDB.
- Issue #2 screenshot feedback ("no hello_world.rs in file browser, it
  should be as in user's home folder"): hello_world.rs is now visible
  AND pre-opened on first paint.
- Issue #2 screenshot feedback ("terminal shows lots of errors"): the
  prime script disables echo while heredocs stream, then `clear`s and
  runs `ls -la /workspace` so the user lands in a clean terminal with
  the populated directory listing.

### Fixed
- Terminal staircase indentation in the WebVM bash pane (issue #2 boot
  screenshot feedback). Bash inside CheerpX writes through
  `cx.setCustomConsole`, which is not a kernel TTY: there is no ONLCR
  mapping, so each newline arrives as a bare `\n`. VS Code's
  Pseudoterminal API (xterm.js underneath) requires `\r\n` — without the
  carriage return the cursor only moved down, not back to column 0,
  producing the visible staircase in the previous boot screenshots.
  `web/glue/webvm-server.js` now runs every stdout chunk through
  `createLfToCrlfNormaliser()` from `web/glue/terminal-stream.js` before
  broadcasting `proc.stdout`. The normaliser is stateful so a chunk
  boundary that splits an existing `\r\n` (CheerpX delivers `foo\r` in
  one chunk, `\nbar` in the next) does not produce `\r\r\n`. Existing
  CRLF passes through unchanged; bare `\r` (cargo's progress meter) is
  preserved.

### Added
- `web/glue/terminal-stream.js` with `createLfToCrlfNormaliser()` and
  the one-shot `lfToCrlf()` convenience used by the page-side WebVM
  server.
- `web/tests/terminal-stream.test.mjs` — eight unit tests covering
  every newline shape (lone LF, CRLF, bare CR, ANSI control sequences,
  empty input, the exact `ls -la /workspace` repro from the screenshot,
  and chunk boundaries split mid-CRLF).
- `web/tests/webvm-server.test.mjs` — four integration tests with a
  fake CheerpX handle, asserting that stdout written by the engine is
  normalised on the wire, vt != 1 channels are still filtered, and the
  in-memory bus transport stays sane.

### Changed
- `web/glue/webvm-server.js` now uses a streaming `TextDecoder`
  (`stream: true`) for stdout, so multi-byte UTF-8 split across CheerpX
  writes no longer decodes to U+FFFD before reaching the terminal.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered an empty workbench:
  no terminal, no files, no VM status (issue #3). Three root causes,
  one of which was a hard ship-blocker:
  - **(P0)** `additionalBuiltinExtensions[].path` was a host-absolute
    URL path with no deploy-base prefix, so the browser fetched
    `/extensions/webvm-host/...` (404) instead of
    `/rust-web-box/extensions/webvm-host/...`. The workbench then had
    no `FileSystemProvider` for `webvm:`, no terminal profile, no
    extension code — the exact symptom in the bug report. Fixed by
    substituting a `{BASE_PATH}` placeholder in both the inline
    bootstrap (HTML) and the defensive backstop in `glue/boot.js`.
  - **(P1)** Warm disk-image probe used `mode: 'no-cors'` and accepted
    opaque responses, so CORS-blocked URLs were happily passed to
    `CloudDevice.create()` and only failed at mount time. Probe now
    uses `mode: 'cors'`, returns structured `{ok, reason}`, and
    surfaces a diagnostic pointing to the case-study doc when CORS
    blocks the disk.
- `dev-server.mjs` now accepts `--base=/path` and mirrors the GitHub
  Pages topology locally (outside-prefix → 404, bare-root → 302
  redirect), so this class of regression can be reproduced before
  deploy.

### Added
- Opt-in verbose mode (`?debug=1`, `?debug=boot,workbench,cheerpx`,
  `localStorage.rustWebBoxDebug=1`) with namespace filtering and a
  `__rustWebBox.dump()` JSON-safe runtime snapshot for bug reports.
  Zero overhead when disabled.
- `docs/case-studies/issue-3/` — full case study with timeline, root
  causes, evidence, online research from leaningtech/webvm and
  microsoft/vscode, before/after screenshots, and three supporting
  analysis docs (`analysis-extension-base-path.md`,
  `analysis-disk-cors.md`, `analysis-coop-coep.md`).
- 24 new tests across four files: `disk-cors.test.mjs` (11),
  `debug-mode.test.mjs` (11), `pages-parity.test.mjs` (5),
  `cargo-install.test.mjs` (4) — verifying the `cargo install serde`
  request sequence end-to-end through the network shim.

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but the
  in-browser Linux VM never booted (issue #5). Three root causes:
  - **(P0)** `cxcore-no-return-call.wasm` was not in the CheerpX vendor
    list in `web/build/build-workbench.mjs`. CheerpX 1.2.x ships its
    engine as paired `.js`/`.wasm` siblings; the runtime picks the
    `-no-return-call` variant on browsers without WebAssembly tail-call
    support (Safari, older Chromium / Firefox). The missing `.wasm` 404'd,
    GitHub Pages returned its SPA-404 HTML, and CheerpX failed to compile
    it as wasm with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
    (the bytes are `<!DO`). Fixed by adding the file to the vendor list.
  - **(P3)** `.vscode/{settings,tasks,launch}.json` ENOENT noise on every
    workspace open — VS Code Web probes those three files as part of
    workspace init, and our `workspace-fs.js` seed never created them.
    Fixed by seeding empty-but-valid stubs (settings disables format-on-save,
    tasks ships a `cargo run` task).
  - **(P3)** `rust-analyzer-web/extension.js` issued an HTTP GET on
    `rust-analyzer.wasm` even when the artifact wasn't bundled, surfacing
    a red 404 in the network panel even though the extension already
    degrades gracefully. Fixed with a HEAD probe before the readFile call.

### Added
- `web/tests/cheerpx-vendor-list.test.mjs` — static regression test that
  asserts every `cxcore*.js` listed in `build-workbench.mjs` has a sibling
  `*.wasm` in the same vendor array.
- `docs/case-studies/issue-5/` — full case study with timeline, three
  per-root-cause analysis docs, online research, and Playwright-captured
  evidence (`evidence/console-first-load.log`,
  `evidence/network-requests.txt`).

### Fixed
- GitHub Pages deploy at `/rust-web-box/` rendered the workbench but
  CheerpX threw `DataCloneError: SharedArrayBuffer transfer requires
  self.crossOriginIsolated` on first boot (issue #7). Root cause: the
  top-level navigation never received `Cross-Origin-Opener-Policy` /
  `Cross-Origin-Embedder-Policy` headers because `web/sw.js` only
  intercepts subresource fetches and Pages cannot set custom response
  headers. The header-synthesis half of the fix (in `web/sw.js`) was
  shipped in PR #4, but the registration-and-reload bootstrap half
  documented in PR #4's plan was never landed. Fixed by adding
  `web/glue/coi-bootstrap.js` (a classic-script IIFE that runs as the
  first executable script in `<head>`), which registers the SW and
  forces a one-shot `location.reload()` when `crossOriginIsolated` is
  false so the next navigation receives the SW-decorated headers. The
  bootstrap uses a `sessionStorage` reload-loop guard
  (`'rust-web-box.coi.reloaded'`) and accepts a `?coi=0` opt-out for
  diagnostics. SW registration responsibility moved out of
  `web/glue/boot.js` so a single owner handles it.

### Added
- `web/tests/coi-bootstrap.test.mjs` — wiring + behavioural regression
  tests. Wiring tests assert `coi-bootstrap.js` is the first `<script>`
  in `<head>` of both `web/index.html` and `web/build/index.template.html`,
  is a classic script (no `type=module`/`defer`/`async`), and that
  `web/glue/boot.js` no longer calls `serviceWorker.register`.
  Behavioural tests run the IIFE in a Node `vm` sandbox under each
  branch of the decision tree (warm load, `?coi=0` opt-out, no SW API,
  controller attached but not isolated, second pass with marker, fresh
  load with no controller).
- `docs/case-studies/issue-7/` — full case study with timeline,
  per-root-cause analysis docs, online research with citations, and
  Playwright-captured evidence (`evidence/console-first-load.txt`,
  `evidence/console-after-fix-local.txt`).

### Fixed
- Fixed GitHub Pages warm-disk boot failures by staging the release-hosted Rust ext2 image into same-origin CheerpX GitHubDevice chunks and selecting the correct CheerpX block device at runtime.

### Fixed
- Kept WebVM workspace priming and editor-save mirroring out of the
  visible terminal by staging temporary CheerpX `/data` scripts instead
  of typing setup heredocs into the interactive bash session.

### Documentation
- Replaced the issue #11 case-study placeholder with terminal-noise
  evidence, root-cause analysis, online research, and verification logs.

# Issue #13: usable Rust web box defaults

- Changed the default WebVM workspace to a root Cargo project with
  `Cargo.toml` and `src/main.rs` directly under `/workspace`; unchanged
  legacy `hello/` and `hello_world.rs` seed files are migrated away.
- Added `tree` to the warm Alpine disk, kept `cargo` verified in the
  disk-image workflow, and made `cargo run --release` from `/workspace`
  part of the image smoke test.
- Made Pages warm-disk staging fail closed by default so production does
  not silently deploy the Debian fallback without Rust tools.
- Added shell-profile preparation and `?debug` guest-script tracing so
  setup failures are visible without leaking setup commands into the
  normal terminal.

### Fixed
- The deployed GitHub Pages workbench could not run `tree` or `cargo run`
  inside the in-browser terminal (issue #15). The CheerpX 1.2.11 runtime
  the project shipped emitted `TypeError: Cannot read properties of
  undefined (reading 'a1')` four times during Linux boot and failed
  `cx.run` with `CheerpException: Program exited with code 71`. Bumped
  the vendored runtime to **CheerpX 1.3.0** in `web/build/build-workbench.mjs`,
  `web/glue/cheerpx-bridge.js` (runtime version constant), and
  `web/sw.js` (cache key) — Linux now reaches `vmPhase: 'ready'` and
  `cx.run` returns `status: 0` for `tree --version` and the prebuilt
  `/workspace/target/release/hello` binary.
- `web/build/dev-server.mjs` now redirects `/rust-web-box` → `/rust-web-box/`
  when serving with a base prefix. Mirrors GitHub Pages canonicalisation
  so the same URL shape resolves the same way locally and on Pages.
- `globalThis.__rustWebBox.vmPhase` now reaches `'ready'`. Previously
  `boot.js` only forwarded phases out of `cheerpx-bridge`'s `onProgress`
  hook, which stops at `'starting Linux'`. The terminal `'ready'` phase
  is emitted from inside `web/glue/webvm-server.js` and was only ever
  visible on the BroadcastChannel — never on the page-level shim. The
  e2e harness keys `vmPhase === 'ready'` on that shim, so without this
  fix the local-e2e CI job would deadlock and time out at 180s waiting
  for a transition that could never happen. `startWebVMServer` now
  accepts an `onPhase` callback and `boot.js` threads it through a
  single `setPhase` helper that's the only thing that mutates `vmPhase`.

### Added
- `web/tests/helpers/cheerpx-page-harness.mjs` — reusable browser
  harness around [`browser-commander`](https://github.com/link-foundation/browser-commander).
  Wraps Chromium launch, COOP/COEP-aware dev-server boot, stage-1 shim
  wait, stage-2 Linux wait, and `cx.run` invocation. On either-stage
  timeout the thrown error is enriched with an in-page snapshot
  (`vmPhase`, has-vm/workspace/shim flags, recorded `vm.boot` history),
  the last 30 console messages, captured `console.error`/`pageerror`
  output, and the list of failed network requests — so a CI failure
  surfaces the *cause* of the stall rather than just `Timeout Xms
  exceeded`.
- `web/tests/e2e/local-pages-e2e.test.mjs` — local end-to-end suite that
  drives the freshly built `web/` artifact. Asserts CheerpX 1.3.0 runs
  `tree --version`, lists `/workspace`, and executes the prebuilt hello
  binary without leaking `CheerpException` into `console.error`.
- `web/tests/e2e/live-pages-e2e.test.mjs` — post-deploy end-to-end suite
  that drives `RUST_WEB_BOX_LIVE_URL`. Same assertions, against the URL
  GitHub Pages just published.
- `web/tests/package.json` + lockfile — pin `browser-commander` and
  `playwright` versions for the e2e harness.
- `.github/workflows/pages.yml` gains a `local-e2e` job (PRs + main, runs
  before deploy) and an `e2e` job (post-deploy, drives the live URL).
  The `build` job now stages the warm rust-alpine disk on PRs as well,
  with `STAGE_WARM_DISK_REQUIRED=0` for forks that lack the release
  asset.
- `docs/case-studies/issue-15/` — full case study with timeline,
  evidence (Playwright console logs + screenshots + per-step `cx.run`
  output), upstream-issue tracking, and the verification plan.

### Fixed
- Reduced default rust-web-box console noise with exact VS Code Web startup filtering, lazy namespaced debug logging, source-map stub generation, and a polished WebVM boot banner.
- Removed the duplicate default workspace task seed that still pointed at the old `/workspace/hello` project path.

### Fixed
- Kept the VS Code web workspace and WebVM `/workspace` in sync for editor saves, guest terminal edits, and file tree refreshes.
- Restored explicit manual-save behavior in the seeded workspace so unsaved editor changes show the normal dirty state before Ctrl+S.

## [0.7.0] - 2026-04-14

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

### Fixed

- Change detection script now uses per-commit diff instead of full PR diff, so commits touching only non-code files correctly skip CI jobs even when earlier commits in the same PR changed code files

## [0.6.0] - 2026-04-13

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fix publish steps overriding workflow-level CARGO_TOKEN fallback, breaking CARGO_REGISTRY_TOKEN-only configurations (#32)
- Fix non-fast-forward push failures in multi-workflow repos by adding fetch/rebase and push retry logic (#31)
- Add mono-repo path support to check-changelog-fragment.rs, check-version-modification.rs, and create-changelog-fragment.rs
- Add `!cancelled()` guard to test job condition to respect workflow cancellation

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

## [0.5.0] - 2026-04-13

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

### Fixed
- Fixed unsupported look-ahead regex in `create-github-release.rs` that caused a panic when parsing CHANGELOG.md. Replaced with a two-step approach using only features supported by Rust's `regex` crate.

### Changed
- Restructured example application as a simple CLI sum calculator using `lino-arguments`
- Renamed default package to `example-sum-package-name` with Unlicense license
- Reorganized test structure: `tests/unit/sum.rs`, `tests/integration/sum.rs`, `tests/unit/ci-cd/`
- Converted experiment scripts into proper unit tests in `tests/unit/ci-cd/changelog_parsing.rs`
- Added CI/CD skip logic for template default package name `example-sum-package-name`
- Updated README.md badges and documentation

## [0.4.0] - 2026-04-13

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Added

- Cache `restore-keys` for partial cache hits across all workflow jobs
- Explicit `token` parameter in checkout for release jobs
- Code coverage job with `cargo-llvm-cov` and Codecov integration
- Codecov badge in README.md
- Pre-release version support (e.g., `0.1.0-beta.1`) in version parsing
- `--release-label` parameter for multi-language release disambiguation
- `ensure_version_exceeds_published()` logic to prevent publishing duplicate versions
- `get_max_published_version()` to query highest non-yanked version from crates.io
- `max_published_version` output from check-release-needed for downstream use
- Version fallback logic in auto-release Create GitHub Release step

### Changed

- Updated `actions/checkout` from v4 to v6
- Updated `actions/cache` from v4 to v5
- Updated `peter-evans/create-pull-request` from v7 to v8
- Made `publish-crate.rs` fail (exit 1) when version already exists on crates.io
- Improved `create-github-release.rs` to check combined stdout+stderr and detect "Validation Failed"

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

## [0.3.0] - 2026-04-13

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

### Fixed

- Fixed `version-and-commit.rs` to check crates.io instead of git tags for determining if a version is already released
- This prevents the release pipeline from getting stuck when git tags exist without corresponding crates.io publication

### Added

- Added `--tag-prefix` support to `version-and-commit.rs` for multi-language repository compatibility
- Added crates.io and docs.rs badges to README.md
- Added automatic crates.io and docs.rs badge injection in GitHub release notes
- Added documentation deployment job to CI/CD pipeline (deploys to GitHub Pages after release)
- Added case study documentation for issue #25

## [0.2.0] - 2026-03-11

### Added
- Changeset-style fragment format with frontmatter for specifying version bump type
- New `get-bump-type.mjs` script to automatically determine version bump from fragments
- Automatic version bumping on merge to main based on changelog fragments
- Detailed documentation for the changelog fragment system in `changelog.d/README.md`

### Changed
- Updated `collect-changelog.mjs` to strip frontmatter when collecting fragments
- Updated `version-and-commit.mjs` to handle frontmatter in fragments
- Enhanced release workflow to automatically determine bump type from changesets

### Changed
- Add `detect-changes` job with cross-platform `detect-code-changes.mjs` script
- Make lint job independent of changelog check (runs based on file changes only)
- Allow docs-only PRs without changelog fragment requirement
- Handle changelog check 'skipped' state in dependent jobs
- Exclude `changelog.d/`, `docs/`, `experiments/`, `examples/` folders and markdown files from code changes detection

### Fixed
- Fixed README.md to correctly reference Node.js scripts (`.mjs`) instead of Python scripts (`.py`)
- Updated project structure in README.md to match actual script files in `scripts/` directory
- Fixed example code in README.md that had invalid Rust with two `main` functions

### Added

- Added crates.io publishing support to CI/CD workflow
- Added `release_mode` input with "instant" and "changelog-pr" options for manual releases
- Added `--tag-prefix` and `--crates-io-url` options to create-github-release.mjs script
- Added comprehensive case study documentation for Issue #11 in docs/case-studies/issue-11/

### Changed

- Changed changelog fragment check from warning to error (exit 1) to enforce changelog requirements
- Updated job conditions with `always() && !cancelled()` to fix workflow_dispatch job skipping issue
- Renamed manual-release job to "Instant Release" for clarity

### Fixed

- Fixed deprecated `::set-output` GitHub Actions command in version-and-commit.mjs
- Fixed workflow_dispatch triggering issues where lint/build/release jobs were incorrectly skipped

### Fixed

- Fixed changelog fragment check to validate that a fragment is **added in the PR diff** rather than just checking if any fragments exist in the directory. This prevents the check from incorrectly passing when there are leftover fragments from previous PRs that haven't been released yet.

### Changed

- Converted shell scripts in `release.yml` to cross-platform `.mjs` scripts for improved portability and performance:
  - `check-changelog-fragment.mjs` - validates changelog fragment is added in PR diff
  - `git-config.mjs` - configures git user for CI/CD
  - `check-release-needed.mjs` - checks if release is needed
  - `publish-crate.mjs` - publishes package to crates.io
  - `create-changelog-fragment.mjs` - creates changelog fragments for manual releases
  - `get-version.mjs` - gets current version from Cargo.toml

### Added

- Added `check-version-modification.mjs` script to detect manual version changes in Cargo.toml
- Added `version-check` job to CI/CD workflow that runs on pull requests
- Added skip logic for automated release branches (changelog-manual-release-*, changeset-release/*, release/*, automated-release/*)

### Changed

- Version modifications in Cargo.toml are now blocked in pull requests to enforce automated release pipeline

### Added

- Added support for `CARGO_REGISTRY_TOKEN` as alternative to `CARGO_TOKEN` for crates.io publishing
- Added case study documentation for Issue #17 (yargs reserved word and dual token support)

### Changed

- Updated workflow to use fallback logic: `${{ secrets.CARGO_REGISTRY_TOKEN || secrets.CARGO_TOKEN }}`
- Improved publish-crate.mjs to check both `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN` environment variables
- Added warning message when neither token is set

### Added
- New `scripts/rust-paths.mjs` utility for automatic Rust package root detection
- Support for both single-language and multi-language repository structures in all CI/CD scripts
- Configuration options via `--rust-root` CLI argument and `RUST_ROOT` environment variable
- Comprehensive case study documentation in `docs/case-studies/issue-19/`

### Changed
- Updated all release scripts to use the new path detection utility:
  - `scripts/bump-version.mjs`
  - `scripts/check-release-needed.mjs`
  - `scripts/collect-changelog.mjs`
  - `scripts/get-bump-type.mjs`
  - `scripts/get-version.mjs`
  - `scripts/publish-crate.mjs`
  - `scripts/version-and-commit.mjs`

### Changed

- **check-release-needed.mjs**: Now checks crates.io API directly instead of git tags to determine if a version is already released. This prevents false positives where git tags exist but the package was never actually published to crates.io.

### Added

- **CI/CD Troubleshooting Guide**: New documentation at `docs/ci-cd/troubleshooting.md` covering common issues like skipped jobs, false positive version checks, publishing failures, and secret configuration.

- **Enhanced Error Handling in publish-crate.mjs**: Added specific detection and helpful error messages for authentication failures, including guidance on secret configuration and workflow setup.

- **Case Study Documentation**: Added comprehensive case study at `docs/case-studies/issue-21/` analyzing CI/CD failures from browser-commander repository (issues #27, #29, #31, #33) with timeline, root causes, and lessons learned.

### Fixed

- **Prevent False Positive Version Checks**: The release workflow now correctly identifies unpublished versions by checking crates.io instead of relying on git tags, which can exist without the package being published.

### Changed

- Translated all CI/CD scripts from JavaScript (.mjs) to Rust (.rs) using rust-script
- Scripts now use native Rust with rust-script for execution in shell
- Removed Node.js dependency from CI/CD pipeline
- Updated GitHub Actions workflow to use rust-script instead of node
- Updated README and CONTRIBUTING documentation with new script references

## [0.1.0] - 2025-01-XX

### Added

- Initial project structure
- Basic example functions (add, multiply, delay)
- Comprehensive test suite
- Code quality tools (rustfmt, clippy)
- Pre-commit hooks configuration
- GitHub Actions CI/CD pipeline
- Changelog fragment system (similar to Changesets/Scriv)
- Release automation (GitHub releases)
- Template structure for AI-driven Rust development