# extensions/webvm-host/

VS Code web extension that bridges the VS Code shell to the CheerpX VM.

**Not implemented yet.** Target responsibilities:

1. Register a `webvm:` URI scheme via `FileSystemProvider`. `readFile`,
   `writeFile`, `stat`, `readDirectory`, and `watch` translate to CheerpX FS
   calls. The Explorer, search, and editor tabs operate against
   `webvm:/workspace/...`.
2. Register a `TerminalProfileProvider` whose `Pseudoterminal` spawns
   `/bin/bash` inside CheerpX. Wire `handleInput` to stdin, CheerpX stdout
   to `onDidWrite`, `setDimensions` to `TIOCSWINSZ`, and exit codes to
   `onDidClose`.
3. Register tasks: `cargo run`, `cargo build`, `cargo test`, `cargo add`,
   `cargo new`. Each task spawns inside the same CheerpX terminal with
   output streamed to the VS Code task panel.
4. Add a status-bar 'Run' button that invokes the default
   `cargo run --release` task on the active workspace.
