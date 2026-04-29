// Regression test for issue #5 root cause #1.
//
// CheerpX 1.2.x ships its engine as paired `.js` + `.wasm` siblings.
// `cxcore.js` loads `cxcore.wasm`; `cxcore-no-return-call.js` loads
// `cxcore-no-return-call.wasm`. The browser picks one variant at runtime
// based on WebAssembly tail-call support. Until issue #5 the build
// vendored only `cxcore.wasm` — the other variant 404'd at runtime, the
// loader fed the SPA-404 HTML to `WebAssembly.instantiate`, and CheerpX
// crashed with `expected magic word 00 61 73 6d, found 3c 21 44 4f`
// (ASCII `<!DO`).
//
// We assert the build script's vendor list still pairs every `*-core*.js`
// with a sibling `*.wasm`. New CheerpX features that introduce another
// variant (or an unrelated paired asset) will surface here as a fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILD_SCRIPT = path.resolve(__dirname, '..', 'build', 'build-workbench.mjs');

function extractFilesArray(source) {
  // The vendor list is the literal `const files = [ ... ]` inside
  // `vendorCheerpX()`. We parse it by extracting the bracketed block
  // and `JSON.parse`-ing it after a tiny normalisation.
  const idx = source.indexOf('const files = [');
  assert.notEqual(idx, -1, 'expected `const files = [` in build-workbench.mjs');
  const start = source.indexOf('[', idx);
  const end = source.indexOf('];', start);
  const block = source.slice(start, end + 1)
    .replace(/'/g, '"')
    .replace(/\/\/[^\n]*/g, '')      // strip line comments
    .replace(/,(\s*])/g, '$1');      // strip trailing comma
  return JSON.parse(block);
}

test('cheerpx vendor list: cxcore-no-return-call.wasm is fetched', async () => {
  const src = await readFile(BUILD_SCRIPT, 'utf8');
  const files = extractFilesArray(src);
  assert.ok(
    files.includes('cxcore-no-return-call.wasm'),
    'cxcore-no-return-call.wasm must be vendored — without it CheerpX init ' +
      'crashes on browsers that lack WASM tail-call support (issue #5).',
  );
});

test('cheerpx vendor list: every cxcore*.js has a paired .wasm', async () => {
  const src = await readFile(BUILD_SCRIPT, 'utf8');
  const files = extractFilesArray(src);
  const set = new Set(files);
  for (const f of files) {
    if (!/^cxcore.*\.js$/.test(f)) continue;
    const wasm = f.replace(/\.js$/, '.wasm');
    assert.ok(
      set.has(wasm),
      `${f} listed without sibling ${wasm} — runtime would 404 on the wasm.`,
    );
  }
});

test('cheerpx vendor list: cx_esm.js / cx.esm.js are still required', async () => {
  // These two are the entry point. The vendoring code throws if either
  // 404s on the CDN, so they're load-bearing for the boot path. Pin them
  // so a refactor that moves them into a different list (or renames)
  // doesn't silently break the offline-first guarantee.
  const src = await readFile(BUILD_SCRIPT, 'utf8');
  const files = extractFilesArray(src);
  assert.ok(files.includes('cx_esm.js'));
  assert.ok(files.includes('cx.esm.js'));
});
