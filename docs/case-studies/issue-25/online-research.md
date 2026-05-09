# Online Research

Research performed on 2026-05-09.

## Sources

- Cargo build cache:
  https://doc.rust-lang.org/cargo/reference/build-cache.html
- Cargo profiles and incremental compilation:
  https://doc.rust-lang.org/cargo/reference/profiles.html#incremental
- VS Code Explorer view and `files.exclude`:
  https://code.visualstudio.com/docs/getstarted/userinterface#_explorer-view
- CheerpX files and filesystems:
  https://cheerpx.io/docs/guides/File-System-support

## Findings

- Cargo stores build output in `target/` by default. The build cache page
  documents profile directories such as `target/debug/` and
  `target/release/`, plus directories such as `debug/deps`,
  `debug/build`, and `debug/incremental`.
- Cargo's incremental compilation stores additional information on disk
  and reuses it on recompiles. The profile documentation states that
  incremental data is stored in the `target` directory and can be
  controlled with `CARGO_INCREMENTAL` or Cargo configuration.
- VS Code's Explorer is expected to show workspace folders and files
  unless a setting such as `files.exclude` hides them. This confirmed
  that hiding `target/` in rust-web-box was not a VS Code default.
- CheerpX supports multiple filesystem devices, including persistent
  `IDBDevice`, in-memory `DataDevice`, and `OverlayDevice` over an ext2
  block device. rust-web-box already uses this split: the VM has a real
  `/workspace`, while the page also keeps an IndexedDB-backed workspace
  for VS Code.

## Design Consequence

The official Cargo docs make `target/` part of normal build output, so
the Explorer should show it. The same docs also show why copying target
file bodies is the wrong default for prompt-time sync: target contains
compiler and linker artifacts that can be numerous and large. The chosen
fix syncs the file tree as metadata while leaving the artifact bytes in
the WebVM filesystem.
