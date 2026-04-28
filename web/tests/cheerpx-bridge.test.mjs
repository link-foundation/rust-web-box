import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadCheerpX,
  bootLinux,
  attachConsole,
  resolveDiskUrl,
} from '../glue/cheerpx-bridge.js';

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
  await assert.rejects(() => bootLinux({}), /requires the CheerpX module/);
});

test('bootLinux: falls back to fallbackDiskUrl when primary CloudDevice mount fails', async () => {
  const tried = [];
  const fakeCheerpX = {
    CloudDevice: {
      create: async (url) => {
        tried.push(url);
        if (url === 'https://example.com/missing.ext2') {
          throw new Error('fetch failed');
        }
        return { tag: 'cloud', url };
      },
    },
    IDBDevice: { create: async () => ({}) },
    OverlayDevice: { create: async (a) => a },
    WebDevice: { create: async () => ({}) },
    DataDevice: { create: async () => ({}) },
    Linux: { create: async () => ({ tag: 'cx' }) },
  };
  const result = await bootLinux({
    CheerpX: fakeCheerpX,
    diskUrl: 'https://example.com/missing.ext2',
    fallbackDiskUrl: 'wss://disks.webvm.io/fallback.ext2',
  });
  assert.deepEqual(tried, [
    'https://example.com/missing.ext2',
    'wss://disks.webvm.io/fallback.ext2',
  ]);
  assert.equal(result.diskUrl, 'wss://disks.webvm.io/fallback.ext2');
});

test('bootLinux: builds the WebVM-style mount stack and surfaces progress', async () => {
  const phases = [];
  const cloud = { tag: 'cloud' };
  const idb = { tag: 'idb' };
  const overlay = { tag: 'overlay' };
  const webDev = { tag: 'web' };
  const dataDev = { tag: 'data' };
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
    WebDevice: { create: async () => webDev },
    DataDevice: { create: async () => dataDev },
    Linux: {
      create: async (opts) => {
        // The mount stack has to mirror the leaningtech/webvm reference
        // so the supported callbacks (cpuActivity, processCreated, ...)
        // keep working.
        const paths = opts.mounts.map((m) => m.path);
        assert.deepEqual(paths.sort(), [
          '/', '/data', '/dev', '/dev/pts', '/proc', '/sys', '/web',
        ]);
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
  assert.equal(result.root, overlay);
  assert.equal(result.diskUrl, 'wss://example.test/disk.ext2');
  assert.deepEqual(phases, [
    'attaching cloud disk',
    'attaching IndexedDB overlay',
    'attaching helper devices',
    'starting Linux',
  ]);
});

test('resolveDiskUrl: uses warm.url when set and probe succeeds', async () => {
  const url = await resolveDiskUrl({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { warm: { url: 'wss://warm.example/x.ext2' } };
      },
    }),
    probe: async () => true,
  });
  assert.equal(url, 'wss://warm.example/x.ext2');
});

test('resolveDiskUrl: falls back to default.url when warm.url is null', async () => {
  const url = await resolveDiskUrl({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          warm: { url: null },
          default: { url: 'wss://disks.webvm.io/something.ext2' },
        };
      },
    }),
    probe: async () => true,
  });
  assert.equal(url, 'wss://disks.webvm.io/something.ext2');
});

test('resolveDiskUrl: falls back to default.url when warm probe fails (404)', async () => {
  const probed = [];
  const url = await resolveDiskUrl({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          warm: { url: 'https://example.com/rust-alpine.ext2' },
          default: { url: 'wss://disks.webvm.io/fallback.ext2' },
        };
      },
    }),
    probe: async (u) => {
      probed.push(u);
      return false;
    },
  });
  assert.equal(url, 'wss://disks.webvm.io/fallback.ext2');
  assert.deepEqual(probed, ['https://example.com/rust-alpine.ext2']);
});

test('resolveDiskUrl: falls back to hard-coded URL on fetch error', async () => {
  const url = await resolveDiskUrl({
    fetchImpl: async () => {
      throw new Error('network down');
    },
  });
  assert.match(url, /^wss:\/\/disks\.webvm\.io\//);
});

test('attachConsole: rejects without a Linux handle', () => {
  assert.throws(() => attachConsole(null), /requires a CheerpX Linux handle/);
});

test('attachConsole: write() drives cxReadFunc per character', () => {
  const reads = [];
  const fakeCx = {
    setCustomConsole(_writer, cols, rows) {
      assert.equal(cols, 80);
      assert.equal(rows, 24);
      return (charCode) => reads.push(charCode);
    },
  };
  const c = attachConsole(fakeCx);
  c.write('hi');
  c.write(new Uint8Array([10, 13]));
  assert.deepEqual(reads, [
    'h'.charCodeAt(0),
    'i'.charCodeAt(0),
    10,
    13,
  ]);
});

test('attachConsole: onData receives writer output as Uint8Array', () => {
  let writer;
  const fakeCx = {
    setCustomConsole(w) {
      writer = w;
      return () => {};
    },
  };
  const c = attachConsole(fakeCx);
  const seen = [];
  c.onData((u8) => seen.push(Array.from(u8)));
  writer(new Uint8Array([1, 2, 3]).buffer, 1);
  writer(new Uint8Array([9]), 1);
  // virtual terminal != 1 should be ignored.
  writer(new Uint8Array([99]), 7);
  assert.deepEqual(seen, [[1, 2, 3], [9]]);
});

test('attachConsole: dispose drops listeners', () => {
  let writer;
  const fakeCx = {
    setCustomConsole(w) {
      writer = w;
      return () => {};
    },
  };
  const c = attachConsole(fakeCx);
  const seen = [];
  c.onData((u8) => seen.push(Array.from(u8)));
  c.dispose();
  writer(new Uint8Array([1]), 1);
  assert.deepEqual(seen, []);
});

test('attachConsole: throws when CheerpX has no setCustomConsole', () => {
  assert.throws(
    () => attachConsole({}),
    /missing setCustomConsole/,
  );
});
