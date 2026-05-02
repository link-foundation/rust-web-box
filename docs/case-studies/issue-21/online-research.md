# Online Research Notes

Research date: 2026-05-02.

## VS Code FileSystemProvider

Source: https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider

Findings:

- `FileSystemProvider` is the right existing VS Code abstraction for the `webvm:` scheme because it lets extensions serve remote or virtual files directly to the editor.
- Providers must expose `onDidChangeFile` for watched resources when files are created, changed, or deleted.
- The `watch()` method contract says the provider is responsible for calling `onDidChangeFile` for changes that match the watch request and excludes.
- `writeFile()` should reject with the appropriate file-system error when the write cannot be completed. That means a guest mirror failure must reject the save instead of being logged and ignored.
- VS Code notes that changed file metadata should advance `mtime` and update `size`, otherwise editor refresh optimizations can hide new contents. The workspace store already updates both on writes.

How this informed the fix:

- `webvm-host` now subscribes to page-side `fs.change` bus events and forwards them as VS Code file-change events.
- Guest sync failures now reject `fs.writeFile`, `fs.delete`, `fs.rename`, and `fs.createDirectory` instead of allowing VS Code to believe the operation succeeded.

## VS Code Save and Auto Save

Source: https://code.visualstudio.com/docs/editing/codebasics#_save-auto-save

Findings:

- VS Code defaults to explicit save with Ctrl+S.
- `files.autoSave` values include `off`, `afterDelay`, `onFocusChange`, and `onWindowChange`.
- `afterDelay` saves dirty files after a configured delay, so it can legitimately hide the dirty state the reporter expected to see before pressing Ctrl+S.

How this informed the fix:

- The seeded workspace setting changed from `"files.autoSave": "afterDelay"` to `"files.autoSave": "off"`.
- Existing IndexedDB workspaces are migrated only when their settings file still matches the old seed, preserving user changes.

## CheerpX Console and DataDevice

Sources:

- https://cheerpx.io/docs/reference/CheerpX.Linux/setCustomConsole
- https://cheerpx.io/docs/reference/CheerpX.DataDevice
- https://cheerpx.io/docs/getting-started

Findings:

- `setCustomConsole` accepts a write callback that receives guest console output as `Uint8Array` bytes plus a virtual terminal id, and returns a function for sending input bytes back to the guest.
- `DataDevice` is the official in-memory device used for convenient JavaScript data access, and the quickstart mounts it at `/data`.
- CheerpX applications are expected to run programs through `cx.run`, including login shells, with environment and cwd options.

How this informed the fix:

- Editor-to-guest sync continues using the existing `/data` script staging path.
- Guest-to-editor sync uses the console output channel that already exists, but hides sync data in OSC frames and strips those frames before terminal broadcast.

## BroadcastChannel

Source: https://developer.mozilla.org/en-US/docs/Web/API/BroadcastChannel

Findings:

- `BroadcastChannel` is available in Web Workers and broadcasts same-origin messages between channel listeners.
- This matches the existing page-to-extension bus shape, where the page owns CheerpX and the VS Code extension host runs in a web worker.

How this informed the fix:

- The existing bus remains the correct integration point. The fix adds an `fs.change` event topic instead of introducing another communication channel.

## Existing Components and Libraries Considered

- VS Code `FileSystemProvider` and `FileSystemWatcher` semantics solve the editor-side virtual filesystem and refresh problem.
- CheerpX `DataDevice` solves host-to-guest script staging.
- CheerpX `setCustomConsole` solves guest-to-page byte delivery without an additional guest daemon.
- `BroadcastChannel` solves page-to-extension event propagation inside the browser.

No separate third-party bug report was filed because the reproduced behavior was caused by missing and incorrectly ordered glue code in this repository.
