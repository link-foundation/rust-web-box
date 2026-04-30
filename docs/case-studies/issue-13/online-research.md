# Online Research: Usable Rust Web Box Defaults

Research date: 2026-04-30.

## CheerpX Filesystems And Temporary Scripts

Source: [CheerpX files and filesystems](https://cheerpx.io/docs/guides/File-System-support).

Findings:

- CheerpX supports multiple virtual device types, including persistent
  `IDBDevice`, in-memory `DataDevice`, ext2-backed block devices, and
  `OverlayDevice`.
- `DataDevice` is intended for temporary data and can be mounted at a
  guest path such as `/data`.
- The same guide documents writing files into `DataDevice` from
  JavaScript with `writeFile`.

Impact on issue #13:

- The existing issue #11 DataDevice script path remains the right
  transport for hidden setup. This issue extends it by adding a separate
  shell-profile preparation script before the interactive shell starts.
- `set -eu` in those guest scripts makes the preparation fail on the
  first command error and return a concrete CheerpX process failure to
  the page-side server.

## CheerpX Custom Console

Source: [CheerpX.Linux.setCustomConsole](https://cheerpx.io/docs/reference/CheerpX.Linux/setCustomConsole.html).

Findings:

- `setCustomConsole` wires an output callback plus dimensions and
  returns a function that sends key codes to the Linux console.
- The official example uses it with xterm.js by forwarding user input
  through the returned function.

Impact on issue #13:

- The interactive console should stay reserved for user keystrokes.
  Internal preparation belongs in DataDevice scripts, where failures can
  be recorded without polluting the visible terminal.

## Bash Login Startup Files

Source: [GNU Bash Startup Files](https://www.gnu.org/software/bash/manual/html_node/Bash-Startup-Files).

Findings:

- Bash with `--login` reads `/etc/profile`, then the first readable file
  from `~/.bash_profile`, `~/.bash_login`, and `~/.profile`.
- Creating `/root/.bash_profile` therefore prevents Bash from falling
  through to an inherited `/root/.profile`.

Impact on issue #13:

- The reported `mesg: ttyname failed` is consistent with a login shell
  reading a profile intended for a real tty.
- Writing a minimal `/root/.bash_profile` before the visible shell
  starts avoids that inherited profile path and also sets `PATH`, prompt,
  and the default directory explicitly.

## Alpine Packages

Sources:

- [Alpine `cargo` package, v3.20 x86](https://pkgs.alpinelinux.org/package/v3.20/main/x86/cargo)
- [Alpine `rust` package, v3.20 x86](https://pkgs.alpinelinux.org/package/v3.20/main/x86/rust)
- [Alpine `tree` package, v3.20 x86](https://pkgs.alpinelinux.org/package/v3.20/main/x86/tree)

Findings:

- Alpine v3.20 main/x86 publishes `cargo` as "The Rust package manager"
  and provides `cmd:cargo`.
- Alpine v3.20 main/x86 publishes `rust` as the Rust toolchain.
- Alpine v3.20 main/x86 publishes `tree` and provides `cmd:tree`; the
  installed size is small compared with the Rust toolchain.

Impact on issue #13:

- The warm i386 Alpine image can satisfy the requested `cargo`, `rust`,
  and `tree` commands with normal `apk add` packages.
- Adding `tree` does not materially change the image size relative to
  Rust itself.

## CheerpX Disk Hosting

Source: [CheerpX files and filesystems](https://cheerpx.io/docs/guides/File-System-support).

Findings:

- CheerpX documents ext2 filesystems through HTTP-backed block devices
  and persistent overlays.
- The guide also notes GitHubDevice as a disk option for projects forked
  from WebVM, with GitHub Actions preparing chunks for efficient access.

Impact on issue #13:

- The previous Pages behavior could silently fall back to the public
  Debian disk when warm disk staging was missing or broken.
- For this issue, falling back in production is a correctness bug
  because Debian lacks the rust-web-box warm image guarantees. The build
  must fail if same-origin warm chunks cannot be staged.

## Research Conclusion

No upstream bug report was filed. The failure was caused by rust-web-box
configuration and integration choices:

- Production staging allowed a successful deploy without the warm Rust
  disk.
- The warm image did not include `tree`.
- The workspace shape still required `/workspace/hello`.
- The login shell could inherit a profile that ran tty-specific setup.

CheerpX and Alpine already provide the required building blocks, so the
fix belongs in this repository.
