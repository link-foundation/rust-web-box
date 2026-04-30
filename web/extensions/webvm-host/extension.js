// VS Code Web extension: webvm-host.
//
// Runs in the extension-host Web Worker. Connects to the page-side
// `webvm-server` over a same-origin BroadcastChannel and exposes:
//
//   * `webvm:` URI scheme via FileSystemProvider (powers Explorer,
//     search, editor tabs, save/open).
//   * `webvm-host.bash` terminal profile, backed by the persistent
//     CheerpX bash session. Shows a "Booting Linux VM…" status message
//     in the terminal pane until vm.status reports the VM is booted.
//   * Cargo task provider + commands (Cargo: Run/Build/Test/Add/New).
//   * Status-bar Run button bound to `cargo run --release`.
//   * Auto-opens a terminal AND auto-opens `hello_world.rs` on
//     activation so the user lands in a working editor + bash
//     immediately, exactly the way the issue's "edit src/main.rs, run
//     Cargo: Run, see output" acceptance criterion demands.
//
// Single-file payload — VS Code Web extensions are served as static
// files so a tiny vanilla-JS module avoids the bundler hop.

const CHANNEL_NAME = 'rust-web-box/webvm-bus';
const VM_BOOT_MAX_MS = 180_000;

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

const textEncoder = new TextEncoder();

function toUri(vscode, path) {
  return vscode.Uri.parse(`webvm:${path.startsWith('/') ? path : '/' + path}`);
}

function pathFromUri(uri) {
  return uri.path || '/';
}

// --- FileSystemProvider ------------------------------------------------

function makeFileSystemProvider(vscode, bus) {
  const onDidChangeEmitter = new vscode.EventEmitter();
  return {
    onDidChangeFile: onDidChangeEmitter.event,
    watch() {
      // Polling watcher; the page-side workspace store fires onChange
      // events but we don't propagate them across the bus yet.
      return new vscode.Disposable(() => {});
    },
    async stat(uri) {
      const r = await bus.request('fs.stat', { path: pathFromUri(uri) });
      return r;
    },
    async readDirectory(uri) {
      return await bus.request('fs.readDir', { path: pathFromUri(uri) });
    },
    async createDirectory(uri) {
      await bus.request('fs.createDirectory', { path: pathFromUri(uri) });
      onDidChangeEmitter.fire([{ type: vscode.FileChangeType.Created, uri }]);
    },
    async readFile(uri) {
      const arr = await bus.request('fs.readFile', { path: pathFromUri(uri) });
      return arr instanceof Uint8Array ? arr : new Uint8Array(arr);
    },
    async writeFile(uri, content, options) {
      await bus.request('fs.writeFile', {
        path: pathFromUri(uri),
        data: Array.from(content),
        options,
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
    async rename(from, to) {
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

function makePseudoterminal(vscode, bus, { vmReadyPromise }) {
  const writeEmitter = new vscode.EventEmitter();
  const closeEmitter = new vscode.EventEmitter();
  let sub = null;
  let stdoutDispose = null;
  let exitDispose = null;
  let dimsPending = null;
  let opened = false;

  function ansi(s) { return `\x1b[${s}`; }
  const RESET = ansi('0m');
  const DIM = ansi('2m');
  const BOLD = ansi('1m');
  const GREEN = ansi('32m');

  function status(msg) {
    writeEmitter.fire(`${DIM}[rust-web-box]${RESET} ${msg}\r\n`);
  }

  return {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,

    async open(initialDimensions) {
      opened = true;
      writeEmitter.fire(
        `${BOLD}rust-web-box${RESET} — anonymous in-browser Rust sandbox\r\n`,
      );
      writeEmitter.fire(
        `${DIM}Powered by CheerpX (leaningtech/webvm) and VS Code Web.${RESET}\r\n\r\n`,
      );
      status('Booting Linux VM…');

      let booted = false;
      let lastPhase = '';
      const phaseDispose = bus.on('vm.boot', (p) => {
        if (booted) return;
        const phase = p?.phase;
        if (!phase || phase === lastPhase) return;
        lastPhase = phase;
        if (phase === 'workspace-ready' || phase === 'ready') return;
        status(`VM stage: ${phase}…`);
      });
      const tick = setInterval(() => {
        if (booted) return;
        writeEmitter.fire(`${DIM}.${RESET}`);
      }, 1500);

      try {
        const result = await Promise.race([
          vmReadyPromise,
          new Promise((_, rej) =>
            setTimeout(
              () => rej(new Error('VM boot timed out')),
              VM_BOOT_MAX_MS,
            ),
          ),
        ]);
        booted = true;
        clearInterval(tick);
        phaseDispose?.();
        writeEmitter.fire('\r\n');
        status(`Linux VM ready ${GREEN}✓${RESET}`);
        if (result?.diskUrl) {
          status(`disk: ${DIM}${result.diskUrl}${RESET}`);
        }
        if (result?.workspacePrimeError) {
          status(`Workspace mirror failed: ${result.workspacePrimeError}`);
        } else {
          status('Workspace mirrored to /workspace — try `cargo run` in /workspace/hello.');
        }
        writeEmitter.fire('\r\n');
      } catch (err) {
        clearInterval(tick);
        phaseDispose?.();
        writeEmitter.fire(
          `\r\n[rust-web-box] failed to reach the VM: ${err?.message ?? err}\r\n`,
        );
        closeEmitter.fire(1);
        return;
      }

      // Subscribe to the persistent bash stream.
      stdoutDispose = bus.on('proc.stdout', (payload) => {
        if (payload?.chunk) writeEmitter.fire(payload.chunk);
      });
      exitDispose = bus.on('proc.exit', () => {
        writeEmitter.fire(`\r\n${DIM}[bash exited — respawning…]${RESET}\r\n`);
      });

      try {
        const r = await bus.request('proc.spawn', {});
        sub = r.sub ?? null;
      } catch (err) {
        writeEmitter.fire(
          `\r\n[rust-web-box] could not spawn shell: ${err?.message ?? err}\r\n`,
        );
        closeEmitter.fire(1);
        return;
      }

      if (initialDimensions) {
        await bus
          .request('proc.resize', {
            cols: initialDimensions.columns,
            rows: initialDimensions.rows,
          })
          .catch(() => {});
      } else if (dimsPending) {
        await bus.request('proc.resize', dimsPending).catch(() => {});
      }

      // Trigger the page-side workspace prime so the guest gets the
      // user's current files. This is idempotent.
      bus.request('workspace.prime', {}).catch(() => {});
    },

    close() {
      stdoutDispose?.();
      exitDispose?.();
      if (sub != null) bus.request('proc.kill', { sub }).catch(() => {});
      sub = null;
      opened = false;
    },

    handleInput(data) {
      if (!opened || sub == null) return;
      bus
        .request('proc.write', {
          bytes: Array.from(textEncoder.encode(data)),
        })
        .catch(() => {});
    },

    setDimensions(dim) {
      const params = { cols: dim.columns, rows: dim.rows };
      if (!opened || sub == null) {
        dimsPending = params;
        return;
      }
      bus.request('proc.resize', params).catch(() => {});
    },
  };
}

// --- Cargo tasks -------------------------------------------------------

function makeCargoPty(vscode, bus, { vmReadyPromise }, command, args = [], cwd = '/workspace/hello') {
  const writeEmitter = new vscode.EventEmitter();
  const closeEmitter = new vscode.EventEmitter();
  let sub = null;
  let stdoutDispose = null;
  let exitDispose = null;
  return {
    onDidWrite: writeEmitter.event,
    onDidClose: closeEmitter.event,
    async open() {
      writeEmitter.fire(`> cargo ${command} ${args.join(' ')} (cwd ${cwd})\r\n`);
      try {
        await vmReadyPromise;
      } catch (err) {
        writeEmitter.fire(`[rust-web-box] VM not ready: ${err?.message ?? err}\r\n`);
        closeEmitter.fire(1);
        return;
      }
      stdoutDispose = bus.on('proc.stdout', (p) => {
        if (p?.chunk) writeEmitter.fire(p.chunk);
      });
      exitDispose = bus.on('proc.exit', (p) => {
        if (p?.exitCode != null) closeEmitter.fire(p.exitCode);
      });
      try {
        const r = await bus.request('proc.spawn', {});
        sub = r.sub ?? null;
      } catch (err) {
        writeEmitter.fire(`[rust-web-box] spawn failed: ${err?.message ?? err}\r\n`);
        closeEmitter.fire(1);
        return;
      }
      // Drive the persistent shell to run the command.
      const line = `cd ${cwd} && cargo ${command} ${args.join(' ')}\n`;
      bus
        .request('proc.write', {
          bytes: Array.from(textEncoder.encode(line)),
        })
        .catch(() => {});
    },
    close() {
      stdoutDispose?.();
      exitDispose?.();
      if (sub != null) bus.request('proc.kill', { sub }).catch(() => {});
    },
    handleInput(data) {
      if (sub == null) return;
      bus
        .request('proc.write', {
          bytes: Array.from(textEncoder.encode(data)),
        })
        .catch(() => {});
    },
    setDimensions(dim) {
      bus.request('proc.resize', { cols: dim.columns, rows: dim.rows }).catch(() => {});
    },
  };
}

function makeCargoTasks(vscode, bus, ctx) {
  function buildExecution(command, args = [], cwd = '/workspace/hello') {
    return new vscode.CustomExecution(async () =>
      makeCargoPty(vscode, bus, ctx, command, args, cwd),
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

// --- activate ----------------------------------------------------------

function activate(context) {
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

  // Track when the VM has reported itself ready so terminals (and tasks)
  // can reliably gate their work behind boot completion.
  const vmReadyPromise = (async () => {
    let resolved = false;
    return new Promise((resolve) => {
      const off = bus.on('vm.boot', (p) => {
        if (resolved) return;
        if (p?.phase !== 'ready') return;
        resolved = true;
        off?.();
        bus.request('vm.status').then(resolve).catch(() => resolve({ booted: true }));
      });
      const start = Date.now();
      const tick = setInterval(async () => {
        if (resolved) return clearInterval(tick);
        try {
          const s = await bus.request('vm.status');
          if (s?.booted) {
            resolved = true;
            clearInterval(tick);
            resolve(s);
          }
        } catch {}
        if (!resolved && Date.now() - start > VM_BOOT_MAX_MS) {
          clearInterval(tick);
        }
      }, 1500);
    });
  })();

  // FileSystemProvider — registers immediately so the Explorer can
  // populate from the JS-side workspace store on first paint, no
  // CheerpX dependency.
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
          pty: makePseudoterminal(vscode, bus, { vmReadyPromise }),
        });
      },
    }),
  );

  // Tasks
  const cargo = makeCargoTasks(vscode, bus, { vmReadyPromise });
  context.subscriptions.push(
    vscode.tasks.registerTaskProvider('cargo-webvm', cargo),
  );

  // Commands
  function runCargo(command, args = []) {
    const term = vscode.window.createTerminal({
      name: `cargo ${command}`,
      pty: makeCargoPty(vscode, bus, { vmReadyPromise }, command, args),
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
        pty: makePseudoterminal(vscode, bus, { vmReadyPromise }),
      });
      term.show();
    }),
    vscode.commands.registerCommand('webvm-host.openHelloWorld', () =>
      openHelloWorld(vscode),
    ),
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

  // Auto-open hello_world.rs so the user lands directly in the editor.
  // Issue feedback: "hello_world.rs should be preopened or open as soon
  // as file system is ready and integrated with vscode."
  setTimeout(() => {
    openHelloWorld(vscode).catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('[webvm-host] auto-open hello_world failed:', err);
    });
  }, 200);

  // Auto-open a terminal so the user lands in a working bash without
  // any extra clicks. Issue criterion 3: "Built-in Terminal opens a
  // working `bash` inside WebVM."
  setTimeout(() => {
    try {
      const term = vscode.window.createTerminal({
        name: 'WebVM bash',
        pty: makePseudoterminal(vscode, bus, { vmReadyPromise }),
      });
      term.show();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[webvm-host] auto-terminal failed:', err);
    }
  }, 350);

  vmReadyPromise.then(
    (status) => {
      vscode.window.setStatusBarMessage(
        `WebVM ready (${status?.diskUrl ?? 'no disk'})`,
        5000,
      );
    },
    (err) => {
      vscode.window.showWarningMessage(
        `WebVM not ready: ${err?.message ?? err}.`,
      );
    },
  );
}

async function openHelloWorld(vscode) {
  // Try the well-known seeded paths in order; first one that stats
  // wins. We tolerate ENOENT because the user could have deleted the
  // file in a previous session — IDB persists their edits.
  const candidates = [
    'webvm:/workspace/hello_world.rs',
    'webvm:/workspace/hello/src/main.rs',
    'webvm:/workspace/README.md',
  ];
  for (const u of candidates) {
    const uri = vscode.Uri.parse(u);
    try {
      await vscode.workspace.fs.stat(uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: false });
      return;
    } catch {
      // try next candidate
    }
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
