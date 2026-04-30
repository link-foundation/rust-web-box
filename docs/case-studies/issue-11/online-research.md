# Online Research: Quiet WebVM Setup Transport

Research date: 2026-04-30.

## CheerpX DataDevice

Source: [CheerpX.DataDevice](https://cheerpx.io/docs/reference/CheerpX.DataDevice)
and [CheerpX.DataDevice.writeFile](https://cheerpx.io/docs/reference/CheerpX.DataDevice/writeFIle).

Findings:

- CheerpX documents `DataDevice` as an in-memory device for temporary
  data.
- `writeFile(filename, contents)` writes a string or `Uint8Array` to a
  file inside the device. The filename starts at the device root and does
  not include the guest mount point.
- The official example mounts the DataDevice at `/data`, writes source
  text into it from JavaScript, then runs a guest command that reads the
  file through the `/data/...` path.

Impact on issue #11:

- This directly supports the requested temporary-script design.
- A script can be written to `/rust-web-box-workspace-prime.sh` on the
  device and executed as `/data/rust-web-box-workspace-prime.sh` in the
  guest.
- The script lives outside `/workspace`, so it does not show up in the
  user-visible project tree.

## CheerpX setCustomConsole

Source: [CheerpX.Linux.setCustomConsole](https://cheerpx.io/docs/reference/CheerpX.Linux/setCustomConsole).

Findings:

- `setCustomConsole` accepts an output callback for console bytes plus
  the terminal dimensions.
- It returns a function that sends key codes to the console, which makes
  it appropriate for user keystrokes.
- The docs show xterm.js integration by sending terminal input through
  the returned function and writing CheerpX output to the terminal.

Impact on issue #11:

- The old implementation used this same returned input function as an
  internal setup transport. That explains why setup commands were visible
  to the terminal.
- `setCustomConsole` remains the right API for the interactive user
  terminal, but not for quiet setup work.

## xterm.js convertEol

Source: [xterm.js ITerminalOptions.convertEol](https://xtermjs.org/docs/api/terminal/interfaces/iterminaloptions/#converteol).

Findings:

- `convertEol` changes newline rendering by treating `\n` like `\r\n`
  when data comes from a non-PTY source.
- This setting is relevant to line-layout problems, including the
  earlier rust-web-box fix for bare-LF terminal output.

Impact on issue #11:

- It does not address command echo or shell prompt output.
- It is not a complete solution for this issue, because the reported
  noise was caused by executing setup commands through the interactive
  shell.

## VS Code Pseudoterminal

Source: [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api).

Findings:

- VS Code custom terminals are backed by a `Pseudoterminal` object that
  writes text to the visible terminal and handles user input callbacks.
- rust-web-box's `webvm-host` extension correctly uses this as the user
  terminal surface.

Impact on issue #11:

- The VS Code side should stay simple: it should show VM status and user
  terminal output, not filter an internal setup protocol out of the
  terminal stream.
- The cleaner fix belongs in the page-side WebVM server, where setup and
  user terminal traffic can be separated before bytes reach the
  Pseudoterminal.

## Research Conclusion

No external library bug was identified. The available CheerpX APIs
already provide both pieces rust-web-box needs:

- `setCustomConsole` for interactive terminal input/output
- `DataDevice.writeFile` plus `cx.run` for non-interactive setup data

The issue is therefore a local integration bug caused by using the
interactive console for internal workspace priming.
