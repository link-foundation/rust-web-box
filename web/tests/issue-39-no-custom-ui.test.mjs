// Issue #39 ("Web box does not work on iPad Pro") asks for two things:
//
//   1. The terminal failure on iPad/Safari must be handled — never a
//      silent blank pane. The page-side shell loop already emits a
//      `vm.shell {healthy:false}` event and a visible terminal advisory
//      (issue #37); the extension must turn that into a GENUINE terminal
//      failure (non-zero exit) so VS Code marks the terminal as failed.
//
//   2. "We should not invent our own UI elements, and use VS Code
//      notifications for errors and warnings." The old bottom-right red
//      HTML toast is removed; every error/warning/info is funnelled
//      through the notification center over `vm.notify` and surfaced via
//      VS Code's native notification API in the extension.
//
// We can't load the real extension.js from Node (it `require('vscode')`
// inside activate), so the extension assertions are source-shape checks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');

async function read(rel) {
  return await fs.readFile(path.join(WEB_ROOT, rel), 'utf8');
}

// --- 1. No invented HTML / CSS error widget ---------------------------

test('issue-39: index.html ships no custom boot-toast widget', async () => {
  for (const rel of ['index.html', 'build/index.template.html']) {
    const html = await read(rel);
    assert.doesNotMatch(html, /id="boot-toast"/, `${rel} still has the toast div`);
    assert.doesNotMatch(html, /data-toast-text/, `${rel} still references toast text`);
  }
});

test('issue-39: boot.css ships no custom toast styles', async () => {
  const css = await read('glue/boot.css');
  assert.doesNotMatch(css, /#boot-toast/);
  // The viewport pin from issue #37 must SURVIVE — only the toast is gone.
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /inset:\s*0/);
});

// --- 2. boot.js routes through the notification center ----------------

test('issue-39: boot.js uses the notification center, not a toast', async () => {
  const boot = await read('glue/boot.js');
  assert.match(boot, /createNotificationCenter/);
  // The old DOM-toast plumbing must be gone.
  assert.doesNotMatch(boot, /setToast/);
  assert.doesNotMatch(boot, /hideToast/);
  assert.doesNotMatch(boot, /data-toast-text/);
  // Errors and the unhealthy-shell warning both route through notify().
  assert.match(boot, /notify\(\s*'error'/);
  assert.match(boot, /notify\(\s*'warning'/);
});

test('issue-39: notification center module exposes the bus contract', async () => {
  const src = await read('glue/notifications.js');
  assert.match(src, /export const NOTIFY_TOPIC = 'vm\.notify'/);
  assert.match(src, /export const NOTIFY_SYNC_TOPIC = 'vm\.notify\.sync'/);
  assert.match(src, /export function createNotificationCenter/);
});

// --- 3. Extension renders via native VS Code notifications ------------

test('issue-39: extension surfaces vm.notify through native VS Code notifications', async () => {
  const ext = await read('extensions/webvm-host/extension.js');
  assert.match(ext, /bus\.on\('vm\.notify'/);
  assert.match(ext, /showErrorMessage/);
  assert.match(ext, /showWarningMessage/);
  assert.match(ext, /showInformationMessage/);
  // It requests a replay of anything buffered before activation...
  assert.match(ext, /bus\.emit\('vm\.notify\.sync'/);
  // ...and dedupes by the monotonic id so replays show once.
  const sub = ext.slice(ext.indexOf('function subscribeNotifications'));
  assert.match(sub, /seen\.has/);
  assert.match(sub, /seen\.add/);
});

test('issue-39: inlined bus client can emit events (needed for vm.notify.sync)', async () => {
  const ext = await read('extensions/webvm-host/extension.js');
  const start = ext.indexOf('function createBusClient');
  const end = ext.indexOf('const textEncoder');
  assert.ok(start >= 0 && end > start, 'createBusClient block not found');
  const client = ext.slice(start, end);
  assert.match(client, /function emit\(topic, payload\)/);
  assert.match(client, /return \{ request, on, emit \}/);
});

// --- 4. The terminal GENUINELY fails on an unhealthy shell ------------

test('issue-39: pseudoterminal fails (non-zero exit) when vm.shell is unhealthy', async () => {
  const ext = await read('extensions/webvm-host/extension.js');
  const start = ext.indexOf('function makePseudoterminal');
  const end = ext.indexOf('// --- Cargo tasks', start);
  assert.ok(start >= 0 && end > start, 'makePseudoterminal block not found');
  const fn = ext.slice(start, end);
  // Subscribes to the page-side shell-health signal...
  assert.match(fn, /bus\.on\('vm\.shell'/);
  assert.match(fn, /payload\.healthy !== false/);
  // ...and closes the terminal with a non-zero exit code.
  assert.match(fn, /closeEmitter\.fire\(1\)/);
  // The shell listener must be cleaned up like the others (issue #27).
  assert.match(fn, /shellDispose/);
});

test('issue-39: server still streams a genuine terminal advisory + vm.shell event', async () => {
  // The page-side server is the source of truth for the failure; the
  // extension only renders it. Keep that contract pinned.
  const srv = await read('glue/webvm-server.js');
  assert.match(srv, /emit\('vm\.shell',\s*\{\s*healthy:\s*false/);
  assert.match(srv, /produced no prompt/);
});
