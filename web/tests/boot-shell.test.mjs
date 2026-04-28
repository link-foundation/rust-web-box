// Smoke test that exercises the boot shell against a static HTTP server.
// The page must respond 200 for index.html + the glue modules, and the
// HTML must contain the boot indicators the boot script targets.
//
// We deliberately avoid spinning up a full browser here — that lives in
// the manual Playwright verification documented in docs/architecture.md.
// Node's HTTP module is enough to assert the static assets are wired up.

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

test('boot shell: index.html loads required boot indicators', async () => {
  const html = await read('index.html');
  for (const indicator of ['shim', 'cheerpx', 'vm', 'vscode']) {
    assert.match(
      html,
      new RegExp(`data-status="${indicator}"`),
      `expected boot indicator for ${indicator}`,
    );
  }
});

test('boot shell: index.html references workbench config meta', async () => {
  const html = await read('index.html');
  assert.match(html, /vscode-workbench-web-configuration/);
  assert.match(html, /vscode-workbench-builtin-extensions/);
});

test('boot shell: index.html points to vendored vscode-web bundle', async () => {
  const html = await read('index.html');
  assert.match(html, /vscode-web\/out\/vs\/workbench\/workbench\.web\.main\.internal\.js/);
});

test('boot shell: glue modules exist', async () => {
  for (const rel of [
    'glue/boot.js',
    'glue/boot.css',
    'glue/network-shim.js',
    'glue/cheerpx-bridge.js',
    'glue/webvm-bus.js',
    'glue/webvm-server.js',
  ]) {
    await fs.access(path.join(WEB_ROOT, rel));
  }
});

test('boot shell: extensions are present with package.json + extension.js', async () => {
  for (const ext of ['webvm-host', 'rust-analyzer-web']) {
    await fs.access(path.join(WEB_ROOT, 'extensions', ext, 'package.json'));
    await fs.access(path.join(WEB_ROOT, 'extensions', ext, 'extension.js'));
  }
});

test('boot shell: webvm-host package.json declares web extensionKind', async () => {
  const pkg = JSON.parse(
    await read('extensions/webvm-host/package.json'),
  );
  assert.deepEqual(pkg.extensionKind, ['web']);
  assert.equal(pkg.browser, './extension.js');
  assert.ok(
    pkg.contributes.commands.find((c) => c.command === 'webvm-host.cargo.run'),
    'expected `webvm-host.cargo.run` command',
  );
  assert.ok(
    pkg.contributes.terminal.profiles.find((p) => p.id === 'webvm-host.bash'),
    'expected `webvm-host.bash` terminal profile',
  );
});

test('boot shell: rust-analyzer-web package.json declares rust language', async () => {
  const pkg = JSON.parse(
    await read('extensions/rust-analyzer-web/package.json'),
  );
  assert.deepEqual(pkg.extensionKind, ['web']);
  const rust = pkg.contributes.languages.find((l) => l.id === 'rust');
  assert.ok(rust, 'expected rust language contribution');
  assert.deepEqual(rust.extensions, ['.rs']);
});

test('boot shell: service worker synthesises COOP/COEP headers', async () => {
  const sw = await read('sw.js');
  assert.match(sw, /Cross-Origin-Opener-Policy.*same-origin/);
  assert.match(sw, /Cross-Origin-Embedder-Policy.*require-corp/);
});

test('boot shell: build script vendors vscode-web@1.91.1 + cheerpx 1.2.8', async () => {
  const build = await read('build/build-workbench.mjs');
  assert.match(build, /VSCODE_WEB_VERSION = '1\.91\.1'/);
  assert.match(build, /CHEERPX_VERSION = '1\.2\.8'/);
});
