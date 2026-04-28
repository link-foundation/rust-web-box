# extensions/webvm-host/

VS Code Web extension that bridges the workbench to the CheerpX VM.

Implements:

1. `webvm:` `FileSystemProvider` — `readFile`, `writeFile`, `stat`,
   `readDirectory`, `createDirectory`, `delete`, `rename`, `watch`.
   Powers Explorer, search, and editor tabs against `webvm:/workspace`.
2. `webvm-host.bash` `TerminalProfileProvider`. Spawns `/bin/bash --login`
   inside CheerpX, wires stdio through the WebVM bus, and resizes the
   guest pty to match VS Code's xterm widget.
3. Tasks for `cargo build`, `cargo run`, `cargo test`, `cargo add`,
   `cargo new`. Each runs in its own pty so the output panel streams.
4. Status-bar "Cargo Run" button bound to `cargo run --release`.

The extension is a single-file payload — no bundler required. It runs
in the VS Code extension-host Web Worker and talks to the page-side
`webvm-server.js` (which holds the live CheerpX handle) over a same-
origin `BroadcastChannel`.
