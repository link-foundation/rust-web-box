// End-to-end-ish test: spin up the dev server under a sub-path
// (mirroring GitHub Pages' /rust-web-box/), fetch the rendered index,
// and verify the inline bootstrap path that issue #3 hinged on.
//
// Why this exists: the boot-shell smoke test only greps the static
// HTML. It cannot detect "the substitution doesn't run on a sub-path"
// (which is exactly what slipped through to issue #3). This test
// exercises the same deployment topology Pages uses, so any regression
// to the substitution logic — or to dev-server's --base flag — breaks
// the build before deploy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const DEV_SERVER = path.join(WEB_ROOT, 'build', 'dev-server.mjs');
// Use a deliberately weird port to avoid clashing with a hand-started server.
const PORT = 8765 + Math.floor(Math.random() * 100);

async function startServer({ base = '' } = {}) {
  const args = [DEV_SERVER, String(PORT)];
  if (base) args.push(`--base=${base}`);
  const proc = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  // Wait for "rust-web-box dev server: …" line on stdout.
  await new Promise((resolve, reject) => {
    const onData = (buf) => {
      if (buf.toString().includes('rust-web-box dev server')) {
        proc.stdout.off('data', onData);
        resolve();
      }
    };
    proc.stdout.on('data', onData);
    proc.once('error', reject);
    setTimeout(() => reject(new Error('dev server did not start in time')), 5000);
  });
  return proc;
}

async function fetchText(url) {
  const res = await fetch(url);
  return { status: res.status, text: await res.text(), headers: res.headers };
}

test('pages-parity: dev-server --base=/x/y refuses anything outside the prefix (Pages mirror)', async () => {
  const proc = await startServer({ base: '/rust-web-box' });
  try {
    const off = await fetchText(`http://localhost:${PORT}/glue/boot.js`);
    assert.equal(off.status, 404, 'requests outside the base must 404');
    const on = await fetchText(`http://localhost:${PORT}/rust-web-box/glue/boot.js`);
    assert.equal(on.status, 200);
    assert.match(on.text, /applyWorkbenchPlaceholders/);
  } finally {
    proc.kill();
  }
});

test('pages-parity: bare-root visit redirects to the prefix (matches Pages /rust-web-box/ canonical URL)', async () => {
  const proc = await startServer({ base: '/rust-web-box' });
  try {
    const res = await fetch(`http://localhost:${PORT}/`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/rust-web-box/');
  } finally {
    proc.kill();
  }
});

test('pages-parity: index.html shipped under sub-path still encodes the {BASE_PATH} placeholder', async () => {
  // The substitution happens in the browser at runtime. We can verify
  // the *inline bootstrap* references {BASE_PATH} and computes basePath
  // from location.href — that's the bytecode the browser will execute.
  const proc = await startServer({ base: '/rust-web-box' });
  try {
    const r = await fetchText(`http://localhost:${PORT}/rust-web-box/`);
    assert.equal(r.status, 200);
    assert.match(r.text, /\{BASE_PATH\}\/extensions\/webvm-host/, 'data-settings must encode {BASE_PATH}');
    assert.match(r.text, /new URL\('\.\/', location\.href\)\.pathname/, 'inline bootstrap must compute basePath from location');
    assert.match(r.text, /e\.path\.indexOf\('\{BASE_PATH\}'\)/, 'inline bootstrap must substitute {BASE_PATH}');
  } finally {
    proc.kill();
  }
});

test('pages-parity: COOP/COEP headers are set under the sub-path (CheerpX SAB requirement)', async () => {
  // Issue #3 root cause #3: top-level isolation. The dev server has
  // always set the right headers; this test pins them down so a future
  // refactor of dev-server can't accidentally drop them.
  const proc = await startServer({ base: '/rust-web-box' });
  try {
    const r = await fetchText(`http://localhost:${PORT}/rust-web-box/`);
    assert.equal(r.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(r.headers.get('cross-origin-embedder-policy'), 'credentialless');
  } finally {
    proc.kill();
  }
});

test('pages-parity: extensions are reachable under the sub-path (the literal issue-#3 404)', async () => {
  // The exact bug shape: extension manifests must respond 200, not 404,
  // when fetched under the deploy base. If this test fails, the
  // workbench will silently render an empty Welcome page.
  const proc = await startServer({ base: '/rust-web-box' });
  try {
    const a = await fetchText(`http://localhost:${PORT}/rust-web-box/extensions/webvm-host/package.json`);
    assert.equal(a.status, 200, 'webvm-host/package.json must be reachable');
    const b = await fetchText(`http://localhost:${PORT}/rust-web-box/extensions/rust-analyzer-web/package.json`);
    assert.equal(b.status, 200, 'rust-analyzer-web/package.json must be reachable');
  } finally {
    proc.kill();
  }
});
