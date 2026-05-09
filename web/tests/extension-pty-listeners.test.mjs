// Issue #27 regression test: the webvm-host extension's pseudoterminal
// must not leak `proc.stdout` listeners when VS Code re-`open()`s the
// pty. The original bug doubled (or tripled) every typed character and
// every line of command output; the fix detaches stale listeners before
// re-binding.
//
// We can't load the real extension.js from Node (it `require('vscode')`
// at the top of activate(), which doesn't exist outside the workbench),
// so this test reads the source and asserts on the *shape* of the fix:
// every `bus.on('proc.stdout', …)` site that mutates a `*Dispose` slot
// must be preceded (in the same function) by a disposer call.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const EXTENSION_PATH = path.join(WEB_ROOT, 'extensions/webvm-host/extension.js');

async function readExtension() {
  return await fs.readFile(EXTENSION_PATH, 'utf8');
}

test('extension pty: makePseudoterminal disposes prior bus subscribers on re-open', async () => {
  const src = await readExtension();
  const startIdx = src.indexOf('function makePseudoterminal');
  const endIdx = src.indexOf('// --- Cargo tasks', startIdx);
  assert.ok(startIdx >= 0 && endIdx > startIdx, 'makePseudoterminal block not found');
  const fn = src.slice(startIdx, endIdx);
  // The fix introduces detachBusListeners() — a guard called from
  // open() and close() that disposes any prior stdout/exit listeners
  // before re-binding. Without it, panel reattach would double output.
  assert.match(fn, /function detachBusListeners\(\)/);
  const detachIdx = fn.indexOf('detachBusListeners()');
  const assignIdx = fn.search(/stdoutDispose\s*=\s*bus\.on\(['"]proc\.stdout/);
  assert.ok(detachIdx >= 0, 'detachBusListeners() call missing');
  assert.ok(assignIdx >= 0, 'stdoutDispose assignment missing');
  assert.ok(
    detachIdx < assignIdx,
    'detachBusListeners() must run before bus.on(proc.stdout) so re-open() does not leak listeners',
  );
});

test('extension pty: makeCargoPty disposes prior bus subscribers on re-open', async () => {
  const src = await readExtension();
  const startIdx = src.indexOf('function makeCargoPty');
  const endIdx = src.indexOf('function makeCargoTasks', startIdx);
  assert.ok(startIdx >= 0 && endIdx > startIdx, 'makeCargoPty block not found');
  const fn = src.slice(startIdx, endIdx);
  assert.match(fn, /function detachBusListeners\(\)/);
  const detachIdx = fn.indexOf('detachBusListeners()');
  const assignIdx = fn.search(/stdoutDispose\s*=\s*bus\.on\(['"]proc\.stdout/);
  assert.ok(
    detachIdx >= 0 && assignIdx >= 0 && detachIdx < assignIdx,
    'detachBusListeners() must run before bus.on(proc.stdout) in cargo pty',
  );
});

test('extension pty: auto-terminal creation guards against duplicates', async () => {
  // setTimeout(350) used to unconditionally create a "WebVM bash"
  // terminal. If activation fired twice, two terminals appeared. Issue
  // #27 added a "is there already one?" guard.
  const src = await readExtension();
  assert.match(src, /vscode\.window\.terminals\?\.find/);
  assert.match(src, /name === 'WebVM bash'/);
});

