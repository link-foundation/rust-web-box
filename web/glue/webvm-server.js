// Page-side WebVM server.
//
// Holds the live CheerpX handle and exposes its functionality to the VS
// Code Web extension over the WebVM bus (see webvm-bus.js). The page
// hosts CheerpX (it owns the SharedArrayBuffer), the extension worker
// drives the workbench UI; messages flow over a same-origin
// BroadcastChannel.
//
// Filesystem model:
//
//   The workspace lives JS-side, in `glue/workspace-fs.js`, persisted
//   to IndexedDB. The FileSystemProvider in the webvm-host extension
//   reads/writes it directly via the bus. We mirror every file write
//   into the guest's `/workspace/` directory (using stdin-injected
//   here-documents) so `cargo run` from the terminal sees the same
//   content. Decoupling Explorer from CheerpX boot is the only way the
//   user sees a populated workspace immediately on page load — the VM
//   takes 30+ seconds to come up, but the editor doesn't have to wait.
//
// Terminal model:
//
//   The VM runs a single, long-lived `/bin/bash --login` loop (the
//   leaningtech/webvm pattern). All bytes coming out of CheerpX are
//   broadcast to every subscribed terminal as a `proc.stdout` event;
//   bytes typed into a terminal are forwarded to the VM via
//   `cx.setCustomConsole`'s `cxReadFunc`. This keeps a single PTY
//   rather than juggling per-process consoles, matching what users
//   expect from a "browser tab is the terminal" experience and avoiding
//   the version-skew of CheerpX's process-management API.

import { attachConsole } from './cheerpx-bridge.js';

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

/**
 * Run the canonical "shell loop" the way leaningtech/webvm does:
 * spawn `/bin/bash --login`, and when it exits, spawn it again.
 *
 * `onFirstReady` is called once bash is about to spawn so callers can
 * inject one-time setup commands without polluting the scrollback.
 */
function runShellLoop(cx, { cwd = '/root', env, onExit, onFirstReady } = {}) {
  const fullEnv = env ?? [
    'HOME=/root',
    'TERM=xterm-256color',
    'USER=root',
    'SHELL=/bin/bash',
    'LANG=C.UTF-8',
    // PATH covers both Debian (/usr/bin) and Alpine (/usr/local/bin) layouts
    // plus rustup's $HOME/.cargo/bin.
    'PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'PS1=root@rust-web-box:\\w# ',
  ];
  let stopped = false;
  let firstSpawn = true;

  (async () => {
    while (!stopped) {
      try {
        const fn = cx.run ?? cx.runAsync;
        if (typeof fn !== 'function') throw new Error('CheerpX missing run()');
        if (firstSpawn) {
          firstSpawn = false;
          queueMicrotask(() => onFirstReady?.());
        }
        await fn.call(cx, '/bin/bash', ['--login'], {
          env: fullEnv,
          cwd,
          uid: 0,
          gid: 0,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[rust-web-box] bash loop error:', err);
        await new Promise((r) => setTimeout(r, 500));
      }
      onExit?.();
    }
  })();

  return () => {
    stopped = true;
  };
}

/**
 * Build a shell-safe heredoc that writes `bytes` to `path` inside the
 * guest. We pick a marker that doesn't appear in the payload.
 */
function heredocForFile(path, bytes) {
  const text = TEXT_DECODER.decode(bytes);
  let marker = 'RWB_EOF';
  while (text.includes(marker)) marker = marker + '_X';
  const dir = path.replace(/\/[^/]+$/, '') || '/';
  return [
    `mkdir -p '${shellQuote(dir)}'`,
    `cat > '${shellQuote(path)}' <<'${marker}'`,
    text,
    marker,
  ].join('\n');
}

function shellQuote(s) {
  return String(s).replace(/'/g, "'\\''");
}

/**
 * Build the methods table for the full server (workspace + VM).
 *
 * `cx` is the live CheerpX handle. `workspace` is the JS-side store.
 * `console_` is an `attachConsole` handle that already has its onData
 * wired up to broadcast `proc.stdout` events.
 */
export function fullServerMethods({ cx, workspace, status, console_, primeGuestWorkspace, subscribers, spawn, killSub }) {
  const writeStr = (s) => console_.write(TEXT_ENCODER.encode(s));
  return {
    'vm.status': async () => ({ booted: true, ...status }),
    'fs.readFile': async ({ path }) => await workspace.readFile(path),
    'fs.writeFile': async ({ path, data, options }) => {
      const buf = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
      await workspace.writeFile(path, buf, options);
      try {
        writeStr('set +o history\n');
        writeStr(heredocForFile(path, buf) + '\n');
        writeStr('set -o history\n');
      } catch {}
    },
    'fs.stat': async ({ path }) => await workspace.stat(path),
    'fs.readDir': async ({ path }) => await workspace.readDirectory(path),
    'fs.delete': async ({ path, recursive }) => {
      await workspace.delete(path, { recursive });
      try {
        writeStr(`rm -${recursive ? 'r' : ''}f '${shellQuote(path)}'\n`);
      } catch {}
    },
    'fs.rename': async ({ from, to }) => {
      await workspace.rename(from, to);
      try {
        writeStr(`mv '${shellQuote(from)}' '${shellQuote(to)}'\n`);
      } catch {}
    },
    'fs.createDirectory': async ({ path }) => {
      await workspace.createDirectory(path);
      try {
        writeStr(`mkdir -p '${shellQuote(path)}'\n`);
      } catch {}
    },
    'proc.spawn': async () => spawn(),
    'proc.write': async ({ bytes }) => {
      const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      console_.write(buf);
    },
    'proc.resize': async ({ cols, rows }) => {
      console_.resize(cols, rows);
    },
    'proc.kill': async ({ sub }) => {
      if (sub != null) killSub(sub);
    },
    'proc.wait': async () => ({ exitCode: 0 }),
    'cargo.runHello': async () => {
      writeStr('cd /workspace/hello && cargo run --release\n');
    },
    'workspace.prime': async () => {
      await primeGuestWorkspace();
    },
  };
}

/**
 * Bring the full WebVM server online: attach the console, start the
 * shell loop, prime `/workspace/`, and return the methods table.
 *
 * `busServer` is an existing `createBusServer` handle; we call
 * `setMethods()` on it to swap the workspace-only stage for the full
 * server. We do NOT register a second message listener (that would
 * double-respond to every request).
 */
export function startWebVMServer({ cx, busServer, status, workspace, opts = {} } = {}) {
  if (!cx) throw new TypeError('startWebVMServer requires a CheerpX handle');
  if (!busServer) throw new TypeError('startWebVMServer requires a busServer');
  if (!workspace) throw new TypeError('startWebVMServer requires a workspace');

  // One console attached to the page; many bus subscribers can listen.
  const console_ = attachConsole(cx, {
    cols: opts.cols ?? 120,
    rows: opts.rows ?? 30,
  });
  console_.onData((bytes) => {
    busServer.emit('proc.stdout', { pid: 1, chunk: TEXT_DECODER.decode(bytes) });
  });

  function writeStr(s) {
    console_.write(TEXT_ENCODER.encode(s));
  }

  // Per-terminal subscriber tracking. Every "spawn" returns the same
  // virtual pid but bumps a per-subscriber counter so kill() only
  // affects the one terminal pane.
  const subscribers = new Map();
  let nextSub = 1;

  function spawn() {
    const sub = nextSub++;
    subscribers.set(sub, { alive: true });
    return { pid: 1, sub };
  }

  function killSub(sub) {
    subscribers.delete(sub);
  }

  // Mirror the JS-side workspace into the guest: writes every regular
  // file with `cat <<EOF`, then `cd /workspace` and prints a friendly
  // greeting + `ls` so the user sees the populated directory in the
  // terminal exactly like the screenshot feedback asked for.
  let primed = false;
  let primingPromise = null;
  async function primeGuestWorkspace() {
    if (primed) return;
    if (primingPromise) return primingPromise;
    primingPromise = (async () => {
      const snap = await workspace.snapshot();
      // Disable echo of the priming script so the user only sees the
      // banner + cd + ls output.
      writeStr('set +o history 2>/dev/null\n');
      writeStr('stty -echo 2>/dev/null\n');
      writeStr("printf '\\n[rust-web-box] preparing /workspace …\\n'\n");
      for (const [path, bytes] of Object.entries(snap)) {
        writeStr(heredocForFile(path, bytes) + '\n');
      }
      writeStr('chown -R root:root /workspace 2>/dev/null || true\n');
      writeStr('cd /workspace\n');
      writeStr('stty echo 2>/dev/null\n');
      writeStr("printf '[rust-web-box] /workspace ready — try `cargo run` from /workspace/hello\\n'\n");
      // `clear` pulls the eye to the populated directory listing.
      writeStr('clear 2>/dev/null; ls -la /workspace\n');
      primed = true;
    })();
    return primingPromise;
  }

  // Start the shell loop.
  const stopShell = runShellLoop(cx, {
    onExit: () => busServer.emit('proc.exit', { pid: 1, exitCode: 0 }),
    onFirstReady: () => {
      // Prime once bash is up. A short delay lets login profile scripts
      // settle before our heredoc payload starts streaming.
      setTimeout(() => {
        primeGuestWorkspace().catch((err) => {
          // eslint-disable-next-line no-console
          console.warn('[rust-web-box] workspace prime failed:', err);
        });
      }, 800);
    },
  });

  const methods = fullServerMethods({
    cx,
    workspace,
    status,
    console_,
    primeGuestWorkspace,
    subscribers,
    spawn,
    killSub,
  });
  busServer.setMethods(methods);
  busServer.emit('vm.boot', { phase: 'ready' });
  return {
    methods,
    consoleHandle: console_,
    primeGuestWorkspace,
    stop() {
      stopShell();
      console_.dispose();
    },
  };
}
