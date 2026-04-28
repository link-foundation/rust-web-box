---
bump: minor
---

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
