import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  categorizeBootError,
  renderBootError,
  installBootDiagnostics,
} from '../glue/boot-diagnostics.js';

test('categorizeBootError: classifies a 503 status payload as disk-503', () => {
  const cat = categorizeBootError({
    url: './disk/rust-alpine.ext2.c0000d7.txt',
    status: 503,
  });
  assert.equal(cat.kind, 'disk-503');
  assert.match(cat.body, /503/);
});

test('categorizeBootError: classifies a CompileError as wasm-compile', () => {
  const err = new Error('Compiling function #0 failed: expected 1 elements on the stack for fallthru, found 0 @+145');
  err.name = 'CompileError';
  const cat = categorizeBootError({ error: err });
  assert.equal(cat.kind, 'wasm-compile');
});

test('categorizeBootError: WebAssembly.Module() text is wasm-compile even without name', () => {
  const err = new Error('WebAssembly.Module(): something failed');
  const cat = categorizeBootError({ error: err });
  assert.equal(cat.kind, 'wasm-compile');
});

test('categorizeBootError: TypeError in a blob worker is worker-missing-export', () => {
  const err = new TypeError('e is not a function');
  const cat = categorizeBootError({
    error: err,
    filename: 'blob:https://link-foundation.github.io/abc123',
  });
  assert.equal(cat.kind, 'worker-missing-export');
});

test('categorizeBootError: TypeError without blob context falls through to unknown', () => {
  const err = new TypeError('foo is not a function');
  const cat = categorizeBootError({ error: err });
  assert.equal(cat.kind, 'unknown');
});

test('categorizeBootError: CSP-blocked fetch is network-blocked', () => {
  const cat = categorizeBootError({
    error: new Error('Refused to connect: blocked by Content Security Policy'),
  });
  assert.equal(cat.kind, 'network-blocked');
});

test('categorizeBootError: unknown errors keep the original message', () => {
  const cat = categorizeBootError({ error: new Error('totally novel boom') });
  assert.equal(cat.kind, 'unknown');
  assert.match(cat.body, /totally novel boom/);
});

test('renderBootError: Brave gets the V8 hint on wasm-compile', () => {
  const cat = categorizeBootError({
    error: Object.assign(new Error('WebAssembly.Module(): bad'), { name: 'CompileError' }),
  });
  const r = renderBootError(cat, { id: 'brave', isBrave: true });
  assert.equal(r.kind, 'wasm-compile');
  assert.match(r.hint, /brave:\/\/settings\/content\/v8/);
  assert.match(r.hint, /36187/);
});

test('renderBootError: non-Brave on wasm-compile gets the generic hard-reload hint', () => {
  const cat = categorizeBootError({
    error: Object.assign(new Error('WebAssembly.Module(): bad'), { name: 'CompileError' }),
  });
  const r = renderBootError(cat, { id: 'chromium', isBrave: false });
  assert.doesNotMatch(r.hint, /brave:\/\//);
  assert.match(r.hint, /Shift-Reload|hard reload/i);
});

test('renderBootError: disk-503 hint mentions Pages backend', () => {
  const cat = categorizeBootError({ url: './disk/img.cabcdef.txt', status: 503 });
  const r = renderBootError(cat, { id: 'chromium', isBrave: false });
  assert.match(r.hint, /Pages/i);
});

test('installBootDiagnostics: records wasm-compile + disk-503 errors', () => {
  const listeners = new Map();
  const target = {
    addEventListener(name, cb) {
      const arr = listeners.get(name) || [];
      arr.push(cb);
      listeners.set(name, arr);
    },
    removeEventListener(name, cb) {
      listeners.set(name, (listeners.get(name) || []).filter((x) => x !== cb));
    },
  };

  const { diag, restore } = installBootDiagnostics({ target });
  const fire = (name, event) => {
    for (const cb of listeners.get(name) || []) cb(event);
  };

  const err = new Error('Compiling function #0 failed: expected 1 elements on the stack for fallthru, found 0 @+145');
  err.name = 'CompileError';
  fire('unhandledrejection', { reason: err });
  fire('error', {
    error: new TypeError('e is not a function'),
    filename: 'blob:https://example.test/u',
  });

  assert.equal(diag.events.length, 2);
  assert.equal(diag.events[0].kind, 'wasm-compile');
  assert.equal(diag.events[1].kind, 'worker-missing-export');

  restore();
});

test('installBootDiagnostics: noop when target has no addEventListener', () => {
  const r = installBootDiagnostics({ target: {} });
  r.restore();
  assert.equal(typeof r.restore, 'function');
});
