// Regression tests for issue #3 — additionalBuiltinExtensions must
// resolve correctly under sub-path deployments (GitHub Pages).
//
// The bug: the original code substituted only {ORIGIN_SCHEME} and
// {ORIGIN_HOST} in the extension URI, leaving `path` as
// "/extensions/webvm-host". On `https://link-foundation.github.io/rust-web-box/`
// the resolved URL became `https://link-foundation.github.io/extensions/webvm-host/package.json`
// — missing the `/rust-web-box/` segment — and 404'd. The fix: also
// substitute a {BASE_PATH} placeholder derived from `location.pathname`.
//
// These tests exercise the substitution logic against three deployment
// topologies the project actually targets, plus one degenerate case.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyWorkbenchPlaceholders } from '../glue/workbench-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');

function freshConfig() {
  return {
    additionalBuiltinExtensions: [
      { scheme: '{ORIGIN_SCHEME}', authority: '{ORIGIN_HOST}', path: '{BASE_PATH}/extensions/webvm-host' },
      { scheme: '{ORIGIN_SCHEME}', authority: '{ORIGIN_HOST}', path: '{BASE_PATH}/extensions/rust-analyzer-web' },
    ],
  };
}

function uriToString(c) {
  return `${c.scheme}://${c.authority}${c.path}`;
}

test('extension paths: dev server at root → no base prefix', () => {
  const cfg = applyWorkbenchPlaceholders(freshConfig(), {
    scheme: 'http',
    host: 'localhost:8080',
    basePath: '',
  });
  assert.equal(uriToString(cfg.additionalBuiltinExtensions[0]), 'http://localhost:8080/extensions/webvm-host');
  assert.equal(uriToString(cfg.additionalBuiltinExtensions[1]), 'http://localhost:8080/extensions/rust-analyzer-web');
});

test('extension paths: GitHub Pages at /rust-web-box/ → base prefix added', () => {
  const cfg = applyWorkbenchPlaceholders(freshConfig(), {
    scheme: 'https',
    host: 'link-foundation.github.io',
    basePath: '/rust-web-box',
  });
  assert.equal(
    uriToString(cfg.additionalBuiltinExtensions[0]),
    'https://link-foundation.github.io/rust-web-box/extensions/webvm-host',
  );
  assert.equal(
    uriToString(cfg.additionalBuiltinExtensions[1]),
    'https://link-foundation.github.io/rust-web-box/extensions/rust-analyzer-web',
  );
});

test('extension paths: deeply nested deploy at /foo/bar/ → base prefix added', () => {
  const cfg = applyWorkbenchPlaceholders(freshConfig(), {
    scheme: 'https',
    host: 'example.com',
    basePath: '/foo/bar',
  });
  assert.equal(
    uriToString(cfg.additionalBuiltinExtensions[0]),
    'https://example.com/foo/bar/extensions/webvm-host',
  );
});

test('extension paths: legacy path without {BASE_PATH} still gets rewritten (no regression)', () => {
  // Belt-and-braces: even if a stale build artifact (or a hand-edited
  // index.html) ships paths without the placeholder, the runtime patch
  // still injects the deploy base so the bug from issue #3 cannot
  // silently re-emerge.
  const cfg = {
    additionalBuiltinExtensions: [
      { scheme: '{ORIGIN_SCHEME}', authority: '{ORIGIN_HOST}', path: '/extensions/webvm-host' },
    ],
  };
  applyWorkbenchPlaceholders(cfg, {
    scheme: 'https',
    host: 'link-foundation.github.io',
    basePath: '/rust-web-box',
  });
  assert.equal(
    uriToString(cfg.additionalBuiltinExtensions[0]),
    'https://link-foundation.github.io/rust-web-box/extensions/webvm-host',
  );
});

test('extension paths: unknown placeholders pass through unchanged', () => {
  const cfg = {
    additionalBuiltinExtensions: [
      { scheme: 'https', authority: 'cdn.example.com', path: '/some/other/extension' },
    ],
  };
  applyWorkbenchPlaceholders(cfg, {
    scheme: 'https',
    host: 'link-foundation.github.io',
    basePath: '/rust-web-box',
  });
  // External CDN URLs (already concrete) should be left alone — they
  // don't start with /extensions/ so the legacy-rewrite branch skips them.
  assert.equal(uriToString(cfg.additionalBuiltinExtensions[0]), 'https://cdn.example.com/some/other/extension');
});

test('extension paths: idempotent — running twice produces the same result', () => {
  const cfg = freshConfig();
  applyWorkbenchPlaceholders(cfg, { scheme: 'https', host: 'example.com', basePath: '/x' });
  const once = JSON.stringify(cfg);
  applyWorkbenchPlaceholders(cfg, { scheme: 'https', host: 'example.com', basePath: '/x' });
  const twice = JSON.stringify(cfg);
  assert.equal(once, twice, 'second pass must not double-prefix the base path');
});

test('extension paths: handles missing additionalBuiltinExtensions gracefully', () => {
  const cfg = {};
  // Should not throw.
  applyWorkbenchPlaceholders(cfg);
  assert.deepEqual(cfg, {});
});

test('extension paths: rendered index.html ships {BASE_PATH} placeholder (no regression)', async () => {
  // The static rendered index.html must contain the {BASE_PATH}
  // placeholder for the inline bootstrap to substitute. If a future
  // refactor drops the placeholder, the runtime patch in boot.js still
  // catches it via the legacy-rewrite branch — but we want the
  // belt-and-braces explicit, so this test fails loudly first.
  const html = await fs.readFile(path.join(WEB_ROOT, 'index.html'), 'utf8');
  assert.match(html, /\{BASE_PATH\}\/extensions\/webvm-host/, 'index.html must encode {BASE_PATH} placeholder');
  assert.match(html, /\{BASE_PATH\}\/extensions\/rust-analyzer-web/, 'index.html must encode {BASE_PATH} placeholder');
});

test('extension paths: inline bootstrap substitutes {BASE_PATH} (no regression)', async () => {
  // Bug shape: the inline script in index.html runs *before* boot.js
  // and writes window.product. If the inline script forgets to
  // substitute {BASE_PATH}, the workbench will request the wrong URL
  // even with boot.js working. Assert the inline script handles it.
  const html = await fs.readFile(path.join(WEB_ROOT, 'index.html'), 'utf8');
  assert.match(html, /\{BASE_PATH\}/, 'inline bootstrap must reference {BASE_PATH}');
  assert.match(html, /e\.path\.indexOf\('\{BASE_PATH\}'\) === 0/, 'inline bootstrap must check for {BASE_PATH} placeholder');
  assert.match(html, /basePath \+ e\.path\.slice/, 'inline bootstrap must rewrite path with basePath prefix');
});
