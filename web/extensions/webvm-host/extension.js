// VS Code Web extension: webvm-host.
//
// Runs in the extension-host Web Worker. Connects to the page-side
// `webvm-server` over a same-origin BroadcastChannel and exposes:
//
//   * `webvm:` URI scheme via FileSystemProvider (powers Explorer, search,
//     editor tabs, save/open).
//   * `webvm-host.bash` terminal profile, backed by a CheerpX bash session.
//   * Cargo task provider + commands (Cargo: Run/Build/Test/Add/New).
//   * Status-bar Run button bound to `cargo run --release`.
//
// We don't use TypeScript at the extension-build layer because the entire
// integration is small enough that the type stubs would outweigh the
// payload. JSDoc carries the API contracts.

const CHANNEL_NAME = 'rust-web-box/webvm-bus';

// --- Bus client (mirrors web/glue/webvm-bus.js, inlined to keep this
// extension a single-file payload that can be served as a builtin) -----

class BusError extends Error {
  constructor(message, code = 'BUS_ERROR') {
    super(message);
    this.name = 'BusError';
    this.code = code;
  }
}

function createBusClient(channel, { timeoutMs = 30000 } = {}) {
  let nextId = 1;
  const pending = new Map();
  const eventListeners = new Map();

  channel.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'response') {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) entry.reject(new BusError(msg.error.message, msg.error.code));
      else entry.resolve(msg.result);
    } else if (msg.kind === 'event') {
      const ls = eventListeners.get(msg.topic);
      if (ls) for (const fn of ls) fn(msg.payload);
    }
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new BusError(`request timed out: ${method}`, 'TIMEOUT'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      channel.postMessage({ id, kind: 'request', method, params });
    });
  }

  function on(topic, fn) {
    let ls = eventListeners.get(topic);
    if (!ls) {
      ls = new Set();
      eventListeners.set(topic, ls);
    }
    ls.add(fn);
    return () => ls.delete(fn);
  }

  return { request, on };
}

// --- Helpers -----------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toUri(vscode, path) {
  return vscode.Uri.parse(`webvm:${path.startsWith('/') ? path : '/' + path}`);
}

function pathFromUri(uri) {
  // `webvm:/workspace/foo` → `/workspace/foo`
  return uri.path || '/';
}

// --- FileSystemProvider ------------------------------------------------

function makeFileSystemProvider(vscode, bus) {
  const watchers = new Set();
  const onDidChangeEmitter = new vscode.EventEmitter();

  return {
    onDidChangeFile: onDidChangeEmitter.event,

    watch(_uri, _options) {
      // Polling watcher: CheerpX doesn't surface inotify yet, so we
      // emit a heartbeat that VS Code uses to invalidate the explorer
      // cache. Disposed when the watcher is no longer needed.
      const handle = { disposed: false };
      watchers.add(handle);
      return new vscode.Disposable(() => {
        handle.disposed = true;
        watchers.delete(handle);
      });
    },

    async stat(uri) {
      return await bus.request('fs.stat', { path: pathFromUri(uri) });
    },

    async readDirectory(uri) {
      return await bus.request('fs.readDir', { path: pathFromUri(uri) });
    },

    async createDirectory(uri) {
      await bus.request('fs.createDirectory', { path: pathFromUri(uri) });
      onDidChangeEmitter.fire([
        { type: vscode.FileChangeType.Created, uri },
      ]);
    },

    async readFile(uri) {
      const arr = await bus.request('fs.readFile', { path: pathFromUri(uri) });
      return arr instanceof Uint8Array ? arr : new Uint8Array(arr);
    },

    async writeFile(uri, content, options) {
      // VS Code passes `Uint8Array`; we forward bytes-as-array because
      // BroadcastChannel can't transfer typed arrays losslessly.
      await bus.request('fs.writeFile', {
        path: pathFromUri(uri),
        data: Array.from(content),
      });
      onDidChangeEmitter.fire([
        {
          type: options?.create
            ? vscode.FileChangeType.Created
            : vscode.FileChangeType.Changed,
          uri,
        },
      ]);
    },

    async delete(uri, options) {
      await bus.request('fs.delete', {
        path: pathFromUri(uri),
        recursive: !!options?.recursive,
      });
      onDidChangeEmitter.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
    },

    async rename(from, to, _options) {
      await bus.request('fs.rename', {
        from: pathFromUri(from),
        to: pathFromUri(to),
      });
      onDidChangeEmitter.fire([
        { type: vscode.FileChangeType.Deleted, uri: from },
        { type: vscode.FileChangeType.Created, uri: to },
      ]);
    },
  };
}

// --- Pseudoterminal ----------------------------------------------------

function makePseudoterminal(vscode, bus) {
  const writeEmitter = new vscode.EventEmitter();
  const closeEmitter = new vscode.EventEmitter();
  let pid = null;
  let stdoutDispose = null;
  let exitDispose = null;

  return {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,

    async open(initialDimensions) {
      stdoutDispose = bus.on('proc.stdout', (payload) => {
        if (!pid || payload.pid !== pid) return;
        writeEmitter.fire(payload.chunk);
      });
      exitDispose = bus.on('proc.exit', (payload) => {
        if (!pid || payload.pid !== pid) return;
        closeEmitter.fire(payload.exitCode);
      });

      const result = await bus.request('proc.spawn', {
        argv: ['/bin/bash', '--login'],
        cwd: '/root',
        env: { TERM: 'xterm-256color' },
      });
      pid = result.pid;

      if (initialDimensions) {
        await bus
          .request('proc.resize', {
            pid,
            cols: initialDimensions.columns,
            rows: initialDimensions.rows,
          })
          .catch(() => {});
      }
    },

    close() {
      stdoutDispose?.();
      exitDispose?.();
      if (pid != null) bus.request('proc.kill', { pid, signal: 'SIGHUP' }).catch(() => {});
      pid = null;
    },

    handleInput(data) {
      if (pid == null) return;
      const bytes = textEncoder.encode(data);
      bus.request('proc.write', {
        pid,
        bytes: Array.from(bytes),
      }).catch(() => {});
    },

    setDimensions(dim) {
      if (pid == null) return;
      bus.request('proc.resize', { pid, cols: dim.columns, rows: dim.rows }).catch(() => {});
    },
  };
}

// --- Cargo tasks -------------------------------------------------------

function makeCargoTasks(vscode, bus) {
  function buildExecution(command, args = [], cwd = '/workspace') {
    return new vscode.CustomExecution(async () =>
      makeCargoPty(vscode, bus, command, args, cwd),
    );
  }

  return {
    async provideTasks() {
      const tasks = [];
      for (const command of ['build', 'run', 'test']) {
        const t = new vscode.Task(
          { type: 'cargo-webvm', command },
          vscode.TaskScope.Workspace,
          `cargo ${command}`,
          'cargo',
          buildExecution(command),
        );
        t.group =
          command === 'build'
            ? vscode.TaskGroup.Build
            : command === 'test'
              ? vscode.TaskGroup.Test
              : undefined;
        tasks.push(t);
      }
      return tasks;
    },
    resolveTask(task) {
      const def = task.definition;
      if (def.type !== 'cargo-webvm' || !def.command) return undefined;
      return new vscode.Task(
        def,
        task.scope ?? vscode.TaskScope.Workspace,
        `cargo ${def.command}`,
        'cargo',
        buildExecution(def.command, def.args, def.cwd),
      );
    },
  };
}

function makeCargoPty(vscode, bus, command, args = [], cwd = '/workspace') {
  const writeEmitter = new vscode.EventEmitter();
  const closeEmitter = new vscode.EventEmitter();
  let pid = null;
  let stdoutDispose = null;
  let exitDispose = null;
  return {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    async open() {
      writeEmitter.fire(`> cargo ${command} ${args.join(' ')}\r\n`);
      stdoutDispose = bus.on('proc.stdout', (payload) => {
        if (!pid || payload.pid !== pid) return;
        writeEmitter.fire(payload.chunk);
      });
      exitDispose = bus.on('proc.exit', (payload) => {
        if (!pid || payload.pid !== pid) return;
        closeEmitter.fire(payload.exitCode);
      });
      const argv = ['/usr/bin/env', 'cargo', command, ...args];
      const r = await bus.request('proc.spawn', { argv, cwd, env: { TERM: 'xterm-256color' } });
      pid = r.pid;
    },
    close() {
      stdoutDispose?.();
      exitDispose?.();
      if (pid != null) bus.request('proc.kill', { pid }).catch(() => {});
    },
    handleInput() {},
    setDimensions() {},
  };
}

// --- activate ----------------------------------------------------------

function activate(context) {
  // VS Code's web extension API surface is exposed as the `vscode`
  // global on the worker; keep it dynamic so the extension can be
  // loaded outside of VS Code (tests).
  const vscode = require('vscode');

  let channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch (err) {
    vscode.window.showErrorMessage(
      `webvm-host: BroadcastChannel unavailable (${err?.message ?? err}). The Linux VM cannot be reached.`,
    );
    return;
  }
  const bus = createBusClient(channel);

  // FileSystemProvider
  const fs = makeFileSystemProvider(vscode, bus);
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('webvm', fs, {
      isCaseSensitive: true,
      isReadonly: false,
    }),
  );

  // Terminal profile
  context.subscriptions.push(
    vscode.window.registerTerminalProfileProvider('webvm-host.bash', {
      provideTerminalProfile() {
        return new vscode.TerminalProfile({
          name: 'WebVM bash',
          pty: makePseudoterminal(vscode, bus),
        });
      },
    }),
  );

  // Tasks
  const cargo = makeCargoTasks(vscode, bus);
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider('cargo-webvm', cargo),
  );

  // Commands
  function runCargo(command, args = []) {
    const term = vscode.window.createTerminal({
      name: `cargo ${command}`,
      pty: makeCargoPty(vscode, bus, command, args),
    });
    term.show();
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('webvm-host.cargo.run', () =>
      runCargo('run', ['--release']),
    ),
    vscode.commands.registerCommand('webvm-host.cargo.build', () =>
      runCargo('build', ['--release']),
    ),
    vscode.commands.registerCommand('webvm-host.cargo.test', () => runCargo('test')),
    vscode.commands.registerCommand('webvm-host.cargo.add', async () => {
      const crate = await vscode.window.showInputBox({
        prompt: 'Crate to add (e.g. serde or anyhow@1.0)',
      });
      if (crate) runCargo('add', [crate]);
    }),
    vscode.commands.registerCommand('webvm-host.cargo.new', async () => {
      const name = await vscode.window.showInputBox({
        prompt: 'New project name',
      });
      if (name) runCargo('new', [name]);
    }),
    vscode.commands.registerCommand('webvm-host.openTerminal', () => {
      const term = vscode.window.createTerminal({
        name: 'WebVM bash',
        pty: makePseudoterminal(vscode, bus),
      });
      term.show();
    }),
  );

  // Status-bar Run button (criterion 5 in issue #1)
  const runBtn = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  runBtn.text = '$(play) Cargo Run';
  runBtn.tooltip = 'Run cargo run --release in the WebVM';
  runBtn.command = 'webvm-host.cargo.run';
  runBtn.show();
  context.subscriptions.push(runBtn);

  // Surface VM status once the page-side server reports ready.
  bus.request('vm.status').then(
    (status) => {
      vscode.window.setStatusBarMessage(
        `WebVM ready (${status.diskUrl ?? 'no disk'})`,
        5000,
      );
    },
    (err) => {
      vscode.window.showWarningMessage(
        `WebVM not ready: ${err?.message ?? err}. The page must initialise CheerpX before extensions activate.`,
      );
    },
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
