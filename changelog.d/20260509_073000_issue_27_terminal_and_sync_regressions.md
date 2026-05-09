---
bump: patch
---

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
