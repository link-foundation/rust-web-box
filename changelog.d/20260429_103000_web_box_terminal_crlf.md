---
bump: patch
---

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
