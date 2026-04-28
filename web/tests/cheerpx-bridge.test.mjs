import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadCheerpX, bootLinux, createConsoleSink } from '../glue/cheerpx-bridge.js';

test('createConsoleSink: forwards delta writes to listeners', () => {
  const sink = createConsoleSink();
  const log = [];
  sink.onWrite((d) => log.push(d));
  sink.sink.textContent = 'hello';
  sink.sink.textContent = 'helloworld';
  sink.sink.textContent = 'helloworld!';
  assert.deepEqual(log, ['hello', 'world', '!']);
});

test('createConsoleSink: dispose stops further notifications', () => {
  const sink = createConsoleSink();
  const log = [];
  const dispose = sink.onWrite((d) => log.push(d));
  sink.sink.textContent = 'a';
  dispose();
  sink.sink.textContent = 'ab';
  assert.deepEqual(log, ['a']);
});

test('createConsoleSink: clear resets the buffer', () => {
  const sink = createConsoleSink();
  const log = [];
  sink.onWrite((d) => log.push(d));
  sink.sink.textContent = 'foo';
  sink.clear();
  sink.sink.textContent = 'bar';
  assert.deepEqual(log, ['foo', 'bar']);
});

test('loadCheerpX: prefers vendored module, falls back to CDN', async () => {
  const calls = [];
  const vendoredErr = new Error('vendored missing');
  const fakeModule = { __test: true };
  const importer = async (url) => {
    calls.push(url);
    if (url.startsWith('./')) throw vendoredErr;
    return fakeModule;
  };
  const mod = await loadCheerpX({
    vendoredUrl: './cheerpx/cx.esm.js',
    cdnUrl: 'https://example.test/cx.esm.js',
    importer,
  });
  assert.equal(mod, fakeModule);
  assert.deepEqual(calls, [
    './cheerpx/cx.esm.js',
    'https://example.test/cx.esm.js',
  ]);
});

test('loadCheerpX: throws aggregated error when both fail', async () => {
  const importer = async (url) => {
    throw new Error(`cannot load ${url}`);
  };
  await assert.rejects(
    () =>
      loadCheerpX({
        vendoredUrl: './cheerpx/cx.esm.js',
        cdnUrl: 'https://example.test/cx.esm.js',
        importer,
      }),
    (err) => /Failed to load CheerpX/.test(err.message),
  );
});

test('bootLinux: rejects without CheerpX module', async () => {
  await assert.rejects(
    () => bootLinux({}),
    /requires the CheerpX module/,
  );
});

test('bootLinux: chains overlay and surfaces progress', async () => {
  const phases = [];
  const cloud = { tag: 'cloud' };
  const idb = { tag: 'idb' };
  const overlay = { tag: 'overlay' };
  const cx = { tag: 'cx' };
  const fakeCheerpX = {
    CloudDevice: { create: async () => cloud },
    IDBDevice: { create: async () => idb },
    OverlayDevice: {
      create: async (a, b) => {
        assert.equal(a, cloud);
        assert.equal(b, idb);
        return overlay;
      },
    },
    Linux: {
      create: async (opts) => {
        assert.ok(opts.mounts.find((m) => m.path === '/'));
        return cx;
      },
    },
  };
  const result = await bootLinux({
    CheerpX: fakeCheerpX,
    diskUrl: 'wss://example.test/disk.ext2',
    persistKey: 'k',
    onProgress: (p) => phases.push(p),
  });
  assert.equal(result.cx, cx);
  assert.equal(result.cloud, cloud);
  assert.equal(result.overlay, idb);
  assert.equal(result.root, overlay);
  assert.equal(result.diskUrl, 'wss://example.test/disk.ext2');
  assert.deepEqual(phases, [
    'attaching cloud disk',
    'attaching IndexedDB overlay',
    'starting Linux',
  ]);
});
