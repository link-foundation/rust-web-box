---
bump: patch
---

### Fixed
- Keep the WebVM terminal open as a diagnostic surface when the iPad/Safari shell-health watchdog fires, instead of closing the pseudoterminal with exit code 1 and hiding the debug output behind VS Code's terminal-failed state.
- Print the in-terminal diagnostics block for both silent shell hangs and rapid shell exit loops so every unhealthy-shell path gives the user copyable debug data inside VS Code.
