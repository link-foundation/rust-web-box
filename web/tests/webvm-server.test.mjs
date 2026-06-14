// Integration test for the page-side WebVM server.
//
// We exercise `startWebVMServer` end-to-end with a fake CheerpX handle
// that captures the writer registered by `cx.setCustomConsole` and
// replays bytes back through it. The test asserts that bare-LF bytes
// (the bug producing the staircase output in PR #2 boot screenshots)
// are normalised to CRLF before being broadcast on the bus, while
// existing CRLF and bare CR are passed through unchanged.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { startWebVMServer } from '../glue/webvm-server.js';
import {
  WORKSPACE_SYNC_OSC_END,
  WORKSPACE_SYNC_OSC_PREFIX,
} from '../glue/workspace-sync.js';
import {
  CARGO_BENCH_OSC_END,
  CARGO_BENCH_OSC_PREFIX,
} from '../glue/cargo-bench.js';

function makeChannelPair() {
  const a = new EventTarget();
  const b = new EventTarget();
  a.postMessage = (data) => {
    queueMicrotask(() => b.dispatchEvent(new MessageEvent('message', { data })));
  };
  b.postMessage = (data) => {
    queueMicrotask(() => a.dispatchEvent(new MessageEvent('message', { data })));
  };
  return [a, b];
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(input) {
  return Buffer.from(input).toString('base64');
}

function syncFrame(lines) {
  return `${WORKSPACE_SYNC_OSC_PREFIX}${b64(['RWB_SYNC_V1', ...lines, ''].join('\n'))}${WORKSPACE_SYNC_OSC_END}`;
}

function benchFrame(lines) {
  return `${CARGO_BENCH_OSC_PREFIX}${b64(['RWB_BENCH_V1', ...lines, ''].join('\n'))}${CARGO_BENCH_OSC_END}`;
}

function makeFakeCx({ onRun } = {}) {
  const state = { writer: null, lastInput: [], runCalls: [] };
  const cx = {
    setCustomConsole(fn /* , cols, rows */) {
      state.writer = fn;
      return (charCode) => state.lastInput.push(charCode);
    },
    setConsoleSize() {},
    async run(cmd, args, opts) {
      state.runCalls.push({ cmd, args, opts });
      await onRun?.({ cmd, args, opts, state });
      if (cmd === '/bin/bash') {
        // Hold open forever so the shell loop doesn't respawn during the test.
        await new Promise(() => {});
      }
    },
  };
  return { cx, state };
}

function makeFakeWorkspace(snapshot = {}) {
  return {
    snapshot: async () => snapshot,
    readFile: async () => new Uint8Array(),
    writeFile: async () => {},
    stat: async () => ({ type: 1, size: 0, mtime: 0 }),
    readDirectory: async () => [],
    delete: async () => {},
    rename: async () => {},
    createDirectory: async () => {},
  };
}

function makeStatefulWorkspace(files = {}) {
  const fileMap = new Map(Object.entries(files));
  return {
    async snapshot() {
      return Object.fromEntries(fileMap.entries());
    },
    async readFile(path) {
      const bytes = fileMap.get(path);
      if (!bytes) {
        const err = new Error(`ENOENT: ${path}`);
        err.code = 'FileNotFound';
        throw err;
      }
      return bytes;
    },
    async writeFile(path, bytes) {
      fileMap.set(path, bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    },
    async stat(path) {
      if (fileMap.has(path)) return { type: 1, size: fileMap.get(path).byteLength, mtime: 0 };
      if (path === '/workspace') return { type: 2, size: 0, mtime: 0 };
      const err = new Error(`ENOENT: ${path}`);
      err.code = 'FileNotFound';
      throw err;
    },
    async readDirectory() {
      return [];
    },
    async delete(path) {
      fileMap.delete(path);
    },
    async rename(from, to) {
      const bytes = fileMap.get(from);
      if (!bytes) throw new Error(`ENOENT: ${from}`);
      fileMap.set(to, bytes);
      fileMap.delete(from);
    },
    async createDirectory() {},
  };
}

function makeTreeWorkspace() {
  const entries = new Map();
  entries.set('/workspace', { type: 2 });

  async function stat(path) {
    const entry = entries.get(path);
    if (!entry) {
      const err = new Error(`ENOENT: ${path}`);
      err.code = 'FileNotFound';
      throw err;
    }
    return {
      type: entry.type,
      size: entry.data?.byteLength ?? entry.size ?? 0,
      mtime: 0,
    };
  }

  async function readDirectory(path) {
    await stat(path);
    const prefix = path === '/' ? '/' : `${path}/`;
    const seen = new Map();
    for (const [entryPath, entry] of entries) {
      if (entryPath === path || !entryPath.startsWith(prefix)) continue;
      const rest = entryPath.slice(prefix.length);
      const slash = rest.indexOf('/');
      if (slash < 0) {
        seen.set(rest, entry.type);
      } else if (!seen.has(rest.slice(0, slash))) {
        seen.set(rest.slice(0, slash), 2);
      }
    }
    return [...seen.entries()];
  }

  async function createDirectory(path) {
    entries.set(path, { type: 2 });
  }

  return {
    entries,
    snapshot: async () => ({}),
    async readFile(path) {
      const entry = entries.get(path);
      if (!entry || entry.type !== 1 || entry.metadataOnly) {
        const err = new Error(`ENOENT: ${path}`);
        err.code = 'FileNotFound';
        throw err;
      }
      return entry.data;
    },
    async writeFile(path, bytes) {
      entries.set(path, {
        type: 1,
        data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      });
    },
    async writeMetadataFile(path, { size = 0 } = {}) {
      entries.set(path, { type: 1, metadataOnly: true, size });
    },
    stat,
    readDirectory,
    async delete(path) {
      for (const entryPath of [...entries.keys()].sort((a, b) => b.length - a.length)) {
        if (entryPath === path || entryPath.startsWith(`${path}/`)) {
          entries.delete(entryPath);
        }
      }
    },
    async rename(from, to) {
      const entry = entries.get(from);
      if (!entry) throw new Error(`ENOENT: ${from}`);
      entries.set(to, { ...entry });
      entries.delete(from);
    },
    createDirectory,
  };
}

function makeFakeDataDevice() {
  const state = { writes: [] };
  return {
    dataDevice: {
      async writeFile(filename, contents) {
        state.writes.push({ filename, contents });
      },
    },
    state,
  };
}

function makeBusServerStub() {
  const events = [];
  let methods = {};
  return {
    emit(topic, payload) { events.push({ topic, payload }); },
    setMethods(next) { methods = next; },
    getMethods: () => methods,
    events,
  };
}

test('webvm-server: bare-LF stdout is normalised to CRLF on the wire', async () => {
  const { cx, state } = makeFakeCx();
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice } = makeFakeDataDevice();

  startWebVMServer({ cx, busServer, workspace, dataDevice, status: {} });

  // Wait for the shell loop to spawn so the writer is registered.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(typeof state.writer, 'function');

  // Replay the exact `ls -la /workspace` output the screenshot showed.
  const raw =
    'total 0\n' +
    '-rw-r--r-- 1 root root  114 Apr 30 06:17 Cargo.toml\n' +
    '-rw-r--r-- 1 root root  387 Apr 28 22:47 README.md\n' +
    'drwxr-xr-x 2 root root 4096 Apr 30 06:17 src\n';
  state.writer(new TextEncoder().encode(raw), 1);

  // Wait a microtask for the emit to flush.
  await Promise.resolve();
  const stdoutEvents = busServer.events.filter((e) => e.topic === 'proc.stdout');
  assert.ok(stdoutEvents.length > 0, 'expected at least one proc.stdout event');
  const combined = stdoutEvents.map((e) => e.payload.chunk).join('');
  assert.match(combined, /total 0\r\n/);
  assert.match(combined, /Cargo\.toml\r\n/);
  assert.match(combined, /README\.md\r\n/);
  assert.match(combined, /src\r\n/);
  // Crucially: no lone LF anywhere.
  assert.equal(/[^\r]\n/.test(combined), false);
});

test('webvm-server: existing CRLF passed through, bare CR untouched', async () => {
  const { cx, state } = makeFakeCx();
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice } = makeFakeDataDevice();

  startWebVMServer({ cx, busServer, workspace, dataDevice, status: {} });
  await new Promise((r) => setTimeout(r, 5));

  // Bash emits things like progress meters that use bare CR; cargo's
  // build status updates do this. Must not be doubled.
  state.writer(new TextEncoder().encode('Compiling foo v0.1.0\r\n'), 1);
  state.writer(new TextEncoder().encode('   Compiling 12 / 50\r'), 1);

  await Promise.resolve();
  const combined = busServer.events
    .filter((e) => e.topic === 'proc.stdout')
    .map((e) => e.payload.chunk)
    .join('');
  // Single CRLF, not CRCRLF.
  assert.match(combined, /Compiling foo v0\.1\.0\r\n/);
  assert.equal(/\r\r\n/.test(combined), false);
  // Bare CR for in-place updates is preserved.
  assert.ok(combined.endsWith('\r'));
});

test('webvm-server: vt channel filtered (only stdout broadcast)', async () => {
  const { cx, state } = makeFakeCx();
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice } = makeFakeDataDevice();

  startWebVMServer({ cx, busServer, workspace, dataDevice, status: {} });
  await new Promise((r) => setTimeout(r, 5));

  // attachConsole's internal writer drops vt != 1. We send to vt=2 and
  // expect no proc.stdout event.
  const before = busServer.events.filter((e) => e.topic === 'proc.stdout').length;
  state.writer(new TextEncoder().encode('SHOULD NOT APPEAR\n'), 2);
  await Promise.resolve();
  const after = busServer.events.filter((e) => e.topic === 'proc.stdout').length;
  assert.equal(after, before);
});

test('webvm-server: primes /workspace through a /data script, not terminal input', async () => {
  const { cx, state } = makeFakeCx();
  const workspace = makeFakeWorkspace({
    '/workspace/hello.txt': new TextEncoder().encode('hello\n'),
  });
  const busServer = makeBusServerStub();
  const { dataDevice, state: dataState } = makeFakeDataDevice();

  const server = startWebVMServer({ cx, busServer, workspace, dataDevice, status: {} });
  await server.bootTask;

  assert.equal(state.lastInput.length, 0, 'workspace prime must not type into bash');
  assert.equal(dataState.writes.length, 2, 'expected shell setup and workspace prime scripts');
  assert.equal(dataState.writes[0].filename, '/rust-web-box-shell-profile.sh');
  assert.match(dataState.writes[0].contents, /\/root\/\.bash_profile/);
  assert.equal(dataState.writes[1].filename, '/rust-web-box-workspace-prime.sh');
  assert.match(dataState.writes[1].contents, /cat > '\/workspace\/hello\.txt'/);
  assert.match(dataState.writes[1].contents, /hello/);
  assert.deepEqual(
    state.runCalls.map((c) => [c.cmd, c.args[0]]).slice(0, 4),
    [
      ['/bin/sh', '/data/rust-web-box-shell-profile.sh'],
      ['/bin/rm', '-f'],
      ['/bin/sh', '/data/rust-web-box-workspace-prime.sh'],
      ['/bin/rm', '-f'],
    ],
  );
  assert.deepEqual(
    state.runCalls.map((c) => [c.cmd, c.args[0]]).slice(4, 5),
    [['/bin/bash', '--login']],
  );
  assert.ok(
    busServer.events.some((e) => e.topic === 'vm.boot' && e.payload?.phase === 'ready'),
    'server should emit ready after quiet priming',
  );
});

test('webvm-server: bash profile applies the lean cargo dev profile only on matching disks', async () => {
  const { cx, state } = makeFakeCx();
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice, state: dataState } = makeFakeDataDevice();

  const server = startWebVMServer({ cx, busServer, workspace, dataDevice, status: {} });
  await server.bootTask;

  const profileScript = dataState.writes.find((w) => w.filename === '/rust-web-box-shell-profile.sh')?.contents ?? '';
  assert.match(profileScript, /export CARGO_INCREMENTAL=0/);
  assert.match(profileScript, /grep -Eq '.*debug.*=.*0.*' \/root\/\.cargo\/config\.toml/);
  assert.match(profileScript, /grep -Eq '.*codegen-units.*=.*1.*' \/root\/\.cargo\/config\.toml/);
  assert.match(profileScript, /export CARGO_PROFILE_DEV_DEBUG=0/);
  assert.match(profileScript, /export CARGO_PROFILE_DEV_CODEGEN_UNITS=1/);
  assert.match(profileScript, /export CARGO_PROFILE_DEV_INCREMENTAL=false/);

  const bashCall = state.runCalls.find((c) => c.cmd === '/bin/bash');
  assert.ok(bashCall, 'expected bash shell loop to start');
  assert.ok(bashCall.opts.env.includes('CARGO_INCREMENTAL=0'));
  assert.equal(bashCall.opts.env.includes('CARGO_PROFILE_DEV_DEBUG=0'), false);
  assert.equal(bashCall.opts.env.includes('CARGO_PROFILE_DEV_CODEGEN_UNITS=1'), false);

  const scriptCall = state.runCalls.find((c) => c.cmd === '/bin/sh');
  assert.ok(scriptCall, 'expected a guest setup script');
  assert.equal(scriptCall.opts.env.includes('CARGO_PROFILE_DEV_DEBUG=0'), false);
  assert.equal(scriptCall.opts.env.includes('CARGO_PROFILE_DEV_CODEGEN_UNITS=1'), false);
});

test('webvm-server: onPhase callback receives every emitted phase, including ready', async () => {
  // Regression for issue #15: the e2e harness keys `vmPhase === 'ready'`
  // on `globalThis.__rustWebBox.vmPhase`, but the page-side shim only
  // observed phases coming from CheerpX's `onProgress` (which stops at
  // `starting Linux`). The `'ready'` phase originates here, so we now
  // thread an `onPhase` callback through `startWebVMServer`. Without it
  // the harness times out at 180s waiting for a phase that exists on the
  // bus but never reaches the shim.
  const { cx } = makeFakeCx();
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice } = makeFakeDataDevice();

  const phases = [];
  const server = startWebVMServer({
    cx, busServer, workspace, dataDevice, status: {},
    onPhase: (p) => phases.push(p),
  });
  await server.bootTask;

  assert.deepEqual(
    phases.filter((p) => p === 'syncing-workspace' || p === 'ready'),
    ['syncing-workspace', 'ready'],
    `onPhase did not receive both syncing-workspace and ready (got: ${JSON.stringify(phases)})`,
  );
  // And the bus still gets the same phases — onPhase is additive, not a
  // replacement.
  const busPhases = busServer.events
    .filter((e) => e.topic === 'vm.boot')
    .map((e) => e.payload?.phase);
  assert.ok(busPhases.includes('ready'), `bus did not receive 'ready' (got: ${JSON.stringify(busPhases)})`);
});

test('webvm-server: mirrors saved files through /data without typing into the terminal', async () => {
  const { cx, state } = makeFakeCx();
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice, state: dataState } = makeFakeDataDevice();

  const server = startWebVMServer({ cx, busServer, workspace, dataDevice, status: {} });
  await server.bootTask;
  await server.methods['fs.writeFile']({
    path: '/workspace/src/main.rs',
    data: new TextEncoder().encode('fn main() { println!("saved"); }\n'),
  });

  assert.equal(state.lastInput.length, 0, 'file sync must not use console input');
  assert.equal(dataState.writes.length, 3, 'expected shell setup, prime, and save scripts');
  assert.equal(dataState.writes[2].filename, '/rust-web-box-workspace-sync.sh');
  assert.match(dataState.writes[2].contents, /cat > '\/workspace\/src\/main\.rs'/);
  assert.match(dataState.writes[2].contents, /saved/);
  assert.match(dataState.writes[2].contents, /find \/workspace\/target -exec touch -t 197001010000/);
  assert.match(dataState.writes[2].contents, /for __rwb_fp_dir in \/workspace\/target\/debug\/\.fingerprint/);
  assert.match(dataState.writes[2].contents, /bin-\*/);
  assert.match(dataState.writes[2].contents, /0000000000000000/);
  assert.match(dataState.writes[2].contents, /\*\.json\|\*\/dep-\*\|\*\/invoked\.timestamp/);
  assert.match(dataState.writes[2].contents, /touch -m '\/workspace\/src\/main\.rs'/);
  assert.doesNotMatch(dataState.writes[2].contents, /rm -rf .*\.fingerprint/);
  assert.doesNotMatch(dataState.writes[2].contents, /> "\$__rwb_marker".*dep-\*/);
});

test('webvm-server: failed guest save rejects and leaves JS workspace unchanged', async () => {
  // Regression for issue #21: VS Code saves used to update the JS-side
  // workspace first, then swallow guest mirror errors. The editor tab
  // looked saved while the next `cargo run` still saw the old VM file.
  const state = { writer: null, runCalls: [] };
  const cx = {
    setCustomConsole(fn) {
      state.writer = fn;
      return () => {};
    },
    setConsoleSize() {},
    async run(cmd, args, opts) {
      state.runCalls.push({ cmd, args, opts });
      if (typeof args[0] === 'string' && args[0].includes('workspace-sync')) {
        throw new Error('guest write failed');
      }
    },
  };
  const workspace = makeStatefulWorkspace({
    '/workspace/src/main.rs': enc.encode('old\n'),
  });
  const busServer = makeBusServerStub();
  const { dataDevice } = makeFakeDataDevice();

  const server = startWebVMServer({
    cx, busServer, workspace, dataDevice, status: {},
    opts: { skipPrime: true, skipShellLoop: true },
  });
  await server.bootTask;

  await assert.rejects(
    () => server.methods['fs.writeFile']({
      path: '/workspace/src/main.rs',
      data: enc.encode('new\n'),
      options: { create: false, overwrite: true },
    }),
    /guest write failed/,
  );
  assert.equal(
    dec.decode(await workspace.readFile('/workspace/src/main.rs')),
    'old\n',
  );
});

test('webvm-server: target readDirectory refreshes guest metadata on demand', async () => {
  const stolenOutput = [];
  const { cx } = makeFakeCx({
    onRun: async ({ cmd, args, state }) => {
      if (cmd === '/bin/sh' && String(args?.[0] ?? '').includes('workspace-target-refresh')) {
        setTimeout(() => {
          state.writer(enc.encode(syncFrame([
            `P\t${b64('/workspace/target')}`,
            `D\t${b64('/workspace/target')}`,
            `D\t${b64('/workspace/target/debug')}`,
            `S\t${b64('/workspace/target/debug/hello')}\t7352`,
            `D\t${b64('/workspace/target/release')}`,
            `S\t${b64('/workspace/target/release/hello')}\t8192`,
          ])), 1);
        }, 0);
      }
    },
  });
  const workspace = makeTreeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice, state: dataState } = makeFakeDataDevice();

  const server = startWebVMServer({
    cx, busServer, workspace, dataDevice, status: {},
    opts: { skipPrime: true, skipShellLoop: true },
  });
  await server.bootTask;

  // The e2e harness uses cx.setCustomConsole() directly to capture
  // low-level VM command output. The page server must reattach its own
  // console before relying on hidden workspace-sync frames.
  cx.setCustomConsole((bytes) => stolenOutput.push(dec.decode(bytes)), 80, 24);
  const entries = await server.methods['fs.readDir']({ path: '/workspace/target' });

  assert.deepEqual([...entries].sort(), [
    ['debug', 2],
    ['release', 2],
  ]);
  assert.deepEqual(workspace.entries.get('/workspace/target/debug/hello'), {
    type: 1,
    metadataOnly: true,
    size: 7352,
  });
  assert.deepEqual(workspace.entries.get('/workspace/target/release/hello'), {
    type: 1,
    metadataOnly: true,
    size: 8192,
  });
  assert.equal(
    dataState.writes.at(-1).filename,
    '/rust-web-box-workspace-target-refresh.sh',
  );
  assert.match(dataState.writes.at(-1).contents, /printf 'P\\t%s\\n'/);
  assert.equal(stolenOutput.join(''), '');
});

test('webvm-server: vm.benchCargo runs the real build script and returns parsed per-phase timing', async () => {
  // Issue #41: the page asks the guest to run the REAL `cargo run` build and
  // ship per-phase wall-clock back over an OSC frame. Here the fake cx detects
  // the staged cargo-bench script and replays a frame the way the guest would,
  // so we can assert the page-side parse/return path end-to-end.
  let benchScript = null;
  const { cx } = makeFakeCx({
    onRun: async ({ cmd, args, state }) => {
      if (cmd === '/bin/sh' && String(args?.[0] ?? '').includes('cargo-bench')) {
        setTimeout(() => {
          state.writer(enc.encode(benchFrame([
            `E\tarch\t${b64('i686')}`,
            `E\tnproc\t${b64('1')}`,
            `E\trustc\t${b64('rustc 1.78.0 (9b00956e5 2024-04-29)')}`,
            `E\tcargo\t${b64('cargo 1.78.0')}`,
            `P\tnoop-run\t23.960\t0\t0\t${b64('cargo run (no change)')}\t${b64('cargo run')}\t${b64('Finished dev')}`,
            `P\tedit-run\t364.120\t0\t1\t${b64('cargo run (one-line edit)')}\t${b64('cargo run')}\t${b64('Compiling hello')}`,
            `T\tlink_binary\t0.049`,
            `T\ttotal\t0.072`,
          ])), 1);
        }, 0);
      }
    },
  });
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice, state: dataState } = makeFakeDataDevice();

  const server = startWebVMServer({
    cx, busServer, workspace, dataDevice, status: {},
    opts: { skipPrime: true, skipShellLoop: true },
  });
  await server.bootTask;

  const result = await server.methods['vm.benchCargo']({ timeoutMs: 5000 });

  // The staged script is the real cargo benchmark, not a workaround.
  benchScript = dataState.writes.at(-1);
  assert.equal(benchScript.filename, '/rust-web-box-cargo-bench.sh');
  assert.match(benchScript.contents, /__rwb_phase edit-run "cargo run \(one-line edit\)" cargo run/);

  // The frame decodes into structured, environment-proven timing.
  assert.equal(result.env.arch, 'i686');
  assert.equal(result.env.rustc, 'rustc 1.78.0 (9b00956e5 2024-04-29)');
  const editRun = result.phases.find((p) => p.id === 'edit-run');
  assert.ok(editRun, 'expected an edit-run phase');
  assert.equal(editRun.seconds, 364.12);
  assert.equal(editRun.compiled, true);
  assert.equal(result.passes.link_binary, 0.049);
  // Page-side wall-clock is attached as an independent cross-check.
  assert.equal(typeof result.wallMs, 'number');
});

test('webvm-server: vm.benchCargo frame never leaks into the visible terminal stream', async () => {
  // The bench OSC frame shares the `\x1b]777;rust-web-box-` prefix with the
  // workspace-sync frame; the composed parser must strip it so none of the
  // base64 payload reaches xterm.js as visible text.
  const { cx } = makeFakeCx({
    onRun: async ({ cmd, args, state }) => {
      if (cmd === '/bin/sh' && String(args?.[0] ?? '').includes('cargo-bench')) {
        setTimeout(() => {
          state.writer(enc.encode(
            `Compiling hello v0.1.0\n${benchFrame([
              `E\tarch\t${b64('i686')}`,
              `P\tedit-run\t5.000\t0\t1\t${b64('cargo run')}\t${b64('cargo run')}\t${b64('done')}`,
            ])}    Finished dev\n`,
          ), 1);
        }, 0);
      }
    },
  });
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice } = makeFakeDataDevice();

  const server = startWebVMServer({
    cx, busServer, workspace, dataDevice, status: {},
    opts: { skipPrime: true, skipShellLoop: true },
  });
  await server.bootTask;

  const before = busServer.events.filter((e) => e.topic === 'proc.stdout').length;
  const result = await server.methods['vm.benchCargo']({ timeoutMs: 5000 });
  await Promise.resolve();

  assert.equal(result.phases[0].seconds, 5);
  const broadcast = busServer.events
    .filter((e) => e.topic === 'proc.stdout')
    .slice(before)
    .map((e) => e.payload.chunk)
    .join('');
  // The human-visible compiler lines survive; the OSC frame does not.
  assert.match(broadcast, /Compiling hello v0\.1\.0/);
  assert.match(broadcast, /Finished dev/);
  assert.equal(broadcast.includes('rust-web-box-bench'), false);
  assert.equal(broadcast.includes('RWB_BENCH_V1'), false);
});

test('webvm-server: __RWB_DEBUG_VM_TIMING records per-cx.run timing, and nothing when off', async () => {
  // Issue #41 asks for tracing of the exact in-VM bottleneck. The opt-in
  // recorder times every cx.run (guest scripts + the bench), gated on a
  // global flag so it costs nothing when off (mirrors __RWB_DEBUG_TERMINAL_STREAM).
  const makeServer = () => {
    const { cx } = makeFakeCx({
      onRun: async ({ cmd, args, state }) => {
        if (cmd === '/bin/sh' && String(args?.[0] ?? '').includes('cargo-bench')) {
          setTimeout(() => {
            state.writer(enc.encode(benchFrame([
              `E\tarch\t${b64('i686')}`,
              `P\tedit-run\t1.000\t0\t1\t${b64('cargo run')}\t${b64('cargo run')}\t${b64('ok')}`,
            ])), 1);
          }, 0);
        }
      },
    });
    const busServer = makeBusServerStub();
    const { dataDevice } = makeFakeDataDevice();
    return startWebVMServer({
      cx, busServer, workspace: makeFakeWorkspace(), dataDevice, status: {},
      // Quiet logger so the opt-in trace doesn't spam the test output.
      opts: {
        skipPrime: true,
        skipShellLoop: true,
        logger: { log() {}, info() {}, warn() {}, error() {} },
      },
    });
  };

  // OFF (default): no entries recorded.
  const off = makeServer();
  await off.bootTask;
  await off.methods['vm.benchCargo']({ timeoutMs: 5000 });
  assert.equal(off.vmTimings.snapshot().length, 0, 'no timing should be recorded when the flag is off');

  // ON: the guest-script run and the bench run are both timed.
  globalThis.__RWB_DEBUG_VM_TIMING = true;
  try {
    const on = makeServer();
    await on.bootTask;
    await on.methods['vm.benchCargo']({ timeoutMs: 5000 });
    const entries = on.vmTimings.snapshot();
    assert.ok(entries.length >= 2, `expected at least guest-script + bench entries (got ${entries.length})`);
    assert.ok(entries.some((e) => e.kind === 'guest-script' && e.label === 'cargo-bench'));
    assert.ok(entries.some((e) => e.kind === 'bench' && typeof e.elapsedMs === 'number'));
    for (const e of entries) assert.equal(typeof e.at, 'number');
  } finally {
    delete globalThis.__RWB_DEBUG_VM_TIMING;
  }
});

test('webvm-server: non-recursive empty directory delete uses guest rmdir', async () => {
  const { cx } = makeFakeCx();
  let deleted = false;
  const workspace = {
    snapshot: async () => ({}),
    readFile: async () => new Uint8Array(),
    writeFile: async () => {},
    async stat(path) {
      if (path === '/workspace/empty') return { type: 2, size: 0, mtime: 0 };
      if (path === '/workspace') return { type: 2, size: 0, mtime: 0 };
      const err = new Error(`ENOENT: ${path}`);
      err.code = 'FileNotFound';
      throw err;
    },
    readDirectory: async () => [],
    delete: async () => { deleted = true; },
    rename: async () => {},
    createDirectory: async () => {},
  };
  const busServer = makeBusServerStub();
  const { dataDevice, state: dataState } = makeFakeDataDevice();

  const server = startWebVMServer({
    cx, busServer, workspace, dataDevice, status: {},
    opts: { skipPrime: true, skipShellLoop: true },
  });
  await server.bootTask;
  await server.methods['fs.delete']({
    path: '/workspace/empty',
    recursive: false,
  });

  const script = dataState.writes.at(-1).contents;
  assert.match(script, /rmdir '\/workspace\/empty'/);
  assert.equal(/rm -f/.test(script), false);
  assert.equal(deleted, true);
});

test('webvm-server: workspace.prime bus method is a no-op when skipPrime is set', async () => {
  // Regression for issue #15: VS Code's webvm-host extension calls
  // `bus.request('workspace.prime')` whenever a terminal opens. Before
  // this guard, that bus call ran the prime regardless of opts.skipPrime,
  // bypassing the bootTask check and tripping the CheerpX 1.3.x
  // OverlayDevice 'a1' wedge. The trace bisect (see
  // experiments/cx-130-bisect-trace-bus-skip.mjs) showed the runtime
  // wedge fired ~1s after the bus invocation, well before any user
  // action.
  const state = { writer: null, runCalls: [] };
  const cx = {
    setCustomConsole(fn) {
      state.writer = fn;
      return () => {};
    },
    setConsoleSize() {},
    async run(cmd, args, opts) {
      state.runCalls.push({ cmd, args, opts });
      if (cmd === '/bin/bash') await new Promise(() => {});
    },
  };
  const workspace = makeFakeWorkspace({
    '/workspace/Cargo.toml': new TextEncoder().encode('[package]\nname = "x"\n'),
  });
  const busServer = makeBusServerStub();
  const { dataDevice, state: dataState } = makeFakeDataDevice();

  const server = startWebVMServer({
    cx, busServer, workspace, dataDevice, status: {},
    opts: { skipPrime: true, skipShellLoop: true },
  });
  await server.bootTask;

  // bootTask itself didn't call run at all (skipPrime + skipShellLoop).
  const beforeBusCall = state.runCalls.length;
  const beforeWrites = dataState.writes.length;

  // Now simulate VS Code calling workspace.prime via the bus.
  await server.methods['workspace.prime']({});

  assert.equal(
    state.runCalls.length,
    beforeBusCall,
    'workspace.prime bus method must not run any guest scripts when skipPrime=true',
  );
  assert.equal(
    dataState.writes.length,
    beforeWrites,
    'workspace.prime bus method must not stage any /data scripts when skipPrime=true',
  );
});

test('webvm-server: workspace.prime bus method runs the prime when skipPrime is not set', async () => {
  // Inverse guard: when skipPrime is false (default), the bus method
  // does prime — VS Code's terminal-open hook is the canonical entry
  // point on a clean disk that needs the JS workspace mirrored in.
  const { cx, state } = makeFakeCx();
  const workspace = makeFakeWorkspace({
    '/workspace/Cargo.toml': new TextEncoder().encode('[package]\nname = "x"\n'),
  });
  const busServer = makeBusServerStub();
  const { dataDevice, state: dataState } = makeFakeDataDevice();

  const server = startWebVMServer({ cx, busServer, workspace, dataDevice, status: {} });
  await server.bootTask;

  const beforeWrites = dataState.writes.length;
  // Bus method should be idempotent: bootTask already primed once, so a
  // second call returns the cached promise without re-staging.
  await server.methods['workspace.prime']({});
  assert.equal(
    dataState.writes.length,
    beforeWrites,
    'workspace.prime bus method should be idempotent after bootTask primed',
  );
});

test('webvm-server: bootTask reaches "ready" even when workspace prime hangs', async () => {
  // Regression for issue #15: CheerpX 1.3.x has a flaky bug where
  // `cx.run` hangs forever after a runtime crash (the JS-level promise
  // never settles). Without a timeout in `primeGuestWorkspace`, the
  // entire boot stalls at `vmPhase: 'syncing-workspace'` and the e2e
  // harness times out at 180s. We bound the prime so vmPhase reaches
  // 'ready' regardless, and the failure is recorded for diagnostics.
  const state = { writer: null, runCalls: [] };
  const cx = {
    setCustomConsole(fn) {
      state.writer = fn;
      return () => {};
    },
    setConsoleSize() {},
    async run(cmd, args, opts) {
      state.runCalls.push({ cmd, args, opts });
      // Hang forever on the prime script (simulates the 'a1' bug).
      if (typeof args[0] === 'string' && args[0].includes('workspace-prime')) {
        await new Promise(() => {});
      }
      // Hang on bash too (matches the real shell loop).
      if (cmd === '/bin/bash') {
        await new Promise(() => {});
      }
    },
  };
  const workspace = makeFakeWorkspace({
    '/workspace/.vscode/settings.json': new TextEncoder().encode('{}\n'),
  });
  const busServer = makeBusServerStub();
  const { dataDevice } = makeFakeDataDevice();

  const server = startWebVMServer({
    cx, busServer, workspace, dataDevice, status: {},
    // Tight timeout so the test finishes quickly. Disable the
    // first-output watchdog (shellFirstOutputTimeoutMs: 0) — this test
    // exercises the prime-hang path, not silent-spawn detection, and we
    // don't want a stray 15s watchdog timer firing during the run.
    opts: { primeTimeoutMs: 50, shellPrepareTimeoutMs: 50, shellFirstOutputTimeoutMs: 0 },
  });
  await server.bootTask;

  const phases = busServer.events
    .filter((e) => e.topic === 'vm.boot')
    .map((e) => e.payload?.phase);
  assert.ok(
    phases.includes('ready'),
    `bootTask must emit 'ready' even when prime hangs (got: ${JSON.stringify(phases)})`,
  );
});

test('webvm-server: silent shell spawn surfaces a visible terminal advisory (issue #37)', async () => {
  // The iPad-Safari signature from issue #37: bash spawns and never
  // dies, but also never prints a prompt — the terminal shows a lone
  // cursor forever. The fast-cycle detector can't see this (no exit, no
  // error), so the first-output watchdog must flag it AND write a visible
  // advisory into the terminal so the user isn't staring at a blank pane.
  const { cx } = makeFakeCx(); // bash run hangs forever, emits nothing
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice } = makeFakeDataDevice();
  const unhealthy = [];

  const server = startWebVMServer({
    cx, busServer, workspace, dataDevice, status: {},
    opts: {
      skipPrime: true,
      shellFirstOutputTimeoutMs: 30,
      onShellUnhealthy: (info) => unhealthy.push(info),
      logger: { warn() {}, error() {}, log() {} },
    },
  });
  await server.bootTask;
  // Wait past the first-output watchdog window.
  await new Promise((r) => setTimeout(r, 90));

  assert.ok(
    unhealthy.some((u) => u.kind === 'no-output'),
    `expected a 'no-output' notification (got ${JSON.stringify(unhealthy.map((u) => u.kind))})`,
  );
  assert.equal(server.runtime.shellLoop.silentSpawns, 1);
  assert.equal(server.runtime.shellLoop.slowFirstOutput, true);

  const advisory = busServer.events
    .filter((e) => e.topic === 'proc.stdout')
    .map((e) => e.payload.chunk)
    .join('');
  assert.match(advisory, /produced no prompt/);
  assert.match(advisory, /__rustWebBox\.dump\(\)/);

  const shellEvents = busServer.events.filter((e) => e.topic === 'vm.shell');
  assert.ok(
    shellEvents.some((e) => e.payload?.kind === 'no-output' && e.payload?.healthy === false),
    'expected a vm.shell {healthy:false, kind:"no-output"} event',
  );

  server.stop();
});

test('webvm-server: a shell that prints a prompt is not flagged as silent (issue #37)', async () => {
  // Guard against the watchdog crying wolf: a working shell that emits a
  // prompt before the window must never produce the silent-spawn advisory.
  const { cx, state } = makeFakeCx();
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice } = makeFakeDataDevice();
  const unhealthy = [];

  const server = startWebVMServer({
    cx, busServer, workspace, dataDevice, status: {},
    opts: {
      skipPrime: true,
      shellFirstOutputTimeoutMs: 60,
      onShellUnhealthy: (info) => unhealthy.push(info),
      logger: { warn() {}, error() {}, log() {} },
    },
  });
  await server.bootTask;
  // Shell prints its prompt almost immediately, before the watchdog window.
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(typeof state.writer, 'function');
  state.writer(new TextEncoder().encode('root@rust-web-box:/root# '), 1);
  // Wait past the watchdog window.
  await new Promise((r) => setTimeout(r, 90));

  assert.equal(unhealthy.length, 0, 'a healthy shell must not be flagged');
  assert.equal(server.runtime.shellLoop.silentSpawns, 0);
  assert.equal(server.runtime.shellLoop.slowFirstOutput, false);
  assert.ok(server.runtime.shellLoop.outputBytes > 0, 'expected output bytes to be counted');

  const advisory = busServer.events
    .filter((e) => e.topic === 'proc.stdout')
    .map((e) => e.payload.chunk)
    .join('');
  assert.doesNotMatch(advisory, /produced no prompt/);

  server.stop();
});

// Make sure makeChannelPair stays referenced; it's exported in case
// other test files need the same in-memory transport.
test('webvm-server: makeChannelPair sanity', async () => {
  const [a, b] = makeChannelPair();
  let received;
  b.addEventListener('message', (ev) => { received = ev.data; });
  a.postMessage('ping');
  await new Promise((r) => queueMicrotask(r));
  assert.equal(received, 'ping');
});
