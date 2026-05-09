# Online Research: Issue #29

This note records the external documentation checked while investigating issue #29.

## Findings

| Topic | Source | Relevance |
| --- | --- | --- |
| Cargo build outputs | [Cargo Book: Build Cache](https://doc.rust-lang.org/cargo/reference/build-cache.html) | Cargo stores build artifacts in the `target` directory by default, and that directory may contain many generated files. This supports keeping prompt-time sync cheap and refreshing target metadata only when Explorer asks for it. |
| VS Code virtual filesystems | [VS Code API: FileSystemProvider](https://code.visualstudio.com/api/references/vscode-api#FileSystemProvider) | VS Code file explorers use provider calls such as `readDirectory`, which makes on-demand metadata refresh a natural boundary for expanding `/workspace/target`. |
| VS Code save lifecycle | [VS Code API: workspace.saveAll](https://code.visualstudio.com/api/references/vscode-api#workspace.saveAll) | `workspace.saveAll(false)` saves dirty editors without including untitled files. This is the right pre-command action before terminal Enter and Cargo tasks. |
| CheerpX device/filesystem model | [CheerpX files and filesystems documentation](https://cheerpx.io/docs/guides/File-System-support.html) | WebVM storage uses a guest filesystem abstraction. The fix stays inside the existing local guest-to-browser synchronization layer instead of requiring an upstream filesystem change. |

## Design Consequences

- Cargo `target` contents should be treated as generated cache metadata for Explorer, not as normal source files to mirror eagerly.
- VS Code `readDirectory` is the correct trigger point for lazily refreshing large generated directories.
- Dirty editor state must be saved before command submission when the command depends on source files.
- The bug does not require an upstream report because the documented APIs already support the necessary behavior.
