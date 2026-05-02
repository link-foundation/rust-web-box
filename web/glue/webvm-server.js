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
import {
  applyWorkspaceSyncSnapshot,
  buildGuestSyncProfileBlock,
  createWorkspaceSyncFrameParser,
  decodeWorkspaceSyncPayload,
} from './workspace-sync.js';

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
    'export CARGO_INCREMENTAL=0',
    'export PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'export PS1="root@rust-web-box:\\w# "',
    'cd /workspace 2>/dev/null || cd /root',
    buildGuestSyncProfileBlock().trimEnd(),
    'RWB_PROFILE',
  ].join('\n') + '\n';
}

function scriptForWrite(path, bytes) {
  return `${heredocForFile(path, bytes)}\n`;
}

function scriptForDelete(path, { recursive = false, type } = {}) {
  if (type === 2 && !recursive) {
    return `rmdir '${shellQuote(path)}'\n`;
  }
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
  skipPrime = false,
}) {
  const writeStr = (s) => console_.write(TEXT_ENCODER.encode(s));
  async function syncGuest(script, name) {
    try {
      await runGuestScript(script, { name });
      runtime.workspaceSyncError = null;
    } catch (err) {
      runtime.workspaceSyncError = err?.message ?? String(err);
      // eslint-disable-next-line no-console
      console.warn('[rust-web-box] guest workspace sync failed:', err);
      throw err;
    }
  }

  async function assertWritable(path, { create = true, overwrite = true } = {}) {
    let exists = false;
    try {
      await workspace.stat(path);
      exists = true;
    } catch (err) {
      if (err?.code !== 'FileNotFound') throw err;
    }
    if (exists && !overwrite) {
      const err = new Error(`EEXIST: ${path}`);
      err.code = 'FileExists';
      throw err;
    }
    if (!exists && !create) {
      const err = new Error(`ENOENT: ${path}`);
      err.code = 'FileNotFound';
      throw err;
    }
  }

  async function assertDeletable(path, { recursive = false } = {}) {
    let stat;
    try {
      stat = await workspace.stat(path);
    } catch (err) {
      if (err?.code === 'FileNotFound') return false;
      throw err;
    }
    if (stat.type === 2 && !recursive) {
      const children = await workspace.readDirectory(path);
      if (children.length > 0) {
        const err = new Error(`ENOTEMPTY: ${path}`);
        err.code = 'NoPermissions';
        throw err;
      }
    }
    return stat;
  }

  return {
    'vm.status': async () => ({
      booted: runtime.ready,
      stage: runtime.stage,
      workspacePrimed: runtime.primed,
      workspacePrimeError: runtime.workspacePrimeError,
      workspaceSyncError: runtime.workspaceSyncError,
      guestSyncError: runtime.guestSyncError,
      lastGuestSyncAt: runtime.lastGuestSyncAt,
      shellPrepareError: runtime.shellPrepareError,
      ...status,
    }),
    'fs.readFile': async ({ path }) => await workspace.readFile(path),
    'fs.writeFile': async ({ path, data, options }) => {
      const buf = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
      await assertWritable(path, options);
      await syncGuest(scriptForWrite(path, buf), 'workspace-sync');
      await workspace.writeFile(path, buf, options);
    },
    'fs.stat': async ({ path }) => await workspace.stat(path),
    'fs.readDir': async ({ path }) => await workspace.readDirectory(path),
    'fs.delete': async ({ path, recursive }) => {
      const stat = await assertDeletable(path, { recursive });
      if (!stat) return;
      await syncGuest(scriptForDelete(path, { recursive, type: stat.type }), 'workspace-sync');
      await workspace.delete(path, { recursive });
    },
    'fs.rename': async ({ from, to }) => {
      await workspace.stat(from);
      await syncGuest(scriptForRename(from, to), 'workspace-sync');
      await workspace.rename(from, to);
    },
    'fs.createDirectory': async ({ path }) => {
      await syncGuest(scriptForCreateDirectory(path), 'workspace-sync');
      await workspace.createDirectory(path);
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
      // VS Code's webvm-host extension calls this when a terminal opens.
      // When skipPrime is set we must NOT actually run the prime — that
      // would trip the CheerpX 1.3.0 OverlayDevice 'a1' wedge that
      // skipPrime exists to avoid. The disk image already ships a
      // populated /workspace, so a no-op here is safe.
      if (skipPrime) return;
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
export function startWebVMServer({ cx, busServer, status, workspace, dataDevice, onPhase, opts = {} } = {}) {
  if (!cx) throw new TypeError('startWebVMServer requires a CheerpX handle');
  if (!busServer) throw new TypeError('startWebVMServer requires a busServer');
  if (!workspace) throw new TypeError('startWebVMServer requires a workspace');
  if (!dataDevice) throw new TypeError('startWebVMServer requires a CheerpX DataDevice');

  // Mirror every bus-emitted phase to the optional `onPhase` callback so
  // the page-level shim (and the e2e harness's `vmPhase === 'ready'`
  // check) can observe the *full* boot lifecycle. Without this, only
  // bootLinux's progress hook reaches `__rustWebBox.vmPhase`, and the
  // final `'ready'` transition — which lives here — is invisible.
  const emitPhase = (phase) => {
    busServer.emit('vm.boot', { phase });
    try { onPhase?.(phase); } catch {}
  };

  // One console attached to the page; many bus subscribers can listen.
  const console_ = attachConsole(cx, {
    cols: opts.cols ?? 120,
    rows: opts.rows ?? 30,
  });
  const debug = opts.debug ?? (() => {});
  const logger = opts.logger ?? console;
  const runGuestScript = createGuestScriptRunner({ cx, dataDevice, logger, debug });
  const runtime = {
    ready: false,
    primed: false,
    stage: 'syncing-workspace',
    workspacePrimeError: null,
    workspaceSyncError: null,
    guestSyncError: null,
    lastGuestSyncAt: null,
    shellPrepareError: null,
  };
  const guestSyncState = { knownPaths: new Set() };
  let guestSyncTail = Promise.resolve();
  function handleGuestSyncFrame(encodedPayload) {
    guestSyncTail = guestSyncTail.catch(() => {}).then(async () => {
      const snapshot = decodeWorkspaceSyncPayload(encodedPayload);
      await applyWorkspaceSyncSnapshot(workspace, snapshot, guestSyncState);
      runtime.guestSyncError = null;
      runtime.lastGuestSyncAt = Date.now();
    }).catch((err) => {
      runtime.guestSyncError = err?.message ?? String(err);
      logger?.warn?.('[rust-web-box] guest-to-workspace sync failed:', err);
    });
  }
  const syncFrameParser = createWorkspaceSyncFrameParser({
    onFrame: handleGuestSyncFrame,
    logger,
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
    const visible = syncFrameParser.filter(text);
    if (!visible) return;
    busServer.emit('proc.stdout', { pid: 1, chunk: normaliseCrlf(visible) });
  });

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
  //
  // CheerpX 1.3.0 has a flaky bug allocating new inodes on the
  // OverlayDevice (rust-alpine ext2 + IDBDevice writable layer): roughly
  // 1 in N attempts to mkdir/touch a brand-new path under `/workspace`
  // hangs the underlying `cx.run` *forever* with `TypeError: …reading
  // 'a1'` and `Program exited with code 71`. The exception is logged via
  // `pageerror` but the JS-level promise never settles. Without a
  // timeout, the entire boot stalls at `vmPhase: 'syncing-workspace'`.
  // We bound the prime call so the workbench still reaches
  // `vmPhase: 'ready'` even when the runtime trips the bug; the warm
  // disk image already contains the seed files so the user-facing
  // workspace is intact even if the prime never wrote anything new.
  const PRIME_TIMEOUT_MS = opts.primeTimeoutMs ?? 30_000;
  let primed = false;
  let primingPromise = null;
  async function primeGuestWorkspace() {
    if (primed) return;
    if (primingPromise) return primingPromise;
    primingPromise = (async () => {
      const snap = await workspace.snapshot();
      try {
        await Promise.race([
          runGuestScript(buildWorkspacePrimeScript(snap), {
            name: 'workspace-prime',
            cwd: '/root',
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(
                `workspace prime timed out after ${PRIME_TIMEOUT_MS}ms ` +
                `(suspected CheerpX 1.3.0 OverlayDevice 'a1' hang)`,
              )),
              PRIME_TIMEOUT_MS,
            ),
          ),
        ]);
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

  const skipPrime = opts.skipPrime === true;
  const skipShellLoop = opts.skipShellLoop === true;
  const methods = fullServerMethods({
    workspace,
    status,
    console_,
    runtime,
    runGuestScript,
    primeGuestWorkspace,
    spawn,
    killSub,
    skipPrime,
  });
  busServer.setMethods(methods);
  // Same bound as primeGuestWorkspace: if the 'a1' hang strikes here,
  // we still want bootTask to reach `vmPhase: 'ready'`. The shell
  // profile is convenience; the disk image already ships an equivalent
  // /root/.bash_profile via Dockerfile.disk so the interactive terminal
  // works either way.
  const SHELL_PREPARE_TIMEOUT_MS = opts.shellPrepareTimeoutMs ?? 30_000;
  async function prepareInteractiveShell() {
    try {
      await Promise.race([
        runGuestScript(buildShellProfileScript(), {
          name: 'shell-profile',
          cwd: '/root',
        }),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(
              `shell profile prepare timed out after ${SHELL_PREPARE_TIMEOUT_MS}ms ` +
              `(suspected CheerpX 1.3.0 OverlayDevice 'a1' hang)`,
            )),
            SHELL_PREPARE_TIMEOUT_MS,
          ),
        ),
      ]);
      runtime.shellPrepareError = null;
    } catch (err) {
      runtime.shellPrepareError = err?.message ?? String(err);
      logger?.error?.('[rust-web-box] shell profile preparation failed:', err);
    }
  }

  // CheerpX 1.3.0 has a flaky OverlayDevice bug: writing a brand-new
  // inode under /workspace tends to fire a `TypeError: …reading 'a1'`
  // followed by `Program exited with code 71` and — critically — leaves
  // the entire CheerpX runtime wedged. Once wedged, every subsequent
  // `cx.run` errors with `function signature mismatch`. The wedge can't
  // be recovered from in-process; we have to avoid triggering the bug.
  //
  // The warm rust-alpine disk image now pre-creates every path the prime
  // would otherwise allocate (Cargo.toml, src/main.rs, .vscode/*,
  // README.md, /root/.bash_profile — see web/disk/Dockerfile.disk). Once
  // the disk-latest release is rebuilt against this PR, the prime
  // overwrites EXISTING inodes only, which is reliable. Until the disk
  // republishes, callers that need a guaranteed-clean boot can opt out
  // of the prime entirely with `opts.skipPrime: true`. The e2e harness
  // (which runs against whichever disk-latest is currently published)
  // sets this flag so the boot reaches `vmPhase: 'ready'` without
  // tripping the wedge. End users still get a populated /workspace
  // because Cargo.toml + src/main.rs ship in the disk image.
  const bootTask = (async () => {
    emitPhase('syncing-workspace');
    if (!skipPrime) {
      await prepareInteractiveShell();
      try {
        await primeGuestWorkspace();
      } catch (err) {
        runtime.workspacePrimeError = err?.message ?? String(err);
        // eslint-disable-next-line no-console
        logger?.error?.('[rust-web-box] workspace prime failed:', err);
      }
    } else {
      logger?.warn?.('[rust-web-box] workspace prime skipped (opts.skipPrime=true)');
      runtime.workspacePrimeError = 'skipped';
    }
    if (!skipShellLoop) {
      stopShell = runShellLoop(cx, {
        cwd: runtime.primed ? '/workspace' : '/root',
        onExit: () => busServer.emit('proc.exit', { pid: 1, exitCode: 0 }),
      });
    } else {
      logger?.warn?.('[rust-web-box] interactive shell loop skipped (opts.skipShellLoop=true)');
    }
    runtime.ready = true;
    runtime.stage = 'ready';
    emitPhase('ready');
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
