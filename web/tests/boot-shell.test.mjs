// Smoke test that exercises the boot shell against the static layout.
// We deliberately avoid a real browser here — that lives in
// web/tests/playwright-smoke.mjs. Node's filesystem reads are enough
// to assert the pieces are wired up.

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

test('boot shell: index.html mounts directly into <body> with no custom UI overlay', async () => {
  const html = await read('index.html');
  // No 5-stage boot overlay — the workbench is the page now.
  assert.doesNotMatch(html, /id="boot-overlay"/);
  assert.doesNotMatch(html, /Static shell/);
  // The toast element exists but is hidden by default.
  assert.match(html, /id="boot-toast"/);
  assert.match(html, /id="boot-toast"\s+hidden/);
});

test('boot shell: index.html references workbench config meta', async () => {
  const html = await read('index.html');
  assert.match(html, /vscode-workbench-web-configuration/);
});

test('boot shell: workbench config preinstalls our two extensions', async () => {
  const html = await read('index.html');
  assert.match(html, /\/extensions\/webvm-host/);
  assert.match(html, /\/extensions\/rust-analyzer-web/);
  assert.match(html, /folderUri.*webvm.*\/workspace/);
});

test('boot shell: index.html points to vendored vscode-web bundle', async () => {
  const html = await read('index.html');
  assert.match(
    html,
    /vscode-web\/out\/vs\/workbench\/workbench\.web\.main\.js/,
  );
  assert.match(html, /vscode-web\/out\/vs\/loader\.js/);
});

test('boot shell: glue modules exist', async () => {
  for (const rel of [
    'glue/boot.js',
    'glue/boot.css',
    'glue/network-shim.js',
    'glue/cheerpx-bridge.js',
    'glue/webvm-bus.js',
    'glue/webvm-server.js',
    'glue/workspace-fs.js',
    'glue/workspace-server.js',
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
  const pkg = JSON.parse(await read('extensions/webvm-host/package.json'));
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

test('boot shell: service worker synthesises COOP/COEP headers (credentialless for cross-origin disk)', async () => {
  const sw = await read('sw.js');
  assert.match(sw, /Cross-Origin-Opener-Policy.*same-origin/);
  assert.match(sw, /Cross-Origin-Embedder-Policy.*credentialless/);
});

test('boot shell: build script vendors vscode-web@1.91.1 + cheerpx 1.2.11', async () => {
  const build = await read('build/build-workbench.mjs');
  assert.match(build, /VSCODE_WEB_VERSION = '1\.91\.1'/);
  assert.match(build, /CHEERPX_VERSION = '1\.2\.11'/);
});

test('boot shell: webvm-host extension shows a "Booting Linux VM" banner', async () => {
  const ext = await read('extensions/webvm-host/extension.js');
  assert.match(ext, /Booting Linux VM/);
});

test('boot shell: webvm-host auto-opens a terminal on activation', async () => {
  const ext = await read('extensions/webvm-host/extension.js');
  assert.match(ext, /vscode\.window\.createTerminal/);
  assert.match(ext, /webvm-host\.openTerminal/);
});

test('boot shell: webvm-host auto-opens hello_world.rs on activation', async () => {
  const ext = await read('extensions/webvm-host/extension.js');
  assert.match(ext, /openHelloWorld/);
  assert.match(ext, /webvm:\/workspace\/hello_world\.rs/);
  assert.match(ext, /vscode\.window\.showTextDocument/);
});

test('boot shell: workspace-fs seeds hello_world.rs at workspace root', async () => {
  const wfs = await read('glue/workspace-fs.js');
  assert.match(wfs, /\/workspace\/hello_world\.rs/);
  assert.match(wfs, /\/workspace\/hello\/Cargo\.toml/);
  assert.match(wfs, /\/workspace\/hello\/src\/main\.rs/);
});

test('boot shell: webvm-server mirrors workspace into the guest via heredocs', async () => {
  const srv = await read('glue/webvm-server.js');
  assert.match(srv, /heredocForFile/);
  assert.match(srv, /primeGuestWorkspace/);
  assert.match(srv, /ls -la \/workspace/);
});

test('boot shell: boot.js stages workspace-only server before VM is up', async () => {
  const boot = await read('glue/boot.js');
  assert.match(boot, /workspaceOnlyMethods/);
  assert.match(boot, /openWorkspaceFS/);
  assert.match(boot, /bringUpWorkspace/);
  assert.match(boot, /bringUpVM/);
});

test('boot shell: disk manifest carries an Alpine warm image entry pointing to disk-latest', async () => {
  const m = JSON.parse(await read('disk/manifest.json'));
  assert.equal(m.warm.alpine, true);
  assert.equal(m.warm.rust, true);
  assert.equal(m.warm.release_tag, 'disk-latest');
  assert.match(m.warm.url, /\/releases\/download\/disk-latest\/rust-alpine\.ext2$/);
});

test('boot shell: Dockerfile.disk uses Alpine and pre-bakes hello-world', async () => {
  const d = await read('disk/Dockerfile.disk');
  assert.match(d, /FROM i386\/alpine/);
  assert.match(d, /apk add[\s\S]+?\bbash\b/);
  assert.match(d, /apk add[\s\S]+?\brust\b/);
  assert.match(d, /apk add[\s\S]+?\bcargo\b/);
  assert.match(d, /workspace\/hello/);
});

test('boot shell: pages workflow deploys to GitHub Pages on main', async () => {
  const wf = await fs.readFile(
    path.resolve(WEB_ROOT, '..', '.github', 'workflows', 'pages.yml'),
    'utf8',
  );
  assert.match(wf, /actions\/upload-pages-artifact/);
  assert.match(wf, /actions\/deploy-pages/);
  assert.match(wf, /github\.ref == 'refs\/heads\/main'/);
});

test('boot shell: disk-image workflow exists and triggers on workflow_dispatch', async () => {
  const wf = await fs.readFile(
    path.resolve(WEB_ROOT, '..', '.github', 'workflows', 'disk-image.yml'),
    'utf8',
  );
  assert.match(wf, /workflow_dispatch/);
  assert.match(wf, /rust-alpine\.ext2/);
});

test('boot shell: disk-image workflow auto-publishes to disk-latest on push to main', async () => {
  const wf = await fs.readFile(
    path.resolve(WEB_ROOT, '..', '.github', 'workflows', 'disk-image.yml'),
    'utf8',
  );
  assert.match(wf, /disk-latest/);
  assert.match(wf, /gh release upload/);
  assert.match(wf, /github\.event_name == 'push'/);
});
