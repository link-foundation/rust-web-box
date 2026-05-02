import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');

async function loadConsoleFilter({ search = '', storage = null } = {}) {
  const script = await fs.readFile(path.join(WEB_ROOT, 'glue/console-filter.js'), 'utf8');
  const calls = [];
  const listeners = new Map();
  const context = {
    URLSearchParams,
    location: { search },
    localStorage: storage ?? { getItem: () => null },
    console: {
      debug: (...args) => calls.push(['debug', args]),
      info: (...args) => calls.push(['info', args]),
      log: (...args) => calls.push(['log', args]),
      warn: (...args) => calls.push(['warn', args]),
      error: (...args) => calls.push(['error', args]),
    },
    addEventListener(type, fn) {
      const list = listeners.get(type) ?? [];
      list.push(fn);
      listeners.set(type, list);
    },
  };
  context.globalThis = context;
  context.window = context;
  vm.runInNewContext(script, context);
  return { context, calls, listeners };
}

test('console-filter: suppresses known VS Code startup chatter only', async () => {
  const { context, calls } = await loadConsoleFilter();
  context.console.info('Ignoring fetching additional builtin extensions from gallery as it is disabled.');
  context.console.warn('No search provider registered for scheme: webvm, waiting');
  context.console.warn('a real application warning');
  context.console.error('a real application error');

  assert.deepEqual(calls, [
    ['warn', ['a real application warning']],
    ['error', ['a real application error']],
  ]);
  assert.equal(context.__rustWebBox.consoleFilter.filtered, 2);
});

test('console-filter: debug mode bypasses filtering', async () => {
  const { context, calls } = await loadConsoleFilter({ search: '?debug=1' });
  context.console.info('Ignoring fetching additional builtin extensions from gallery as it is disabled.');

  assert.deepEqual(calls, [
    ['info', ['Ignoring fetching additional builtin extensions from gallery as it is disabled.']],
  ]);
  assert.equal(context.__rustWebBox, undefined);
});

test('console-filter: suppresses exact known CheerpX internal a1 errors', async () => {
  const { context, listeners } = await loadConsoleFilter();
  const cheerpxEvent = {
    message: "Cannot read properties of undefined (reading 'a1')",
    filename: 'http://localhost/rust-web-box/cheerpx/cx_esm.js',
    error: { stack: 'at y8 (http://localhost/rust-web-box/cheerpx/cx_esm.js:1:190555)' },
    defaultPrevented: false,
    stopped: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopImmediatePropagation() {
      this.stopped = true;
    },
  };
  listeners.get('error')[0](cheerpxEvent);

  assert.equal(cheerpxEvent.defaultPrevented, true);
  assert.equal(cheerpxEvent.stopped, true);
  assert.equal(context.__rustWebBox.consoleFilter.filtered, 1);
});

test('console-filter: leaves unrelated runtime errors visible', async () => {
  const { context, listeners } = await loadConsoleFilter();
  const appEvent = {
    message: "Cannot read properties of undefined (reading 'a1')",
    filename: 'http://localhost/rust-web-box/glue/boot.js',
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
  listeners.get('error')[0](appEvent);

  assert.equal(appEvent.defaultPrevented, false);
  assert.equal(context.__rustWebBox.consoleFilter.filtered, 0);
});
