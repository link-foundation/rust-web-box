// Tests for the opt-in verbose mode (issue #3, R10).
//
// The debug helper must (a) cost zero when disabled, (b) be filterable
// by namespace, and (c) accept both the URL-param and localStorage
// activation paths so a maintainer can flip it on without redeploying.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseDebugSpec, createDebug, dumpRuntime } from '../glue/debug.js';

function fakeStorage(entries = {}) {
  const store = new Map(Object.entries(entries));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
}

test('parseDebugSpec: returns null when no signal is present', () => {
  assert.equal(parseDebugSpec({}), null);
  assert.equal(parseDebugSpec({ search: '?other=1', storage: fakeStorage() }), null);
  assert.equal(parseDebugSpec({ search: '?debug=' }), null);
  assert.equal(parseDebugSpec({ search: '?debug=0' }), null);
  assert.equal(parseDebugSpec({ search: '?debug=false' }), null);
});

test('parseDebugSpec: ?debug=1 enables all namespaces', () => {
  assert.deepEqual(parseDebugSpec({ search: '?debug=1' }), { all: true });
  assert.deepEqual(parseDebugSpec({ search: 'debug=1' }), { all: true }); // missing leading ?
  assert.deepEqual(parseDebugSpec({ search: '?debug=on' }), { all: true });
  assert.deepEqual(parseDebugSpec({ search: '?debug=*' }), { all: true });
});

test('parseDebugSpec: ?debug=cheerpx,bus parses to a namespace set', () => {
  const spec = parseDebugSpec({ search: '?debug=cheerpx,bus' });
  assert.ok(spec.namespaces.has('cheerpx'));
  assert.ok(spec.namespaces.has('bus'));
  assert.equal(spec.namespaces.size, 2);
});

test('parseDebugSpec: localStorage rustWebBoxDebug is honoured when URL is silent', () => {
  const storage = fakeStorage({ rustWebBoxDebug: '1' });
  assert.deepEqual(parseDebugSpec({ search: '', storage }), { all: true });
});

test('parseDebugSpec: URL parameter wins over localStorage', () => {
  const storage = fakeStorage({ rustWebBoxDebug: '1' });
  // URL says "boot only"; localStorage would have said "all". URL wins.
  const spec = parseDebugSpec({ search: '?debug=boot', storage });
  assert.ok(spec.namespaces.has('boot'));
  assert.equal(spec.namespaces.size, 1);
});

test('createDebug: returns a no-op (zero cost) when debug is off', () => {
  const sink = (...args) => assert.fail(`unexpected log: ${args.join(' ')}`);
  const dbg = createDebug('boot', { search: '', sink });
  assert.equal(dbg.enabled, false);
  dbg('this should not print');
  dbg('extra', { args: 1 });
});

test('createDebug: logs through sink when ?debug=1', () => {
  const calls = [];
  const sink = (...args) => calls.push(args);
  const dbg = createDebug('boot', { search: '?debug=1', sink });
  assert.equal(dbg.enabled, true);
  dbg('hello', { phase: 'loading' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '[rust-web-box][boot]');
  assert.equal(calls[0][1], 'hello');
  assert.deepEqual(calls[0][2], { phase: 'loading' });
});

test('createDebug: filters by namespace when spec is a list', () => {
  const calls = [];
  const sink = (...args) => calls.push(args[0]);
  const onDbg = createDebug('boot', { search: '?debug=boot,bus', sink });
  const offDbg = createDebug('cheerpx', { search: '?debug=boot,bus', sink });
  assert.equal(onDbg.enabled, true);
  assert.equal(offDbg.enabled, false);
  onDbg('included');
  offDbg('excluded');
  assert.deepEqual(calls, ['[rust-web-box][boot]']);
});

test('createDebug: tolerates a localStorage shim that throws (private mode)', () => {
  const storage = {
    getItem: () => { throw new Error('SecurityError'); },
  };
  // Should not propagate the error.
  const dbg = createDebug('boot', { search: '', storage, sink: () => {} });
  assert.equal(dbg.enabled, false);
});

test('dumpRuntime: returns a JSON-serialisable snapshot', () => {
  const fakeGlobal = {
    location: { href: 'https://link-foundation.github.io/rust-web-box/?debug=1' },
    navigator: { userAgent: 'TestAgent/1.0', serviceWorker: { controller: {} } },
    crossOriginIsolated: true,
    SharedArrayBuffer: function () {},
    __rustWebBox: {
      vmPhase: 'starting Linux',
      vm: { diskUrl: 'wss://disks.webvm.io/x.ext2', persistKey: 'k' },
      workspace: { /* live ref, must be reduced to bool */ },
      busServer: { /* live ref, must be reduced to bool */ },
      shim: {},
    },
  };
  const dump = dumpRuntime(fakeGlobal);
  // Must round-trip through JSON without throwing — that's the whole
  // point of the snapshot.
  const json = JSON.stringify(dump);
  const round = JSON.parse(json);
  assert.equal(round.href, 'https://link-foundation.github.io/rust-web-box/?debug=1');
  assert.equal(round.userAgent, 'TestAgent/1.0');
  assert.equal(round.crossOriginIsolated, true);
  assert.equal(round.sharedArrayBuffer, true);
  assert.equal(round.serviceWorker, true);
  assert.equal(round.vmPhase, 'starting Linux');
  assert.equal(round.vmDiskUrl, 'wss://disks.webvm.io/x.ext2');
  assert.equal(round.workspaceReady, true);
  assert.equal(round.busAlive, true);
  assert.ok(typeof round.timestamp === 'string');
});

test('dumpRuntime: handles a missing __rustWebBox gracefully', () => {
  const dump = dumpRuntime({ location: { href: 'about:blank' }, navigator: {} });
  // Defaults — nothing should throw or be undefined-shaped.
  assert.equal(dump.workspaceReady, false);
  assert.equal(dump.busAlive, false);
  assert.equal(dump.vmPhase, undefined);
});
