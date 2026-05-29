// Regression tests for issue #37 — "Make UI/UX perfectly match vscode.dev".
//
// Three independent failures were fixed here; each gets a pinned-down
// assertion so a refactor can't silently reintroduce it:
//   1. Dark theme was never applied (the workbench fell back to the OS
//      `prefers-color-scheme`, rendering Light Modern). We now ship a
//      `workbench.colorTheme: Default Dark Modern` default in every place
//      the workbench configuration is produced.
//   2. CSS clipping on iPad Safari: `width: 100vw; height: 100vh` resolves
//      wider than the visible viewport, so `overflow: hidden` clipped the
//      title-bar / panel controls. Fixed with `position: fixed; inset: 0`
//      plus `viewport-fit=cover` + safe-area insets.
//   3. The interactive shell could die silently on a device where bash
//      never starts (the iPad terminal symptom). We added shell-loop
//      health diagnostics + Safari/iPad detection so the failure is
//      observable via `__rustWebBox.dump()` next iteration.

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

// --- 1. Default dark theme ---------------------------------------------

test('issue-37: rendered index.html defaults to the Default Dark Modern theme', async () => {
  const html = await read('index.html');
  // HTML-escaped inside the data-settings attribute.
  assert.match(html, /workbench\.colorTheme/);
  assert.match(html, /Default Dark Modern/);
});

test('issue-37: build script writes the dark theme default into product + index', async () => {
  const build = await read('build/build-workbench.mjs');
  // Both writeProductJson() and renderIndex() must carry the default, or
  // a fresh `node build-workbench.mjs` would regress the rendered page.
  const occurrences = build.match(/Default Dark Modern/g) ?? [];
  assert.ok(
    occurrences.length >= 2,
    `expected the dark-theme default in both config writers, found ${occurrences.length}`,
  );
  assert.match(build, /workbench\.colorTheme/);
});

// --- 2. Viewport / safe-area CSS ---------------------------------------

test('issue-37: boot.css pins the workbench with position:fixed/inset:0, not 100vw/100vh', async () => {
  const css = await read('glue/boot.css');
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /inset:\s*0/);
  // The clipping bug came from these — they must be gone from the actual
  // declarations. Strip /* … */ comments first so the explanatory note
  // (which names the old values) doesn't trip the assertion.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /100vw/);
  assert.doesNotMatch(code, /100vh/);
});

test('issue-37: boot.css offsets the boot toast by safe-area insets', async () => {
  const css = await read('glue/boot.css');
  assert.match(css, /env\(safe-area-inset-right/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});

test('issue-37: viewport meta opts into viewport-fit=cover (both source + rendered)', async () => {
  for (const rel of ['index.html', 'build/index.template.html']) {
    const html = await read(rel);
    assert.match(html, /viewport-fit=cover/, `${rel} must request viewport-fit=cover`);
  }
});

// --- 3. Terminal / shell diagnostics -----------------------------------

test('issue-37: webvm-server records interactive-shell health diagnostics', async () => {
  const srv = await read('glue/webvm-server.js');
  // The runtime carries a shellLoop diag object the dump can read.
  assert.match(srv, /shellLoop:/);
  assert.match(srv, /fastCycles/);
  assert.match(srv, /onShellUnhealthy/);
  // It must expose the runtime so dumpRuntime() can read it.
  assert.match(srv, /runtime,/);
});

test('issue-37: boot.js surfaces an unhealthy shell as a toast', async () => {
  const boot = await read('glue/boot.js');
  assert.match(boot, /onShellUnhealthy/);
  assert.match(boot, /vmServer/);
});

test('issue-37: browser-info detects iOS / iPadOS / Safari', async () => {
  const info = await read('glue/browser-info.js');
  assert.match(info, /isSafari/);
  assert.match(info, /isIPad/);
  assert.match(info, /isIOS/);
  // iPadOS Safari masquerades as Macintosh — detection must lean on touch.
  assert.match(info, /maxTouchPoints/);
});

test('issue-37: dumpRuntime reports platform + shell-loop health', async () => {
  const dbg = await read('glue/debug.js');
  assert.match(dbg, /shellLoop/);
  assert.match(dbg, /isSafari/);
  assert.match(dbg, /isIPad/);
  assert.match(dbg, /maxTouchPoints/);
});
