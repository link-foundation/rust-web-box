// Regression tests for issue #7 — root cause #1: cross-origin isolation
// bootstrap. The fix ships `web/glue/coi-bootstrap.js` as a synchronous
// classic <script> at the very top of <head>. These tests verify both
//
//   (a) the wiring — the script tag is present and is the first
//       executable script in <head>, in BOTH the live `index.html` and
//       the build template, and
//
//   (b) the behaviour — running the IIFE inside a Node `vm` sandbox
//       under the various decision-tree branches (warm load, opt-out,
//       no SW, fresh load, already-reloaded, controller attached, etc.)
//       calls `location.reload()` if and only if the spec demands it.
//
// See docs/case-studies/issue-7/analysis-coop-coep-bootstrap.md for the
// full mechanism. The tests are intentionally lightweight — Playwright
// covers the real-browser behaviour separately.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');

async function readWeb(rel) {
  return await fs.readFile(path.join(WEB_ROOT, rel), 'utf8');
}

// ---- (a) wiring tests ----------------------------------------------------

function firstScriptInHead(html) {
  const headMatch = html.match(/<head>([\s\S]*?)<\/head>/);
  if (!headMatch) return null;
  const head = headMatch[1];
  // Skip <script> tags inside HTML comments (the documentation-only
  // ones surrounding the bootstrap reference).
  const stripped = head.replace(/<!--[\s\S]*?-->/g, '');
  const m = stripped.match(/<script\b[^>]*>/);
  return m ? m[0] : null;
}

test('coi-bootstrap: glue/coi-bootstrap.js exists and exports nothing (classic script)', async () => {
  const src = await readWeb('glue/coi-bootstrap.js');
  // Must be a classic IIFE, NOT an ES module — the browser must execute
  // it synchronously at the top of <head>, before the AMD loader runs.
  assert.doesNotMatch(src, /^export\s/m, 'must not use ESM exports');
  assert.doesNotMatch(src, /^import\s/m, 'must not use ESM imports');
  assert.match(src, /\(function\s*\(\)\s*\{[\s\S]*\}\)\(\);?/, 'must be an IIFE');
  // Must reference the documented sessionStorage key (used by the
  // reload-loop guard) so a future refactor can't silently break it.
  assert.match(src, /rust-web-box\.coi\.reloaded/);
  // Must register the SW with a relative URL so deploy sub-paths work.
  assert.match(src, /navigator\.serviceWorker\s*\.register\s*\(\s*swUrl/);
  assert.match(src, /new URL\('\.\/sw\.js'/);
});

test('coi-bootstrap: index.html loads coi-bootstrap.js as the first <script> in <head>', async () => {
  const html = await readWeb('index.html');
  const first = firstScriptInHead(html);
  assert.ok(first, 'expected at least one <script> in <head>');
  assert.match(first, /coi-bootstrap\.js/);
  // Must be a classic script (no type=module, no defer, no async — it
  // MUST run before any other script). `defer` would let workbench.js
  // enqueue first; `async` would race; type=module would queue the
  // script in the module graph.
  assert.doesNotMatch(first, /type\s*=\s*["']module["']/);
  assert.doesNotMatch(first, /\bdefer\b/);
  assert.doesNotMatch(first, /\basync\b/);
});

test('coi-bootstrap: build/index.template.html loads coi-bootstrap.js as the first <script> in <head>', async () => {
  const html = await readWeb('build/index.template.html');
  const first = firstScriptInHead(html);
  assert.ok(first, 'expected at least one <script> in <head>');
  assert.match(first, /coi-bootstrap\.js/);
});

test('coi-bootstrap: boot.js no longer registers the SW directly (single owner)', async () => {
  const src = await readWeb('glue/boot.js');
  // boot.js must NOT call serviceWorker.register — that responsibility
  // moved to coi-bootstrap.js. Two registrations would race and the
  // second `register()` is harmless but the test pins the design.
  assert.doesNotMatch(src, /navigator\.serviceWorker\.register\s*\(/);
  // It SHOULD reference coi-bootstrap as the new owner so a future
  // contributor reading boot.js sees where SW registration moved.
  assert.match(src, /coi-bootstrap/);
});

test('coi-bootstrap: sw.js still synthesizes COOP/COEP (regression guard for the header half)', async () => {
  const src = await readWeb('sw.js');
  // The bootstrap is one half of the fix; sw.js's withCoopCoep is the
  // other. Pin them down together so a future cleanup can't drop one.
  assert.match(src, /Cross-Origin-Opener-Policy.*same-origin/);
  assert.match(src, /Cross-Origin-Embedder-Policy.*credentialless/);
});

// ---- (b) behavioural tests (vm sandbox) ----------------------------------

function makeSandbox({
  isolated = false,
  search = '',
  hasServiceWorker = true,
  controller = null,
  storedMarker = null,
  serviceWorkerImpl = {},
} = {}) {
  const reloads = [];
  const storage = new Map();
  if (storedMarker !== null) storage.set('rust-web-box.coi.reloaded', storedMarker);
  const consoleCalls = { warn: [], error: [], log: [] };
  const setTimeoutFns = [];
  const swListeners = {};
  const sandbox = {
    console: {
      warn: (...args) => consoleCalls.warn.push(args),
      error: (...args) => consoleCalls.error.push(args),
      log: (...args) => consoleCalls.log.push(args),
    },
    setTimeout: (fn, ms) => {
      setTimeoutFns.push({ fn, ms });
      return setTimeoutFns.length;
    },
    sessionStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: (k) => storage.delete(k),
    },
    URL,
    URLSearchParams,
  };
  const navigatorObj = hasServiceWorker
    ? {
        serviceWorker: {
          controller,
          register: serviceWorkerImpl.register || (async () => ({
            installing: null,
            waiting: null,
            active: { state: 'activated', addEventListener: () => {} },
          })),
          addEventListener: (event, fn) => {
            (swListeners[event] = swListeners[event] || []).push(fn);
          },
        },
      }
    : {};
  const windowObj = {
    location: {
      href: 'https://link-foundation.github.io/rust-web-box/',
      search,
      reload: () => reloads.push(Date.now()),
    },
    crossOriginIsolated: isolated,
  };
  sandbox.window = windowObj;
  sandbox.navigator = navigatorObj;
  sandbox.location = windowObj.location;
  // Self-reference so `(self||window)` patterns work.
  sandbox.self = sandbox;
  return { sandbox, reloads, storage, consoleCalls, setTimeoutFns, swListeners };
}

async function runBootstrap(sandboxBundle) {
  const src = await readWeb('glue/coi-bootstrap.js');
  vm.createContext(sandboxBundle.sandbox);
  vm.runInContext(src, sandboxBundle.sandbox, { filename: 'coi-bootstrap.js' });
  // Let any microtasks (the SW register promise) settle.
  await new Promise((r) => setImmediate(r));
}

test('coi-bootstrap: warm load (already isolated) is a no-op — no reload, no register', async () => {
  let registerCalled = false;
  const bundle = makeSandbox({
    isolated: true,
    serviceWorkerImpl: {
      register: async () => {
        registerCalled = true;
        return { active: { state: 'activated', addEventListener: () => {} } };
      },
    },
  });
  await runBootstrap(bundle);
  assert.equal(bundle.reloads.length, 0);
  assert.equal(registerCalled, false);
});

test('coi-bootstrap: ?coi=0 opt-out skips registration entirely', async () => {
  let registerCalled = false;
  const bundle = makeSandbox({
    isolated: false,
    search: '?coi=0',
    serviceWorkerImpl: {
      register: async () => {
        registerCalled = true;
        return {};
      },
    },
  });
  await runBootstrap(bundle);
  assert.equal(bundle.reloads.length, 0);
  assert.equal(registerCalled, false, 'register must not run when ?coi=0');
});

test('coi-bootstrap: no service worker API logs a warning and bails (no throw)', async () => {
  const bundle = makeSandbox({ isolated: false, hasServiceWorker: false });
  await runBootstrap(bundle);
  assert.equal(bundle.reloads.length, 0);
  // The warn is queued via setTimeout(_, 0).
  assert.equal(bundle.setTimeoutFns.length, 1);
  bundle.setTimeoutFns[0].fn();
  assert.equal(bundle.consoleCalls.warn.length, 1);
  assert.match(bundle.consoleCalls.warn[0][0], /Service workers unavailable/);
});

test('coi-bootstrap: fresh load with controller attached but not isolated triggers ONE reload', async () => {
  const bundle = makeSandbox({
    isolated: false,
    controller: { scriptURL: 'https://link-foundation.github.io/rust-web-box/sw.js' },
  });
  await runBootstrap(bundle);
  assert.equal(bundle.reloads.length, 1, 'must reload exactly once');
  assert.equal(
    bundle.storage.get('rust-web-box.coi.reloaded'),
    '1',
    'session marker must be set so a second pass bails',
  );
});

test('coi-bootstrap: second pass with marker set does NOT reload (loop guard)', async () => {
  const bundle = makeSandbox({
    isolated: false,
    controller: { scriptURL: 'https://link-foundation.github.io/rust-web-box/sw.js' },
    storedMarker: '1',
  });
  await runBootstrap(bundle);
  assert.equal(bundle.reloads.length, 0, 'marker must prevent a second reload');
  // And the user gets a structured warning so the failure is diagnosable.
  assert.equal(bundle.consoleCalls.warn.length, 1);
  assert.match(bundle.consoleCalls.warn[0][0], /cross-origin isolation could not be enabled/);
  assert.match(bundle.consoleCalls.warn[0][0], /controller-attached-but-not-isolated/);
});

test('coi-bootstrap: fresh load with no controller registers SW with relative URL', async () => {
  const registered = [];
  const bundle = makeSandbox({
    isolated: false,
    controller: null,
    serviceWorkerImpl: {
      register: async (url, opts) => {
        registered.push({ url, opts });
        return {
          installing: null,
          waiting: null,
          active: { state: 'activated', addEventListener: () => {} },
        };
      },
    },
  });
  await runBootstrap(bundle);
  assert.equal(registered.length, 1);
  assert.equal(
    registered[0].url,
    'https://link-foundation.github.io/rust-web-box/sw.js',
    'SW URL must resolve relative to the document so sub-paths work',
  );
  assert.equal(registered[0].opts.scope, './');
});
