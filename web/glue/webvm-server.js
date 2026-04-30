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
//   into the guest's `/workspace/` directory by staging a short shell
//   script on CheerpX's `/data` mount and running it non-interactively,
//   so the visible terminal is reserved for user work instead of setup
//   heredocs. Decoupling Explorer from CheerpX boot is the only way the
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
import { createLfToCrlfNormaliser } from './terminal-stream.js';

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });
const TEXT_ENCODER = new TextEncoder();
const GUEST_ENV = [
  'HOME=/root',
  'TERM=xterm-256color',
  'USER=root',
  'SHELL=/bin/sh',
  'LANG=C.UTF-8',
  'PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
];
const BASH_ENV = [
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

/**
 * Run the canonical "shell loop" the way leaningtech/webvm does:
 * spawn `/bin/bash --login`, and when it exits, spawn it again.
 */
function runShellLoop(cx, { cwd = '/root', env = BASH_ENV, onExit } = {}) {
  const fullEnv = env;
  let stopped = false;

  (async () => {
    while (!stopped) {
      try {
        const fn = cx.run ?? cx.runAsync;
        if (typeof fn !== 'function') throw new Error('CheerpX missing run()');
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

function buildWorkspacePrimeScript(snapshot) {
  const lines = ['set -eu', "mkdir -p '/workspace'"];
  for (const [path, bytes] of Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(heredocForFile(path, bytes));
  }
  lines.push('chown -R root:root /workspace 2>/dev/null || true');
  return `${lines.join('\n')}\n`;
}

function buildShellProfileScript() {
  return [
    'set -eu',
    "cat > '/root/.bash_profile' <<'RWB_PROFILE'",
    'export HOME=/root',
    'export TERM=xterm-256color',
    'export USER=root',
    'export SHELL=/bin/bash',
    'export LANG=C.UTF-8',
    'export CARGO_HOME=/root/.cargo',
    'export PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'export PS1="root@rust-web-box:\\w# "',
    'cd /workspace 2>/dev/null || cd /root',
    'RWB_PROFILE',
  ].join('\n') + '\n';
}

function scriptForWrite(path, bytes) {
  return `${heredocForFile(path, bytes)}\n`;
}

function scriptForDelete(path, recursive) {
  return `rm -${recursive ? 'r' : ''}f '${shellQuote(path)}'\n`;
}

function scriptForRename(from, to) {
  const dir = String(to).replace(/\/[^/]+$/, '') || '/';
  return [
    `mkdir -p '${shellQuote(dir)}'`,
    `mv '${shellQuote(from)}' '${shellQuote(to)}'`,
  ].join('\n') + '\n';
}

function scriptForCreateDirectory(path) {
  return `mkdir -p '${shellQuote(path)}'\n`;
}

function scriptPathForName(name) {
  const safeName = String(name || 'sync').replace(/[^a-z0-9._-]+/gi, '-');
  return `/rust-web-box-${safeName}.sh`;
}

function createGuestScriptRunner({ cx, dataDevice, logger = console, debug = () => {} } = {}) {
  const run = cx?.run ?? cx?.runAsync;
  if (typeof run !== 'function') throw new Error('CheerpX missing run()');
  if (typeof dataDevice?.writeFile !== 'function') {
    throw new Error('CheerpX DataDevice missing writeFile()');
  }

  let tail = Promise.resolve();

  return function runGuestScript(script, { name = 'sync', cwd = '/root' } = {}) {
    const devicePath = scriptPathForName(name);
    const guestPath = `/data${devicePath}`;
    const job = tail.catch(() => {}).then(async () => {
      debug('stage guest script', {
        name,
        devicePath,
        guestPath,
        cwd,
        bytes: script.length,
        script: debug.enabled ? script : undefined,
      });
      await dataDevice.writeFile(devicePath, script);
      try {
        debug('run guest script', { name, guestPath, cwd });
        await run.call(cx, '/bin/sh', [guestPath], {
          env: GUEST_ENV,
          cwd,
          uid: 0,
          gid: 0,
        });
        debug('guest script complete', { name });
      } finally {
        try {
          await run.call(cx, '/bin/rm', ['-f', guestPath], {
            env: GUEST_ENV,
            cwd: '/',
            uid: 0,
            gid: 0,
          });
        } catch (err) {
          logger?.warn?.('[rust-web-box] could not remove temporary guest script:', err);
        }
      }
    });
    tail = job;
    return job;
  };
}

/**
 * Build the methods table for the full server (workspace + VM).
 *
 * `workspace` is the JS-side store. `console_` is an `attachConsole`
 * handle that already has its onData wired up to broadcast
 * `proc.stdout` events. Guest file mutations run through `runGuestScript`
 * so setup stays out of the interactive terminal.
 */
export function fullServerMethods({
  workspace,
  status,
  console_,
  runtime,
  runGuestScript,
  primeGuestWorkspace,
  spawn,
  killSub,
}) {
  const writeStr = (s) => console_.write(TEXT_ENCODER.encode(s));
  async function syncGuest(script, name) {
    try {
      await runGuestScript(script, { name });
      runtime.workspacePrimeError = null;
    } catch (err) {
      runtime.workspacePrimeError = err?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.warn('[rust-web-box] guest workspace sync failed:', err);
    }
  }

  return {
    'vm.status': async () => ({
      booted: runtime.ready,
      stage: runtime.stage,
      workspacePrimed: runtime.primed,
      workspacePrimeError: runtime.workspacePrimeError,
      shellPrepareError: runtime.shellPrepareError,
      ...status,
    }),
    'fs.readFile': async ({ path }) => await workspace.readFile(path),
    'fs.writeFile': async ({ path, data, options }) => {
      const buf = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
      await workspace.writeFile(path, buf, options);
      await syncGuest(scriptForWrite(path, buf), 'workspace-sync');
    },
    'fs.stat': async ({ path }) => await workspace.stat(path),
    'fs.readDir': async ({ path }) => await workspace.readDirectory(path),
    'fs.delete': async ({ path, recursive }) => {
      await workspace.delete(path, { recursive });
      await syncGuest(scriptForDelete(path, recursive), 'workspace-sync');
    },
    'fs.rename': async ({ from, to }) => {
      await workspace.rename(from, to);
      await syncGuest(scriptForRename(from, to), 'workspace-sync');
    },
    'fs.createDirectory': async ({ path }) => {
      await workspace.createDirectory(path);
      await syncGuest(scriptForCreateDirectory(path), 'workspace-sync');
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
      writeStr('cd /workspace && cargo run --release\n');
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
export function startWebVMServer({ cx, busServer, status, workspace, dataDevice, opts = {} } = {}) {
  if (!cx) throw new TypeError('startWebVMServer requires a CheerpX handle');
  if (!busServer) throw new TypeError('startWebVMServer requires a busServer');
  if (!workspace) throw new TypeError('startWebVMServer requires a workspace');
  if (!dataDevice) throw new TypeError('startWebVMServer requires a CheerpX DataDevice');

  // One console attached to the page; many bus subscribers can listen.
  const console_ = attachConsole(cx, {
    cols: opts.cols ?? 120,
    rows: opts.rows ?? 30,
  });
  // Streaming decoder so multi-byte UTF-8 split across CheerpX writes
  // doesn't decode to U+FFFD. Stateful CRLF normaliser so xterm.js
  // (under VS Code's Pseudoterminal) renders bash output without the
  // staircase indentation that bare-LF would otherwise produce.
  const stdoutDecoder = new TextDecoder('utf-8', { fatal: false });
  const normaliseCrlf = createLfToCrlfNormaliser();
  console_.onData((bytes) => {
    const text = stdoutDecoder.decode(bytes, { stream: true });
    if (!text) return;
    busServer.emit('proc.stdout', { pid: 1, chunk: normaliseCrlf(text) });
  });

  const debug = opts.debug ?? (() => {});
  const logger = opts.logger ?? console;
  const runGuestScript = createGuestScriptRunner({ cx, dataDevice, logger, debug });
  const runtime = {
    ready: false,
    primed: false,
    stage: 'syncing-workspace',
    workspacePrimeError: null,
    shellPrepareError: null,
  };

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

  // Mirror the JS-side workspace into the guest before exposing the
  // interactive shell. The script is staged on CheerpX's in-memory
  // `/data` mount and executed through `cx.run`, so the setup does not
  // echo heredocs, prompts, or temporary commands into the visible
  // terminal.
  let primed = false;
  let primingPromise = null;
  async function primeGuestWorkspace() {
    if (primed) return;
    if (primingPromise) return primingPromise;
    primingPromise = (async () => {
      const snap = await workspace.snapshot();
      try {
        await runGuestScript(buildWorkspacePrimeScript(snap), {
          name: 'workspace-prime',
          cwd: '/root',
        });
        primed = true;
        runtime.primed = true;
        runtime.workspacePrimeError = null;
      } catch (err) {
        primingPromise = null;
        throw err;
      }
    })();
    return primingPromise;
  }

  let stopShell = () => {};

  const methods = fullServerMethods({
    workspace,
    status,
    console_,
    runtime,
    runGuestScript,
    primeGuestWorkspace,
    spawn,
    killSub,
  });
  busServer.setMethods(methods);
  async function prepareInteractiveShell() {
    try {
      await runGuestScript(buildShellProfileScript(), {
        name: 'shell-profile',
        cwd: '/root',
      });
      runtime.shellPrepareError = null;
    } catch (err) {
      runtime.shellPrepareError = err?.message ?? String(err);
      logger?.error?.('[rust-web-box] shell profile preparation failed:', err);
    }
  }

  const bootTask = (async () => {
    busServer.emit('vm.boot', { phase: 'syncing-workspace' });
    await prepareInteractiveShell();
    try {
      await primeGuestWorkspace();
    } catch (err) {
      runtime.workspacePrimeError = err?.message ?? String(err);
      // eslint-disable-next-line no-console
      logger?.error?.('[rust-web-box] workspace prime failed:', err);
    }
    stopShell = runShellLoop(cx, {
      cwd: runtime.primed ? '/workspace' : '/root',
      onExit: () => busServer.emit('proc.exit', { pid: 1, exitCode: 0 }),
    });
    runtime.ready = true;
    runtime.stage = 'ready';
    busServer.emit('vm.boot', { phase: 'ready' });
  })();

  return {
    methods,
    consoleHandle: console_,
    primeGuestWorkspace,
    bootTask,
    stop() {
      stopShell();
      console_.dispose();
    },
  };
}
