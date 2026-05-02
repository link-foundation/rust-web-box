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

test('boot shell: console filter runs before VS Code loader', async () => {
  const html = await read('index.html');
  assert.match(html, /glue\/console-filter\.js/);
  const filter = html.indexOf('glue/console-filter.js');
  const loader = html.indexOf('vscode-web/out/vs/loader.js');
  assert.ok(filter > 0, 'expected console-filter.js in index.html');
  assert.ok(loader > filter, 'console filter must run before VS Code loader');
});

test('boot shell: workbench config preinstalls our two extensions', async () => {
  const html = await read('index.html');
  assert.match(html, /\/extensions\/webvm-host/);
  assert.match(html, /\/extensions\/rust-analyzer-web/);
  assert.match(html, /folderUri.*webvm.*\/workspace/);
  assert.match(html, /workbench\.startupEditor/);
  assert.match(html, /extensions\.ignoreRecommendations/);
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
    'glue/console-filter.js',
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

test('boot shell: service worker synthesises COOP/COEP headers (require-corp for same-origin disk)', async () => {
  const sw = await read('sw.js');
  assert.match(sw, /Cross-Origin-Opener-Policy.*same-origin/);
  assert.match(sw, /Cross-Origin-Embedder-Policy.*require-corp/);
});

test('boot shell: build script vendors vscode-web@1.91.1 + cheerpx 1.3.0', async () => {
  const build = await read('build/build-workbench.mjs');
  assert.match(build, /VSCODE_WEB_VERSION = '1\.91\.1'/);
  assert.match(build, /CHEERPX_VERSION = '1\.3\.0'/);
});

test('boot shell: workbench bootstrap provides process.env for browserified dependencies', async () => {
  const template = await read('build/index.template.html');
  assert.match(template, /root\.process = proc/);
  assert.match(template, /proc\.env/);
  assert.match(template, /vscode-web\/out\/vs\/loader\.js/);

  const processShim = template.indexOf('root.process = proc');
  const loader = template.indexOf('vscode-web/out/vs/loader.js');
  assert.ok(processShim > 0, 'expected process.env shim in template');
  assert.ok(loader > processShim, 'process.env shim must run before VS Code loader');
});

test('boot shell: rendered index keeps the browser process.env shim', async () => {
  const html = await read('index.html');
  assert.match(html, /root\.process = proc/);
  assert.match(html, /proc\.env/);
});

test('boot shell: webvm-host extension shows a "Booting Linux VM" banner', async () => {
  const ext = await read('extensions/webvm-host/extension.js');
  assert.match(ext, /Booting Linux VM/);
  assert.match(ext, /in-browser Rust sandbox/);
  assert.doesNotMatch(ext, /anonymous in-browser Rust sandbox/);
  assert.doesNotMatch(ext, /VM stage:/);
});

test('boot shell: webvm-host auto-opens a terminal on activation', async () => {
  const ext = await read('extensions/webvm-host/extension.js');
  assert.match(ext, /vscode\.window\.createTerminal/);
  assert.match(ext, /webvm-host\.openTerminal/);
});

test('boot shell: webvm-host auto-opens src/main.rs on activation', async () => {
  const ext = await read('extensions/webvm-host/extension.js');
  assert.match(ext, /openHelloWorld/);
  assert.match(ext, /webvm:\/workspace\/src\/main\.rs/);
  assert.doesNotMatch(ext, /webvm:\/workspace\/hello_world\.rs/);
  assert.match(ext, /vscode\.window\.showTextDocument/);
});

test('boot shell: workspace-fs seeds a root Cargo project', async () => {
  const wfs = await read('glue/workspace-fs.js');
  assert.match(wfs, /\/workspace\/Cargo\.toml/);
  assert.match(wfs, /\/workspace\/src\/main\.rs/);
  assert.match(wfs, /"command": "cargo run"/);
  assert.doesNotMatch(wfs, /"command": "cd \/workspace\/hello && cargo run"/);
  assert.match(wfs, /LEGACY_SEED_FILES/);
  assert.match(wfs, /replaceIfUnchanged\(\s*'\/workspace\/\.vscode\/tasks\.json'/);
});

test('boot shell: webvm-server mirrors workspace through a quiet DataDevice script', async () => {
  const srv = await read('glue/webvm-server.js');
  assert.match(srv, /heredocForFile/);
  assert.match(srv, /primeGuestWorkspace/);
  assert.match(srv, /buildShellProfileScript/);
  assert.match(srv, /dataDevice\.writeFile/);
  assert.doesNotMatch(srv, /ls -la \/workspace/);
  assert.doesNotMatch(srv, /stty -echo/);
});

test('boot shell: boot.js wires guest debug logs for ?debug routes', async () => {
  const boot = await read('glue/boot.js');
  assert.match(boot, /createDebug\('guest'/);
  // `opts` may carry other keys (skipPrime, skipShellLoop) — only assert
  // that `debug: dbgGuest` is present.
  assert.match(boot, /opts:\s*\{[^}]*debug:\s*dbgGuest/);
});

test('boot shell: boot.js passes CheerpX DataDevice to the WebVM server', async () => {
  const boot = await read('glue/boot.js');
  assert.match(boot, /dataDevice:\s*vm\.dataDevice/);
});

test('boot shell: webvm-server normalises bare LF to CRLF before broadcasting stdout', async () => {
  // Without this the terminal pane staircases output (each line indents
  // further to the right) because bash inside CheerpX has no kernel TTY
  // performing ONLCR mapping. Asserting the wire-up here keeps the
  // regression from sneaking back in via a refactor.
  const srv = await read('glue/webvm-server.js');
  assert.match(srv, /createLfToCrlfNormaliser/);
  assert.match(srv, /normaliseCrlf\(/);
});

test('boot shell: boot.js stages workspace-only server before VM is up', async () => {
  const boot = await read('glue/boot.js');
  assert.match(boot, /workspaceOnlyMethods/);
  assert.match(boot, /openWorkspaceFS/);
  assert.match(boot, /bringUpWorkspace/);
  assert.match(boot, /bringUpVM/);
});

test('boot shell: disk manifest carries an Alpine warm image entry staged for Pages', async () => {
  const m = JSON.parse(await read('disk/manifest.json'));
  assert.equal(m.warm.alpine, true);
  assert.equal(m.warm.rust, true);
  assert.equal(m.warm.release_tag, 'disk-latest');
  assert.equal(m.warm.kind, 'github');
  assert.equal(m.warm.url, null);
  assert.match(m.warm.source_release_url, /\/releases\/download\/disk-latest\/rust-alpine\.ext2$/);
  assert.match(m.warm.notes, /stage-pages-disk\.mjs/);
});

test('boot shell: rust-analyzer-web does not probe a missing WASM unless package metadata opts in', async () => {
  const pkg = JSON.parse(await read('extensions/rust-analyzer-web/package.json'));
  assert.equal(pkg.rustAnalyzerWeb?.wasm ?? null, null);

  const ext = await read('extensions/rust-analyzer-web/extension.js');
  assert.match(ext, /packageJSON\?\.rustAnalyzerWeb\?\.wasm/);
  assert.doesNotMatch(
    ext,
    /const\s+ANALYZER_WASM\s*=\s*['"]\.\/rust-analyzer\.wasm['"]/,
    'the extension must not hard-code a missing rust-analyzer.wasm fetch',
  );
});

test('boot shell: Dockerfile.disk uses Alpine and pre-bakes root hello-world', async () => {
  const d = await read('disk/Dockerfile.disk');
  assert.match(d, /FROM i386\/alpine/);
  assert.match(d, /apk add[\s\S]+?\bbash\b/);
  assert.match(d, /apk add[\s\S]+?\brust\b/);
  assert.match(d, /apk add[\s\S]+?\bcargo\b/);
  assert.match(d, /apk add[\s\S]+?\btree\b/);
  assert.match(d, /\/workspace\/Cargo\.toml/);
  assert.match(d, /\/workspace\/src\/main\.rs/);
  assert.doesNotMatch(d, /workspace\/hello/);
  assert.doesNotMatch(d, /\|\|\s*true/);

  const build = await read('disk/build.sh');
  assert.match(build, /resize2fs -M "\$IMG"/);
});

test('boot shell: disk-image workflow e2e verifies tree, cargo, and cargo run output', async () => {
  const wf = await fs.readFile(
    path.resolve(WEB_ROOT, '..', '.github', 'workflows', 'disk-image.yml'),
    'utf8',
  );
  assert.match(wf, /tree --version/);
  assert.match(wf, /cargo --version/);
  assert.match(wf, /cargo run --release/);
  assert.match(wf, /Hello from rust-web-box!/);
  assert.match(wf, /This binary was compiled inside CheerpX\./);
  assert.doesNotMatch(wf, /rust-web-box-cargo-run\.out/);
});

test('boot shell: pages workflow deploys to GitHub Pages on main', async () => {
  const wf = await fs.readFile(
    path.resolve(WEB_ROOT, '..', '.github', 'workflows', 'pages.yml'),
    'utf8',
  );
  assert.match(wf, /stage-pages-disk\.mjs/);
  assert.match(wf, /actions\/upload-pages-artifact/);
  assert.match(wf, /actions\/deploy-pages/);
  assert.match(wf, /github\.ref == 'refs\/heads\/main'/);
});

test('boot shell: warm disk staging fails closed by default', async () => {
  const stage = await read('build/stage-pages-disk.mjs');
  assert.match(stage, /STAGE_WARM_DISK_REQUIRED !== '0'/);
  assert.match(stage, /no release source URL configured[\s\S]+STAGE_WARM_DISK_REQUIRED=0/);
  assert.match(stage, /failing this build so production never ships without cargo/);
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
  assert.match(wf, /gh workflow run pages\.yml/);
});
