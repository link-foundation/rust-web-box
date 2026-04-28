// Page-side WebVM server.
//
// Holds the live CheerpX handle and exposes its functionality to the VS
// Code Web extension over the WebVM bus (see `webvm-bus.js`). One server
// per page; the workbench iframe / extension worker is the client.
//
// CheerpX's `Linux` API is shaped around running individual processes
// (`run`/`runAsync`), not maintaining a persistent shell with arbitrary
// stdio. To present a long-lived bash session to VS Code, we keep a
// dedicated "session" process (typically `/bin/bash --login`) wired to
// a console sink whose mutations stream out as `proc.stdout` events.
//
// File-system access uses CheerpX's helper API — `cx.readFile`,
// `cx.writeFile`, `cx.readDirectory`, `cx.stat` — which surface the
// guest FS (rooted at the ext2 disk + IDB overlay) to JS.

import { createBusServer } from './webvm-bus.js';
import { createConsoleSink } from './cheerpx-bridge.js';

const FILE_TYPE_FILE = 1;
const FILE_TYPE_DIRECTORY = 2;
const FILE_TYPE_SYMLINK = 64;

/**
 * Convert a CheerpX `stat` result into the shape VS Code's
 * `FileSystemProvider.stat` expects.
 */
function toFileStat(s) {
  if (!s) throw new Error('stat returned no result');
  // CheerpX's stat returns POSIX mode + size + mtime; map mode to VS Code
  // FileType bitmask (1=File, 2=Directory, 64=SymbolicLink).
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
 * Manage a single long-running CheerpX process plus its console sink, so
 * stdout streams out via the bus and stdin can be fed in.
 *
 * CheerpX exposes a `runAsync` API that returns once the process exits
 * and accepts a custom console; we use it for the persistent session.
 */
function makeProcessRegistry(cx, emit) {
  const procs = new Map(); // pid -> { sink, dispose, exitPromise }
  let nextPid = 1;

  async function spawn({ argv = ['/bin/bash', '--login'], cwd = '/root', env = {} }) {
    if (!Array.isArray(argv) || argv.length === 0) {
      throw new Error('proc.spawn requires non-empty argv');
    }
    const pid = nextPid++;
    const consoleSink = createConsoleSink();
    const dispose = consoleSink.onWrite((chunk) => {
      emit('proc.stdout', { pid, chunk });
    });
    cx.setCustomConsole?.(consoleSink.sink) ?? cx.setConsole?.(consoleSink.sink);

    const exitPromise = (async () => {
      try {
        const [program, ...args] = argv;
        // CheerpX's runAsync signature varies by version; we cover both.
        const fn = cx.runAsync ?? cx.run;
        const exit = await fn.call(cx, program, args, {
          cwd,
          env,
        });
        const exitCode = typeof exit === 'number' ? exit : (exit?.exitCode ?? 0);
        emit('proc.exit', { pid, exitCode });
        return exitCode;
      } finally {
        dispose();
        procs.delete(pid);
      }
    })();

    procs.set(pid, { consoleSink, dispose, exitPromise });
    return { pid };
  }

  async function write(pid, bytes) {
    const p = procs.get(pid);
    if (!p) throw new Error(`unknown pid: ${pid}`);
    // CheerpX exposes writeToConsole / sendInput; we try both shapes.
    if (typeof cx.writeToConsole === 'function') {
      cx.writeToConsole(bytes);
    } else if (typeof cx.sendInput === 'function') {
      cx.sendInput(bytes);
    } else {
      throw new Error('CheerpX build does not expose stdin write');
    }
  }

  async function resize(pid, cols, rows) {
    const p = procs.get(pid);
    if (!p) throw new Error(`unknown pid: ${pid}`);
    cx.resizeConsole?.(cols, rows);
  }

  async function kill(pid, signal = 'SIGTERM') {
    const p = procs.get(pid);
    if (!p) throw new Error(`unknown pid: ${pid}`);
    cx.kill?.(signal);
  }

  async function wait(pid) {
    const p = procs.get(pid);
    if (!p) throw new Error(`unknown pid: ${pid}`);
    const exitCode = await p.exitPromise;
    return { exitCode };
  }

  return { spawn, write, resize, kill, wait };
}

export function startWebVMServer({ cx, channel, status }) {
  if (!cx) throw new TypeError('startWebVMServer requires a CheerpX handle');
  if (!channel) throw new TypeError('startWebVMServer requires a channel');

  let emit;
  const procs = makeProcessRegistry(cx, (...args) => emit?.(...args));

  const methods = {
    'vm.status': async () => ({
      booted: true,
      ...status,
    }),
    'fs.readFile': async ({ path }) => {
      const data = await cx.readFile(path);
      return data instanceof Uint8Array ? data : new Uint8Array(data);
    },
    'fs.writeFile': async ({ path, data }) => {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      await cx.writeFile(path, bytes);
    },
    'fs.stat': async ({ path }) => toFileStat(await cx.stat(path)),
    'fs.readDir': async ({ path }) => {
      const entries = await cx.readDirectory(path);
      // CheerpX returns names; we re-stat to learn the type.
      const out = [];
      for (const name of entries) {
        try {
          const s = toFileStat(await cx.stat(`${path.replace(/\/$/, '')}/${name}`));
          out.push([name, s.type]);
        } catch {
          out.push([name, FILE_TYPE_FILE]);
        }
      }
      return out;
    },
    'fs.delete': async ({ path, recursive }) => {
      if (recursive) await cx.deleteDirectory?.(path);
      else await cx.deleteFile?.(path);
    },
    'fs.rename': async ({ from, to }) => {
      await cx.rename?.(from, to);
    },
    'fs.createDirectory': async ({ path }) => {
      await cx.createDirectory?.(path);
    },
    'proc.spawn': async (params) => procs.spawn(params),
    'proc.write': async ({ pid, bytes }) =>
      procs.write(pid, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)),
    'proc.resize': async ({ pid, cols, rows }) => procs.resize(pid, cols, rows),
    'proc.kill': async ({ pid, signal }) => procs.kill(pid, signal),
    'proc.wait': async ({ pid }) => procs.wait(pid),
  };

  const server = createBusServer({ channel, methods });
  emit = server.emit;
  emit('vm.boot', { phase: 'ready' });
  return { server, methods };
}
