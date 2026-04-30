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

function makeFakeCx() {
  const state = { writer: null, lastInput: [], runCalls: [] };
  const cx = {
    setCustomConsole(fn /* , cols, rows */) {
      state.writer = fn;
      return (charCode) => state.lastInput.push(charCode);
    },
    setConsoleSize() {},
    async run(cmd, args, opts) {
      state.runCalls.push({ cmd, args, opts });
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
    '-rw-r--r-- 1 root root  387 Apr 28 22:47 README.md\n' +
    'drwxr-xr-x 3 root root 4096 Apr 28 22:47 hello\n' +
    '-rw-r--r-- 1 root root  399 Apr 28 22:47 hello_world.rs\n';
  state.writer(new TextEncoder().encode(raw), 1);

  // Wait a microtask for the emit to flush.
  await Promise.resolve();
  const stdoutEvents = busServer.events.filter((e) => e.topic === 'proc.stdout');
  assert.ok(stdoutEvents.length > 0, 'expected at least one proc.stdout event');
  const combined = stdoutEvents.map((e) => e.payload.chunk).join('');
  assert.match(combined, /total 0\r\n/);
  assert.match(combined, /README\.md\r\n/);
  assert.match(combined, /hello\r\n/);
  assert.match(combined, /hello_world\.rs\r\n/);
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
  assert.equal(dataState.writes.length, 1, 'expected a staged /data script');
  assert.equal(dataState.writes[0].filename, '/rust-web-box-workspace-prime.sh');
  assert.match(dataState.writes[0].contents, /cat > '\/workspace\/hello\.txt'/);
  assert.match(dataState.writes[0].contents, /hello/);
  assert.deepEqual(
    state.runCalls.map((c) => [c.cmd, c.args[0]]).slice(0, 3),
    [
      ['/bin/sh', '/data/rust-web-box-workspace-prime.sh'],
      ['/bin/rm', '-f'],
      ['/bin/bash', '--login'],
    ],
  );
  assert.ok(
    busServer.events.some((e) => e.topic === 'vm.boot' && e.payload?.phase === 'ready'),
    'server should emit ready after quiet priming',
  );
});

test('webvm-server: mirrors saved files through /data without typing into the terminal', async () => {
  const { cx, state } = makeFakeCx();
  const workspace = makeFakeWorkspace();
  const busServer = makeBusServerStub();
  const { dataDevice, state: dataState } = makeFakeDataDevice();

  const server = startWebVMServer({ cx, busServer, workspace, dataDevice, status: {} });
  await server.bootTask;
  await server.methods['fs.writeFile']({
    path: '/workspace/new-file.txt',
    data: new TextEncoder().encode('saved\n'),
  });

  assert.equal(state.lastInput.length, 0, 'file sync must not use console input');
  assert.equal(dataState.writes.length, 2, 'expected prime and save scripts');
  assert.equal(dataState.writes[1].filename, '/rust-web-box-workspace-sync.sh');
  assert.match(dataState.writes[1].contents, /cat > '\/workspace\/new-file\.txt'/);
  assert.match(dataState.writes[1].contents, /saved/);
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
