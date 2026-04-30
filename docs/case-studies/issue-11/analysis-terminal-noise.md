# Analysis: Terminal Noise During Workspace Priming

## Problem Shape

The reported transcript shows setup commands after the VM ready banner:

- shell history and echo control commands
- `mkdir -p` calls for seeded directories
- `cat > ... <<'RWB_EOF'` heredocs for every seeded workspace file
- repeated bash continuation prompts (`>`) while heredoc payloads stream
- `clear; ls -la /workspace`

This was not a rendering-only issue. The terminal was faithfully showing
bytes produced by the shell that received the setup commands.

## Previous Data Flow

Before this fix, startup used one channel for two different jobs:

1. user terminal input and output
2. internal workspace setup and file mirroring

`webvm-server.js` called `attachConsole(cx, ...)`, received the
`cxReadFunc` returned by CheerpX `setCustomConsole`, and used
`console_.write(...)` to feed setup commands into the running login
shell. Because the same console output was broadcast as `proc.stdout`,
the implementation had no hard boundary between internal setup traffic
and user-visible terminal traffic.

`stty -echo` reduced some typed-command echo after bash accepted the
command, but it did not make an interactive heredoc quiet. Bash still
prints the secondary prompt while waiting for heredoc bodies, and the
seeded workspace contained several multiline files. The result was a
large block of prompts before the user could start working.

## Why The Issue Request Points To A Better Boundary

The issue suggested a temporary script outside the visible workspace.
That is the right boundary because it separates these concerns:

- user terminal: interactive `/bin/bash --login`, visible in VS Code
- setup transport: non-interactive shell script, staged under `/data`
- workspace contents: final files under `/workspace`

CheerpX already mounts a `DataDevice` at `/data` in rust-web-box. That
device is specifically suited for JavaScript-provided temporary data.
Writing a script there and running it with `cx.run('/bin/sh', [...])`
keeps the setup transport out of the console and out of `/workspace`.

## Chosen Implementation

The new flow is:

1. Build one prime script from the JS-side workspace snapshot.
2. Write the script with `dataDevice.writeFile('/rust-web-box-workspace-prime.sh', script)`.
3. Run `/bin/sh /data/rust-web-box-workspace-prime.sh` through
   CheerpX `cx.run`.
4. Remove the script with `/bin/rm -f /data/rust-web-box-workspace-prime.sh`.
5. Start the visible bash loop with `cwd: '/workspace'` only after prime
   completion.
6. Reuse the same script runner for file writes, deletes, renames, and
   directory creation after boot.

The script still uses heredocs internally because they are simple and
portable for writing text files in the guest. The difference is that
those heredocs now run in a non-interactive `/bin/sh` process, so bash
does not print prompt noise into the user's terminal.

## Failure Handling

Workspace sync failures are not ignored:

- `vm.status` includes `workspacePrimed` and `workspacePrimeError`.
- The VS Code host terminal shows `Workspace mirror failed: ...` when
  status reports an error.
- The visible shell still starts in `/root` if priming fails, so the user
  gets an interactive VM instead of a permanently blocked terminal.

This is intentionally less quiet only on failure. The normal path avoids
setup output; the failure path gives enough information to diagnose the
mirror problem.

## Regression Coverage

The added tests cover the behavior most likely to regress:

- `boot.js` must pass `vm.dataDevice` into `startWebVMServer`.
- The server must use `dataDevice.writeFile`.
- Workspace priming must stage `/rust-web-box-workspace-prime.sh`.
- The staged script must execute as `/bin/sh /data/...`, then be removed.
- `cxReadFunc` terminal input must remain unused during priming.
- Later `fs.writeFile` sync must also use `/data` and not terminal input.
- Old boot commands such as `stty -echo` and `ls -la /workspace` must not
  reappear in `webvm-server.js`.

## Residual Risks

The current implementation serializes guest scripts so prime and
post-boot saves cannot trample each other. Very large workspace snapshots
will still generate large temporary scripts, but they no longer pollute
the user's terminal. If the seeded workspace grows substantially, a
future improvement could batch binary-safe writes or use a tar-like
payload format instead of many heredocs.
