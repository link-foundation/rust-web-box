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
import { dumpRuntime, formatDiagnosticsForTerminal } from './debug.js';
import {
  applyWorkspaceSyncSnapshot,
  buildGuestTargetSnapshotScript,
  buildGuestSyncProfileBlock,
  createWorkspaceSyncFrameParser,
  decodeWorkspaceSyncPayload,
} from './workspace-sync.js';
import {
  buildCargoBenchScript,
  createCargoBenchFrameParser,
  parseCargoBenchPayload,
  summarizeCargoBench,
} from './cargo-bench.js';

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
  'CARGO_INCREMENTAL=0',
  'PS1=root@rust-web-box:\\w# ',
  // Keep bash from allocating a brand-new ~/.bash_history inode on the
  // CheerpX OverlayDevice — fresh-inode allocation is what trips the
  // 'a1' wedge (issue #37). Writing to /dev/null reuses an existing inode.
  'HISTFILE=/dev/null',
];

const LEAN_CARGO_DEV_PROFILE_SCRIPT = [
  '__rwb_apply_cargo_profile() {',
  '  [ -f /root/.cargo/config.toml ] || return 0',
  "  grep -Eq '^[[:space:]]*debug[[:space:]]*=[[:space:]]*0[[:space:]]*$' /root/.cargo/config.toml || return 0",
  "  grep -Eq '^[[:space:]]*codegen-units[[:space:]]*=[[:space:]]*1[[:space:]]*$' /root/.cargo/config.toml || return 0",
  '  export CARGO_PROFILE_DEV_DEBUG=0',
  '  export CARGO_PROFILE_DEV_CODEGEN_UNITS=1',
  '  export CARGO_PROFILE_DEV_INCREMENTAL=false',
  '}',
  '__rwb_apply_cargo_profile',
  'unset -f __rwb_apply_cargo_profile 2>/dev/null || true',
];

// A `/bin/bash --login` that spawns and immediately dies (throws, or
// exits within this many ms) is not a usable interactive terminal — it
// is the signature of the iPad-Safari terminal failure from issue #37,
// where the cursor never reaches a shell prompt. We treat that as a
// "fast cycle" and, after a few in a row, surface a diagnostic so the
// root cause is observable instead of silently retried forever.
const SHELL_FAST_CYCLE_MS = 750;
const SHELL_FAST_CYCLE_LIMIT = 3;

// The *other* iPad-Safari failure mode (issue #37): bash spawns and does
// NOT die — it just never produces any visible output, so the terminal
// shows a lone cursor and no `root@rust-web-box:/workspace#` prompt
// forever. This is the CheerpX OverlayDevice wedge striking *inside*
// bash startup rather than during the prime. The fast-cycle detector
// above cannot see it (there is no exit, no error, no rapid respawn), so
// we add a per-spawn watchdog: if bash produces no visible bytes within
// this window, we treat the shell as silently hung, record it, and write
// a visible advisory into the terminal so the user sees an actionable
// message instead of a blank tofu cursor.
const SHELL_FIRST_OUTPUT_TIMEOUT_MS = 15_000;

// Opt-in per-`cx.run` timing (issue #41). Every `cx.run` the server issues —
// boot prime, shell profile, each workspace-sync script, the shell loop's
// bash spawns, the cargo benchmark — pays CheerpX's cold-start interpreter +
// the WASM/JS syscall boundary. To find the EXACT bottleneck the issue asks
// about, we record the wall-clock of each of those calls into a bounded ring
// buffer when `globalThis.__RWB_DEBUG_VM_TIMING` is set. It is OFF by default
// (mirroring `__RWB_DEBUG_TERMINAL_STREAM`), so there is zero overhead in
// normal use: `record()` returns immediately and the buffer stays empty.
const VM_TIMINGS_MAX = 500;

function createVmTimings({ logger = console } = {}) {
  const entries = [];
  return {
    entries,
    get enabled() {
      return typeof globalThis !== 'undefined' && !!globalThis.__RWB_DEBUG_VM_TIMING;
    },
    record(entry) {
      if (!this.enabled) return;
      entries.push({ at: Date.now(), ...entry });
      if (entries.length > VM_TIMINGS_MAX) entries.shift();
      try {
        // eslint-disable-next-line no-console
        (logger?.log ?? console.log)(
          `[rwb:vm-timing] ${entry.kind}`,
          entry.label ?? '',
          `${Math.round(entry.elapsedMs)}ms`,
          entry.exitCode != null ? `exit=${entry.exitCode}` : '',
          entry.error ? `error=${entry.error}` : '',
        );
      } catch {}
    },
    snapshot() {
      return entries.slice();
    },
  };
}

/**
 * Run the canonical "shell loop" the way leaningtech/webvm does:
 * spawn `/bin/bash --login`, and when it exits, spawn it again.
 *
 * Every spawn / exit / error is recorded into `diag` (when supplied) so
 * `dumpRuntime()` can report whether the terminal ever actually came up,
 * how many times bash respawned, and the last exit code / error. This is
 * the verbose-mode hook issue #37 asks for: on a device where the shell
 * never starts (e.g. iPad Safari), the diagnostics make the failure mode
 * visible on the next iteration instead of being swallowed by the retry.
 */
function runShellLoop(cx, {
  cwd = '/root',
  env = BASH_ENV,
  onExit,
  debug = () => {},
  diag = null,
  onUnhealthy,
  onSilentStart,
  firstOutputTimeoutMs = SHELL_FIRST_OUTPUT_TIMEOUT_MS,
  recordTiming = () => {},
} = {}) {
  const fullEnv = env;
  let stopped = false;
  let unhealthyNotified = false;

  const noteFastCycle = (kind, detail) => {
    if (!diag) return;
    diag.fastCycles = (diag.fastCycles ?? 0) + 1;
    if (diag.fastCycles >= SHELL_FAST_CYCLE_LIMIT && !unhealthyNotified) {
      unhealthyNotified = true;
      diag.healthy = false;
      try { onUnhealthy?.({ kind, detail, diag }); } catch {}
    }
  };

  // Per-spawn "first output" watchdog. bash producing no visible bytes
  // within `firstOutputTimeoutMs` of a spawn is the silent-hang signature
  // (issue #37, iPad Safari): the loop is still "running" but the user
  // sees nothing. We compare `diag.outputBytes` (incremented by the
  // server's onData handler) before and after the window. Fires at most
  // once per spawn and never disturbs a shell that is merely slow but
  // does eventually print.
  const armFirstOutputWatchdog = (spawnSeq, bytesAtSpawn) => {
    if (!diag || !(firstOutputTimeoutMs > 0)) return () => {};
    const timer = setTimeout(() => {
      if (stopped) return;
      const sawOutput = (diag.outputBytes ?? 0) > bytesAtSpawn;
      const stillRunning = diag.running && diag.spawns === spawnSeq;
      if (sawOutput || !stillRunning) return;
      diag.silentSpawns = (diag.silentSpawns ?? 0) + 1;
      diag.slowFirstOutput = true;
      diag.lastSilentSpawnAt = Date.now();
      const detail = {
        elapsedMs: firstOutputTimeoutMs,
        spawn: spawnSeq,
        cwd,
      };
      try { onSilentStart?.({ kind: 'no-output', detail, diag }); } catch {}
    }, firstOutputTimeoutMs);
    if (typeof timer?.unref === 'function') timer.unref();
    return () => clearTimeout(timer);
  };

  (async () => {
    while (!stopped) {
      const startedAt = Date.now();
      const spawnSeq = (diag?.spawns ?? 0) + 1;
      const bytesAtSpawn = diag?.outputBytes ?? 0;
      if (diag) {
        diag.spawns = spawnSeq;
        diag.lastSpawnAt = startedAt;
        diag.running = true;
      }
      debug('shell loop spawn #%d (cwd=%s)', diag?.spawns ?? 0, cwd);
      const disarmWatchdog = armFirstOutputWatchdog(spawnSeq, bytesAtSpawn);
      try {
        const fn = cx.run ?? cx.runAsync;
        if (typeof fn !== 'function') throw new Error('CheerpX missing run()');
        const code = await fn.call(cx, '/bin/bash', ['--login'], {
          env: fullEnv,
          cwd,
          uid: 0,
          gid: 0,
        });
        disarmWatchdog();
        const elapsed = Date.now() - startedAt;
        if (diag) {
          diag.exits = (diag.exits ?? 0) + 1;
          diag.lastExitCode = typeof code === 'number' ? code : null;
          diag.lastExitAt = Date.now();
          diag.running = false;
        }
        debug('shell loop exit #%d (code=%o, after %dms)', diag?.exits ?? 0, code, elapsed);
        recordTiming({
          kind: 'shell-spawn',
          label: `bash --login (#${spawnSeq})`,
          elapsedMs: elapsed,
          exitCode: typeof code === 'number' ? code : null,
        });
        if (elapsed < SHELL_FAST_CYCLE_MS) noteFastCycle('exit', { code, elapsed });
        else if (diag) diag.fastCycles = 0;
      } catch (err) {
        disarmWatchdog();
        const message = err?.message ?? String(err);
        const elapsed = Date.now() - startedAt;
        if (diag) {
          diag.errors = (diag.errors ?? 0) + 1;
          diag.lastError = message;
          diag.lastErrorAt = Date.now();
          diag.running = false;
        }
        debug('shell loop error #%d after %dms: %s', diag?.errors ?? 0, elapsed, message);
        recordTiming({
          kind: 'shell-spawn',
          label: `bash --login (#${spawnSeq})`,
          elapsedMs: elapsed,
          error: message,
        });
        // eslint-disable-next-line no-console
        console.warn('[rust-web-box] bash loop error:', err);
        noteFastCycle('error', { message, elapsed });
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
    // See BASH_ENV: avoid allocating a fresh ~/.bash_history inode on the
    // CheerpX OverlayDevice, which can trip the 'a1' wedge (issue #37).
    'export HISTFILE=/dev/null',
    ...LEAN_CARGO_DEV_PROFILE_SCRIPT,
    'export PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'export PS1="root@rust-web-box:\\w# "',
    'cd /workspace 2>/dev/null || cd /root',
    buildGuestSyncProfileBlock().trimEnd(),
    'RWB_PROFILE',
  ].join('\n') + '\n';
}

function scriptForWrite(path, bytes) {
  return [
    heredocForFile(path, bytes),
    cargoFreshnessMtimeScript(path),
  ].filter(Boolean).join('\n') + '\n';
}

function cargoFreshnessMtimeScript(path) {
  if (!isCargoInputPath(path)) return '';
  const quotedPath = shellQuote(path);
  return [
    // The warm disk can contain target artifacts whose mtimes are ahead
    // of CheerpX's current clock. Mark existing target metadata old
    // after a browser save so Cargo rebuilds instead of reusing the
    // prebaked binary.
    'if [ -d /workspace/target ]; then',
    '  find /workspace/target -exec touch -t 197001010000 {} \\; 2>/dev/null || true',
    'fi',
    // CheerpX lower-layer deletes can leave pre-baked files visible, and
    // guest clocks/mtimes are not reliable enough by themselves. Mark
    // Cargo's text fingerprint hashes stale while leaving binary dep-info
    // files intact, so Cargo's dirty check can safely rebuild.
    'for __rwb_fp_dir in /workspace/target/debug/.fingerprint/* /workspace/target/release/.fingerprint/*; do',
    '  [ -d "$__rwb_fp_dir" ] || continue',
    '  for __rwb_marker in "$__rwb_fp_dir"/bin-* "$__rwb_fp_dir"/lib-* "$__rwb_fp_dir"/test-* "$__rwb_fp_dir"/bench-* "$__rwb_fp_dir"/example-* "$__rwb_fp_dir"/build-script-*; do',
    '    [ -f "$__rwb_marker" ] || continue',
    '    case "$__rwb_marker" in *.json|*/dep-*|*/invoked.timestamp) continue ;; esac',
    "    printf '%s' '0000000000000000' > \"$__rwb_marker\" 2>/dev/null || true",
    '    touch -t 197001010000 "$__rwb_marker" 2>/dev/null || true',
    '  done',
    'done',
    'unset __rwb_fp_dir __rwb_marker 2>/dev/null || true',
    `touch -m '${quotedPath}' 2>/dev/null || true`,
  ].join('\n');
}

function isCargoInputPath(path) {
  const p = String(path ?? '');
  return p === '/workspace/Cargo.toml' ||
    p === '/workspace/Cargo.lock' ||
    p.endsWith('.rs');
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

function createGuestScriptRunner({
  cx,
  dataDevice,
  logger = console,
  debug = () => {},
  recordTiming = () => {},
} = {}) {
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
        // Time the real `cx.run` so issue #41 diagnostics can attribute cost
        // to each staged script (prime / shell-profile / sync / bench).
        const startedAt = Date.now();
        let exitCode = null;
        try {
          const code = await run.call(cx, '/bin/sh', [guestPath], {
            env: GUEST_ENV,
            cwd,
            uid: 0,
            gid: 0,
          });
          exitCode = typeof code === 'number' ? code : null;
          recordTiming({
            kind: 'guest-script',
            label: name,
            elapsedMs: Date.now() - startedAt,
            exitCode,
          });
        } catch (err) {
          recordTiming({
            kind: 'guest-script',
            label: name,
            elapsedMs: Date.now() - startedAt,
            error: err?.message ?? String(err),
          });
          throw err;
        }
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
  refreshGuestTarget,
  runCargoBench,
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
      vmTimingCount: runtime.vmTimings?.entries?.length ?? 0,
      ...status,
    }),
    // Issue #43: a structured runtime snapshot delivered over the bus so
    // the VS Code extension can surface diagnostics in the terminal (and
    // anywhere else) without forcing the user to a browser console that
    // iPadOS Safari doesn't expose. Includes a pre-rendered terminal block
    // so the consumer doesn't need to know the formatting.
    'vm.diagnostics': async () => {
      const dump = diagnostics();
      return {
        dump,
        terminalText: formatDiagnosticsForTerminal(dump, { ansi: true, eol: '\r\n' }),
      };
    },
    // Issue #41: run the real cargo build inside the live VM and report
    // per-phase wall-clock timing + the rustc time-passes split. This is a
    // measurement, not a workaround — it runs the user's actual `cargo run` /
    // `cargo build` / `cargo check`. It is slow on purpose (the whole point
    // is to time the slow build), so callers should treat it as a deliberate
    // diagnostic. Returns the structured result from parseCargoBenchPayload.
    'vm.benchCargo': async (params = {}) => {
      if (typeof runCargoBench !== 'function') {
        throw new Error('cargo benchmark is not available on this server');
      }
      return await runCargoBench(params ?? {});
    },
    'fs.readFile': async ({ path }) => await workspace.readFile(path),
    'fs.writeFile': async ({ path, data, options }) => {
      const buf = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
      await assertWritable(path, options);
      await syncGuest(scriptForWrite(path, buf), 'workspace-sync');
      await workspace.writeFile(path, buf, options);
    },
    'fs.stat': async ({ path }) => await workspace.stat(path),
    'fs.readDir': async ({ path }) => {
      if (isTargetTreePath(path) && typeof refreshGuestTarget === 'function') {
        try {
          await refreshGuestTarget(path);
        } catch (err) {
          runtime.guestSyncError = err?.message ?? String(err);
          // Keep Explorer usable with the last cached target metadata if
          // CheerpX is temporarily busy or fails during an on-demand scan.
          // eslint-disable-next-line no-console
          console.warn('[rust-web-box] target refresh failed:', err);
        }
      }
      return await workspace.readDirectory(path);
    },
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
      // would trip the CheerpX 1.3.x OverlayDevice 'a1' wedge that
      // skipPrime exists to avoid. The disk image already ships a
      // populated /workspace, so a no-op here is safe.
      if (skipPrime) return;
      await primeGuestWorkspace();
    },
  };
}

function isTargetTreePath(path) {
  const p = String(path ?? '').replace(/\/+$/, '');
  return p === '/workspace/target' || p.startsWith('/workspace/target/');
}

function normalizeTargetTreePath(path) {
  const p = String(path ?? '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  return isTargetTreePath(p) ? p : '/workspace/target';
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
  // Issue #43: iPadOS Safari has no usable developer console, so the shell
  // diagnostics must be printable *in the terminal*. Defaults to a snapshot
  // that merges the live `runtime` (always populated, even in headless tests)
  // with whatever boot.js has pinned to `globalThis.__rustWebBox` (browser
  // tells, vmPhase, isolation flags). Overridable for tests.
  const diagnostics = opts.diagnostics ?? (() => {
    const live = globalThis.__rustWebBox || {};
    const merged = {
      ...globalThis,
      __rustWebBox: {
        ...live,
        vmServer: live.vmServer ?? { runtime },
      },
    };
    return dumpRuntime(merged);
  });
  // Issue #41: opt-in per-cx.run timing (see createVmTimings). OFF unless
  // `globalThis.__RWB_DEBUG_VM_TIMING` is set, so it costs nothing normally.
  const vmTimings = createVmTimings({ logger });
  const recordTiming = (entry) => vmTimings.record(entry);
  const runGuestScript = createGuestScriptRunner({ cx, dataDevice, logger, debug, recordTiming });
  const runtime = {
    ready: false,
    primed: false,
    stage: 'syncing-workspace',
    workspacePrimeError: null,
    workspaceSyncError: null,
    guestSyncError: null,
    lastGuestSyncAt: null,
    shellPrepareError: null,
    // Interactive-shell health, populated by runShellLoop. `healthy`
    // flips to false after repeated fast spawn→exit cycles (the iPad
    // Safari terminal-never-starts signature from issue #37). The
    // `outputBytes` / `silentSpawns` / `slowFirstOutput` fields track the
    // *other* iPad signature: bash that spawns but never prints a prompt.
    shellLoop: {
      healthy: true,
      running: false,
      spawns: 0,
      exits: 0,
      errors: 0,
      fastCycles: 0,
      // Visible bytes bash has emitted so far (incremented by the onData
      // handler below). The first-output watchdog compares this across a
      // spawn window to detect a silently-hung shell.
      outputBytes: 0,
      firstOutputAt: null,
      lastOutputAt: null,
      silentSpawns: 0,
      slowFirstOutput: false,
      lastSilentSpawnAt: null,
      lastSpawnAt: null,
      lastExitAt: null,
      lastExitCode: null,
      lastError: null,
      lastErrorAt: null,
    },
  };
  // Expose the timing ring buffer for `__rustWebBox.dump()` / diagnostics.
  runtime.vmTimings = vmTimings;
  const guestSyncState = { knownPaths: new Set() };
  let guestSyncTail = Promise.resolve();
  const guestSyncWaiters = new Set();

  function settleGuestSyncWaiter(waiter, err, snapshot) {
    clearTimeout(waiter.timer);
    guestSyncWaiters.delete(waiter);
    if (err) waiter.reject(err);
    else waiter.resolve(snapshot);
  }

  function settleMatchingGuestSyncWaiters(snapshot) {
    if (!snapshot?.scope) return;
    for (const waiter of [...guestSyncWaiters]) {
      if (waiter.scope === snapshot.scope) {
        settleGuestSyncWaiter(waiter, null, snapshot);
      }
    }
  }

  function rejectGuestSyncWaiters(err) {
    for (const waiter of [...guestSyncWaiters]) {
      settleGuestSyncWaiter(waiter, err);
    }
  }

  function waitForGuestSyncScope(scope, timeoutMs = opts.targetRefreshTimeoutMs ?? 10_000) {
    let waiter;
    const promise = new Promise((resolve, reject) => {
      waiter = {
        scope,
        resolve,
        reject,
        timer: setTimeout(
          () => settleGuestSyncWaiter(
            waiter,
            new Error(`timed out waiting for guest sync scope ${scope}`),
          ),
          timeoutMs,
        ),
      };
      guestSyncWaiters.add(waiter);
    });
    return {
      promise,
      cancel() {
        if (guestSyncWaiters.has(waiter)) {
          clearTimeout(waiter.timer);
          guestSyncWaiters.delete(waiter);
        }
      },
    };
  }

  function handleGuestSyncFrame(encodedPayload) {
    guestSyncTail = guestSyncTail.catch(() => {}).then(async () => {
      const snapshot = decodeWorkspaceSyncPayload(encodedPayload);
      await applyWorkspaceSyncSnapshot(workspace, snapshot, guestSyncState);
      runtime.guestSyncError = null;
      runtime.lastGuestSyncAt = Date.now();
      settleMatchingGuestSyncWaiters(snapshot);
    }).catch((err) => {
      runtime.guestSyncError = err?.message ?? String(err);
      logger?.warn?.('[rust-web-box] guest-to-workspace sync failed:', err);
      rejectGuestSyncWaiters(err);
    });
  }

  let targetRefreshTail = Promise.resolve();
  function refreshGuestTarget(path) {
    targetRefreshTail = targetRefreshTail.catch(() => {}).then(async () => {
      const scope = normalizeTargetTreePath(path);
      const synced = waitForGuestSyncScope(scope);
      try {
        console_.reattach?.();
        await runGuestScript(buildGuestTargetSnapshotScript(scope), {
          name: 'workspace-target-refresh',
          cwd: '/workspace',
        });
        await synced.promise;
      } catch (err) {
        synced.cancel();
        throw err;
      }
    });
    return targetRefreshTail;
  }
  const syncFrameParser = createWorkspaceSyncFrameParser({
    onFrame: handleGuestSyncFrame,
    logger,
  });

  // Issue #41: cargo benchmark readback. The guest emits a single
  // `rust-web-box-bench` OSC frame at the end of the bench run; we parse it
  // off the stdout stream (same mechanism as workspace-sync) and resolve the
  // pending `runCargoBench` promise. Bench runs are serialised through
  // `benchTail` so two callers can't interleave their measurements.
  const benchWaiters = new Set();
  function handleCargoBenchFrame(encodedPayload) {
    let parsed = null;
    let parseError = null;
    try {
      parsed = parseCargoBenchPayload(encodedPayload);
    } catch (err) {
      parseError = err;
      logger?.warn?.('[rust-web-box] cargo bench payload decode failed:', err);
    }
    for (const waiter of [...benchWaiters]) {
      clearTimeout(waiter.timer);
      benchWaiters.delete(waiter);
      if (parseError) waiter.reject(parseError);
      else waiter.resolve(parsed);
    }
  }
  function waitForCargoBench(timeoutMs) {
    let waiter;
    const promise = new Promise((resolve, reject) => {
      waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          benchWaiters.delete(waiter);
          reject(new Error(`timed out waiting for cargo bench results after ${timeoutMs}ms`));
        }, timeoutMs),
      };
      benchWaiters.add(waiter);
    });
    return {
      promise,
      cancel() {
        if (benchWaiters.has(waiter)) {
          clearTimeout(waiter.timer);
          benchWaiters.delete(waiter);
        }
      },
    };
  }
  const benchFrameParser = createCargoBenchFrameParser({
    onFrame: handleCargoBenchFrame,
    logger,
  });

  let benchTail = Promise.resolve();
  function runCargoBench(benchOpts = {}) {
    // The in-browser build is minutes long by design (that is the thing we
    // are measuring); default generously and let callers override.
    const timeoutMs = benchOpts.timeoutMs ?? opts.cargoBenchTimeoutMs ?? 1_800_000;
    benchTail = benchTail.catch(() => {}).then(async () => {
      const startedAt = Date.now();
      const waiter = waitForCargoBench(timeoutMs);
      try {
        console_.reattach?.();
        await runGuestScript(
          buildCargoBenchScript(benchOpts),
          { name: 'cargo-bench', cwd: benchOpts.workspaceDir ?? '/workspace' },
        );
        const result = await waiter.promise;
        const wallMs = Date.now() - startedAt;
        recordTiming({ kind: 'bench', label: 'cargo-bench', elapsedMs: wallMs, exitCode: 0 });
        try {
          // eslint-disable-next-line no-console
          (logger?.log ?? console.log)(`\n${summarizeCargoBench(result, { wallMs })}\n`);
        } catch {}
        return { ...result, wallMs };
      } catch (err) {
        waiter.cancel();
        recordTiming({
          kind: 'bench',
          label: 'cargo-bench',
          elapsedMs: Date.now() - startedAt,
          error: err?.message ?? String(err),
        });
        throw err;
      }
    });
    return benchTail;
  }
  // Streaming decoder so multi-byte UTF-8 split across CheerpX writes
  // doesn't decode to U+FFFD. Stateful CRLF normaliser so xterm.js
  // (under VS Code's Pseudoterminal) renders bash output without the
  // staircase indentation that bare-LF would otherwise produce.
  const stdoutDecoder = new TextDecoder('utf-8', { fatal: false });
  const normaliseCrlf = createLfToCrlfNormaliser();
  // Issue #27: opt-in trace for the terminal byte-stream pipeline. Set
  // `window.__RWB_DEBUG_TERMINAL_STREAM = true` in DevTools to log every
  // visible chunk plus listener count, which makes "duplicate output"
  // regressions trivially diagnosable. Off by default (zero overhead).
  let stdoutChunkCount = 0;
  console_.onData((bytes) => {
    const text = stdoutDecoder.decode(bytes, { stream: true });
    if (!text) return;
    // Strip workspace-sync frames first (unchanged behaviour), then the
    // issue #41 cargo-bench frames, so neither pollutes the visible terminal.
    const visible = benchFrameParser.filter(syncFrameParser.filter(text));
    if (!visible) return;
    const chunk = normaliseCrlf(visible);
    // Feed the interactive-shell first-output watchdog (issue #37). Any
    // visible byte from bash means the terminal is alive; the watchdog in
    // runShellLoop reads these counters to tell a working shell apart from
    // one that spawned but silently hung.
    const shellDiag = runtime.shellLoop;
    if (shellDiag) {
      const now = Date.now();
      shellDiag.outputBytes = (shellDiag.outputBytes ?? 0) + chunk.length;
      shellDiag.lastOutputAt = now;
      if (shellDiag.firstOutputAt == null) shellDiag.firstOutputAt = now;
    }
    if (
      typeof globalThis !== 'undefined' &&
      globalThis.__RWB_DEBUG_TERMINAL_STREAM
    ) {
      stdoutChunkCount += 1;
      // eslint-disable-next-line no-console
      console.log(
        `[rwb:terminal-stream] #${stdoutChunkCount} bytes=${chunk.length}`,
        JSON.stringify(chunk.slice(0, 80)),
      );
    }
    busServer.emit('proc.stdout', { pid: 1, chunk });
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
  // CheerpX 1.3.x has a flaky bug allocating new inodes on the
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
                `(suspected CheerpX 1.3.x OverlayDevice 'a1' hang)`,
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
    refreshGuestTarget,
    runCargoBench,
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
              `(suspected CheerpX 1.3.x OverlayDevice 'a1' hang)`,
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

  // CheerpX 1.3.x has a flaky OverlayDevice bug: writing a brand-new
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
      let silentAdvisoryShown = false;
      stopShell = runShellLoop(cx, {
        cwd: runtime.primed ? '/workspace' : '/root',
        onExit: () => busServer.emit('proc.exit', { pid: 1, exitCode: 0 }),
        debug,
        diag: runtime.shellLoop,
        recordTiming,
        firstOutputTimeoutMs: opts.shellFirstOutputTimeoutMs,
        onUnhealthy: ({ kind, detail }) => {
          // The interactive shell keeps dying immediately — the terminal
          // will never show a prompt. Make it loud (issue #37): the
          // failure is otherwise invisible behind the silent retry.
          logger?.error?.(
            '[rust-web-box] interactive shell is unhealthy:',
            kind,
            detail,
            runtime.shellLoop,
          );
          busServer.emit('vm.shell', { healthy: false, kind, detail });
          try { opts.onShellUnhealthy?.({ kind, detail, diag: runtime.shellLoop }); } catch {}
        },
        onSilentStart: ({ kind, detail }) => {
          // bash spawned but produced no prompt within the watchdog
          // window — the iPad-Safari silent-hang from issue #37. We can't
          // un-wedge CheerpX from JS, but we MUST NOT leave the user
          // staring at a blank tofu cursor: surface a visible, actionable
          // advisory directly in the terminal, plus structured diagnostics.
          logger?.warn?.(
            '[rust-web-box] interactive shell produced no output:',
            kind,
            detail,
            runtime.shellLoop,
          );
          busServer.emit('vm.shell', { healthy: false, kind, detail });
          if (!silentAdvisoryShown) {
            silentAdvisoryShown = true;
            // Print the diagnostics *into the terminal* (issue #43): iPadOS
            // Safari has no usable developer console, so a "run
            // __rustWebBox.dump() in the browser console" hint is a dead end
            // on the very device this fails on. The user is already looking
            // at the terminal — put the debug data there.
            let diagBlock = '';
            try {
              diagBlock = formatDiagnosticsForTerminal(diagnostics(), {
                ansi: true,
                eol: '\r\n',
              });
            } catch (err) {
              diagBlock = `  (diagnostics unavailable: ${err?.message ?? err})\r\n`;
            }
            const advisory =
              '\r\n\x1b[33m[rust-web-box]\x1b[0m The Linux shell started but ' +
              'produced no prompt.\r\n' +
              'This is the known CheerpX/WebVM terminal issue on ' +
              'Safari/iPad (rust-web-box#37).\r\n' +
              'Workarounds: reload the tab, or open this site in a ' +
              'Chromium-based browser.\r\n' +
              diagBlock;
            busServer.emit('proc.stdout', { pid: 1, chunk: advisory });
          }
          try { opts.onShellUnhealthy?.({ kind, detail, diag: runtime.shellLoop }); } catch {}
        },
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
    // Exposed so the page-level shim / dumpRuntime() can report live
    // interactive-shell health (issue #37 diagnostics).
    runtime,
    // Issue #41 diagnostics: opt-in cx.run timing ring buffer + the real
    // in-VM cargo benchmark. `vmTimings.snapshot()` returns recorded calls;
    // `runCargoBench()` runs the actual build and resolves with per-phase
    // timing. Surfaced here so a page-level shim can wire them to the console.
    vmTimings,
    runCargoBench,
    stop() {
      stopShell();
      console_.dispose();
    },
  };
}
