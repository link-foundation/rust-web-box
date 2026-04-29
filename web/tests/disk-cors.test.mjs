// Regression tests for issue #3 — root cause #2: CORS-aware disk URL probe.
//
// Bug shape: the previous probe used `mode: 'no-cors'` and treated an
// opaque response as success. That told us "the URL is fetchable" but
// NOT "the URL is JS-readable", so we happily handed CORS-blocked URLs
// to CheerpX's CloudDevice.create(), which uses XHR (no `no-cors` mode)
// and fails. The visible symptom was: the warm Alpine+Rust disk seemed
// fine to our probe but never actually mounted, so `cargo` and `rustc`
// were missing from the user's terminal.
//
// Fix: probe with `mode: 'cors'` (the default) and return a structured
// `{ ok, reason }` result so callers can log a useful diagnostic.
//
// See docs/case-studies/issue-3/analysis-disk-cors.md for the full
// analysis (with curl evidence and console logs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { probeUrl, resolveDiskUrl } from '../glue/cheerpx-bridge.js';

function captureLogger() {
  const calls = { warn: [], info: [] };
  return {
    logger: {
      warn: (...args) => calls.warn.push(args),
      info: (...args) => calls.info.push(args),
    },
    calls,
  };
}

test('probeUrl: returns ok=true when fetch yields a basic/cors readable response', async () => {
  // GitHub Releases redirect target for an asset that DOES advertise
  // CORS would yield a `cors`-type response — this is the happy path.
  const fetchImpl = async (url, opts) => {
    assert.equal(opts.mode, 'cors', 'must request cors mode (no opaque/no-cors)');
    assert.equal(opts.headers.Range, 'bytes=0-0', 'must use a 1-byte range probe');
    return { ok: true, status: 206, type: 'cors', headers: new Map() };
  };
  const result = await probeUrl('https://example.com/disk.ext2', fetchImpl);
  assert.deepEqual(result, { ok: true, reason: 'reachable' });
});

test('probeUrl: returns ok=false reason=cors-or-network when fetch throws TypeError', async () => {
  // Browsers throw a TypeError ("Failed to fetch") when CORS blocks the
  // response. Same outcome XHR would produce.
  const fetchImpl = async () => {
    const err = new TypeError('Failed to fetch');
    throw err;
  };
  const result = await probeUrl('https://github.com/x/y/releases/download/foo/disk.ext2', fetchImpl);
  assert.deepEqual(result, { ok: false, reason: 'cors-or-network' });
});

test('probeUrl: returns ok=false reason=not-found when server replies 404', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, type: 'cors', headers: new Map() });
  const result = await probeUrl('https://example.com/missing.ext2', fetchImpl);
  assert.deepEqual(result, { ok: false, reason: 'not-found' });
});

test('probeUrl: returns ok=false reason=opaque if response is opaque (no-cors slipped through)', async () => {
  // Defensive: if anything ever forces the request into no-cors mode,
  // the opaque body is unreadable by XHR — treat it as unusable.
  const fetchImpl = async () => ({ ok: false, status: 0, type: 'opaque', headers: new Map() });
  const result = await probeUrl('https://example.com/disk.ext2', fetchImpl);
  assert.deepEqual(result, { ok: false, reason: 'opaque' });
});

test('probeUrl: returns ok=false reason=invalid-input for missing url or fetchImpl', async () => {
  assert.deepEqual(await probeUrl(null, () => {}), { ok: false, reason: 'invalid-input' });
  assert.deepEqual(await probeUrl('https://x', null), { ok: false, reason: 'invalid-input' });
});

test('probeUrl: skips probe (returns ok=true) for non-HTTP(S) URLs like wss://', async () => {
  // CheerpX's `wss://disks.webvm.io/...` URLs cannot be probed with fetch.
  // Treat them as usable; the WebSocket layer will surface its own error.
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return { ok: true, status: 200, type: 'cors', headers: new Map() };
  };
  const result = await probeUrl('wss://disks.webvm.io/debian.ext2', fetchImpl);
  assert.deepEqual(result, { ok: true, reason: 'non-http' });
  assert.equal(called, false, 'wss:// URLs must not be sent through fetch');
});

test('probeUrl: returns ok=false reason=timeout when AbortController fires', async () => {
  const fetchImpl = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  const result = await probeUrl('https://example.com/slow.ext2', fetchImpl);
  assert.deepEqual(result, { ok: false, reason: 'timeout' });
});

test('resolveDiskUrl: surfaces a structured CORS warning when warm probe is CORS-blocked', async () => {
  const { logger, calls } = captureLogger();
  const url = await resolveDiskUrl({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          warm: { url: 'https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2' },
          default: { url: 'wss://disks.webvm.io/fallback.ext2' },
        };
      },
    }),
    probe: async () => ({ ok: false, reason: 'cors-or-network' }),
    logger,
  });
  assert.equal(url, 'wss://disks.webvm.io/fallback.ext2');
  // The warning must be a console.warn (not console.info) so it's visible
  // at default log levels — this is the diagnostic that saves a future
  // maintainer from silently shipping a broken warm disk.
  assert.equal(calls.warn.length, 1, 'must emit exactly one structured warning');
  const message = calls.warn[0][0];
  assert.match(message, /CORS-blocked/, 'warning must mention CORS');
  assert.match(message, /cors-or-network/, 'warning must include the structured reason');
  assert.match(message, /analysis-disk-cors\.md/, 'warning must point to the case study');
  assert.equal(calls.info.length, 0, 'should not double-log via info');
});

test('resolveDiskUrl: emits an info log (not a warning) when warm probe is missing (404)', async () => {
  const { logger, calls } = captureLogger();
  const url = await resolveDiskUrl({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          warm: { url: 'https://example.com/not-built-yet.ext2' },
          default: { url: 'wss://disks.webvm.io/fallback.ext2' },
        };
      },
    }),
    probe: async () => ({ ok: false, reason: 'not-found' }),
    logger,
  });
  assert.equal(url, 'wss://disks.webvm.io/fallback.ext2');
  // 404 is "asset not built yet" — expected on a fresh repo. Don't
  // alarm the user; an info log is enough.
  assert.equal(calls.warn.length, 0);
  assert.equal(calls.info.length, 1);
  assert.match(calls.info[0][0], /not-found/);
});

test('resolveDiskUrl: tolerates legacy probes that return a bare boolean', async () => {
  // Backward compat: existing tests (and any external callers) may pass
  // a probe that returns true/false. Don't crash; treat it as the
  // boolean it is.
  const { logger } = captureLogger();
  const url = await resolveDiskUrl({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          warm: { url: 'https://example.com/x.ext2' },
          default: { url: 'wss://disks.webvm.io/fallback.ext2' },
        };
      },
    }),
    probe: async () => true,
    logger,
  });
  assert.equal(url, 'https://example.com/x.ext2');
});

test('resolveDiskUrl: structured warning never references undefined when probe returns bare false', async () => {
  // Belt-and-braces: even with a legacy boolean probe, the fallback
  // logging path must not produce "reason: undefined" garbage in logs.
  const { logger, calls } = captureLogger();
  await resolveDiskUrl({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return {
          warm: { url: 'https://example.com/x.ext2' },
          default: { url: 'wss://disks.webvm.io/fallback.ext2' },
        };
      },
    }),
    probe: async () => false,
    logger,
  });
  // We don't care which log channel; we only care that nothing logs
  // "reason: undefined".
  const all = [...calls.warn, ...calls.info].map((args) => args.join(' '));
  for (const line of all) {
    assert.doesNotMatch(line, /reason: undefined/, `bad log line: ${line}`);
  }
});
