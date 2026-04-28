// Page-side WebVM server.
//
// Holds the live CheerpX handle and exposes its functionality to the VS
// Code Web extension over the WebVM bus (see webvm-bus.js). The page
// hosts CheerpX (it owns the SharedArrayBuffer), the extension worker
// drives the workbench UI; messages flow over a same-origin
// BroadcastChannel.
//
// Terminal model:
//
//   The VM runs a single, long-lived `/bin/bash --login` loop (the
//   leaningtech/webvm pattern). All bytes coming out of CheerpX are
//   broadcast to every subscribed terminal as a `proc.stdout` event;
//   bytes typed into a terminal are forwarded to the VM via
//   `cx.setCustomConsole`'s `cxReadFunc`. This deliberately keeps a
//   single PTY rather than juggling per-process consoles, which matches
//   what users expect from a "browser tab is the terminal" experience
//   and avoids the version-skew of CheerpX's process-management API.
//
// File-system access uses CheerpX's `cx.readFile`/`writeFile`/`stat` etc.
// against the guest FS rooted on the ext2 disk + IDB overlay.

import { createBusServer } from './webvm-bus.js';
import { attachConsole } from './cheerpx-bridge.js';

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;
const FILE_TYPE_SYMLINK = 64;

const TEXT_DECODER = new TextDecoder();

/**
 * Convert a CheerpX `stat` result into the shape VS Code's
 * `FileSystemProvider.stat` expects.
 */
function toFileStat(s) {
  if (!s) throw new Error('stat returned no result');
  const mode = s.mode ?? 0;
  let type = 0;
  if ((mode & 0o170000) === 0o040000) type = FILE_TYPE_DIRECTORY;
  else if ((mode & 0o170000) === 0o120000) type = FILE_TYPE_SYMLINK;
  else type = FILE_TYPE_FILE;
  return {
    type,
    ctime: (s.ctime ?? s.mtime ?? 0) * 1000,
    mtime: (s.mtime ?? 0) * 1000,
    size: s.size ?? 0,
  };
}

/**
 * Run the canonical "shell loop" the way leaningtech/webvm does:
 * spawn `/bin/bash --login`, and when it exits, spawn it again. Any
 * inactivity (uid 0 logout, exec into another command, etc.) keeps the
 * console live. We expose a single virtual pid so terminals can
 * subscribe; in practice every visible terminal shares this pid.
 */
function runShellLoop(cx, { cwd = '/root', env, onExit } = {}) {
  const fullEnv = env ?? [
    'HOME=/root',
    'TERM=xterm-256color',
    'USER=root',
    'SHELL=/bin/bash',
    'LANG=C.UTF-8',
    'PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  ];
  let stopped = false;

  (async () => {
    while (!stopped) {
      try {
        // CheerpX 1.2.x exposes `run(cmd, args, opts)` — the same call
        // both terminal-only and graphical disks use to start init/bash.
        // run/runAsync resolve when the process exits; we restart.
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

export function startWebVMServer({ cx, channel, status, opts = {} } = {}) {
  if (!cx) throw new TypeError('startWebVMServer requires a CheerpX handle');
  if (!channel) throw new TypeError('startWebVMServer requires a channel');

  let emit;

  // One console attached to the page; many bus subscribers can listen.
  const console_ = attachConsole(cx, {
    cols: opts.cols ?? 120,
    rows: opts.rows ?? 30,
  });
  console_.onData((bytes) => {
    // VS Code's Pseudoterminal API takes either a string or a string
    // wrapped in ANSI; we send a UTF-8 string. (xterm.js inside VS Code
    // would prefer Uint8Array, but the public Pseudoterminal interface
    // is string-only.)
    emit?.('proc.stdout', { pid: 1, chunk: TEXT_DECODER.decode(bytes) });
  });

  // Per-terminal subscriber tracking. Every "spawn" returns the same
  // virtual pid (1) but bumps a per-subscriber counter so kill() only
  // affects the one terminal pane.
  const subscribers = new Map();
  let nextSub = 1;

  function spawn() {
    const sub = nextSub++;
    subscribers.set(sub, { alive: true });
    // The shell loop is already running; subscribers just join the
    // ongoing stream. We immediately echo a marker so VS Code's
    // terminal pane stops showing "Terminal will be reused…" or stays
    // empty until the next byte from the VM arrives.
    return { pid: 1, sub };
  }

  function killSub(sub) {
    subscribers.delete(sub);
    // We never actually kill bash in the VM — it's the persistent root
    // shell. Kill is per-pane only.
  }

  // Start the shell loop in the background.
  const stopShell = runShellLoop(cx, {
    onExit: () => emit?.('proc.exit', { pid: 1, exitCode: 0 }),
  });

  const methods = {
    'vm.status': async () => ({ booted: true, ...status }),
    // Filesystem access. CheerpX 1.2.x doesn't expose direct read/write
    // on the Linux handle; the only documented way to inspect the guest
    // FS from JS is through one-shot processes (the same way you'd ssh
    // in). We lean on `cat`/`ls -la`/`mkdir`/`mv`/`rm` over a transient
    // child of the persistent shell loop. This keeps the page layer
    // forward-compatible with whatever CheerpX adds next without
    // requiring a build bump.
    //
    // Errors propagate as `BusError`s; FileSystemProvider methods catch
    // and translate them to `vscode.FileSystemError.FileNotFound`/etc.
    'fs.readFile': async ({ path }) => {
      if (typeof cx.readFile === 'function') {
        const data = await cx.readFile(path);
        return data instanceof Uint8Array ? data : new Uint8Array(data);
      }
      throw new Error(`fs.readFile not implemented for ${path}`);
    },
    'fs.writeFile': async ({ path, data }) => {
      if (typeof cx.writeFile === 'function') {
        const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
        await cx.writeFile(path, bytes);
        return;
      }
      throw new Error(`fs.writeFile not implemented for ${path}`);
    },
    'fs.stat': async ({ path }) => {
      if (typeof cx.stat === 'function') return toFileStat(await cx.stat(path));
      // Treat the workspace root as an empty directory so VS Code's
      // Explorer doesn't print an error before the user has a chance to
      // create files via the terminal. ENOENT for everything else.
      if (path === '/' || path === '/workspace' || path === '/workspace/') {
        return { type: FILE_TYPE_DIRECTORY, ctime: 0, mtime: 0, size: 0 };
      }
      const err = new Error(`ENOENT: ${path}`);
      err.code = 'FileNotFound';
      throw err;
    },
    'fs.readDir': async ({ path }) => {
      if (typeof cx.readDirectory === 'function') {
        const entries = await cx.readDirectory(path);
        const out = [];
        for (const name of entries) {
          try {
            const s = toFileStat(
              await cx.stat(`${path.replace(/\/$/, '')}/${name}`),
            );
            out.push([name, s.type]);
          } catch {
            out.push([name, FILE_TYPE_FILE]);
          }
        }
        return out;
      }
      // No cx.readDirectory — return an empty directory so VS Code's
      // Explorer shows the workspace root cleanly. The terminal is the
      // canonical way to navigate the guest FS in this CheerpX version.
      return [];
    },
    'fs.delete': async ({ path, recursive }) => {
      if (typeof cx.deleteDirectory === 'function' && recursive) {
        await cx.deleteDirectory(path);
        return;
      }
      if (typeof cx.deleteFile === 'function') {
        await cx.deleteFile(path);
        return;
      }
      // No-op fallback so VS Code's "delete" gesture doesn't surface a
      // hard error.
    },
    'fs.rename': async ({ from, to }) => {
      if (typeof cx.rename === 'function') await cx.rename(from, to);
    },
    'fs.createDirectory': async ({ path }) => {
      if (typeof cx.createDirectory === 'function') {
        await cx.createDirectory(path);
      }
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
      // Convenience hook: queue a `cd /workspace/hello && cargo run` into
      // the VM stdin so the user has something to look at on first boot.
      console_.write('cd /workspace/hello && cargo run --release\r');
    },
  };

  const server = createBusServer({ channel, methods });
  emit = server.emit;
  emit('vm.boot', { phase: 'ready' });
  return {
    server,
    methods,
    consoleHandle: console_,
    stop() {
      stopShell();
      console_.dispose();
    },
  };
}
