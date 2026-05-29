import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createDiskChunkFetch,
  installDiskChunkFetch,
  isDiskChunkUrl,
  RETRY_STATUSES,
} from '../glue/disk-chunk-fetch.js';

function res(status, body = 'x') {
  return new Response(body, { status });
}

const immediate = (cb) => { cb(); return 0; };
const noJitter = () => 0;

test('isDiskChunkUrl: matches the .c{6-hex}.txt chunk pattern', () => {
  assert.equal(isDiskChunkUrl('./disk/rust-alpine.ext2.c0000d7.txt'), true);
  assert.equal(isDiskChunkUrl('https://example.test/p/img.ext2.cabcdef.txt'), true);
  assert.equal(isDiskChunkUrl('./disk/rust-alpine.ext2.c0000d7.txt?v=1'), true);
  assert.equal(isDiskChunkUrl('./disk/rust-alpine.ext2.c000.txt'), false); // too few hex
  assert.equal(isDiskChunkUrl('./disk/rust-alpine.ext2.cZZZZZZ.txt'), false); // not hex
  assert.equal(isDiskChunkUrl('./disk/manifest.json'), false);
  assert.equal(isDiskChunkUrl(''), false);
  assert.equal(isDiskChunkUrl(null), false);
});

test('isDiskChunkUrl: honours chunkBase prefix', () => {
  const base = 'https://link-foundation.github.io/rust-web-box/disk/';
  assert.equal(isDiskChunkUrl(`${base}rust-alpine.ext2.c0000d7.txt`, { chunkBase: base }), true);
  assert.equal(isDiskChunkUrl('https://elsewhere.test/disk/rust-alpine.ext2.c0000d7.txt', { chunkBase: base }), false);
});

test('createDiskChunkFetch: passes non-chunk URLs through untouched', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return res(200, 'manifest'); };
  const f = createDiskChunkFetch({ fetchImpl, setTimeoutImpl: immediate, random: noJitter });
  const out = await f('./disk/manifest.json');
  assert.equal(out.status, 200);
  assert.equal(calls, 1);
});

test('createDiskChunkFetch: returns the 200 directly', async () => {
  const fetchImpl = async () => res(200, 'chunk');
  const f = createDiskChunkFetch({ fetchImpl, setTimeoutImpl: immediate, random: noJitter });
  const out = await f('./disk/rust-alpine.ext2.c0000d7.txt');
  assert.equal(out.status, 200);
});

test('createDiskChunkFetch: retries on every retryable status, then succeeds', async () => {
  for (const status of RETRY_STATUSES) {
    let i = 0;
    const fetchImpl = async () => (i++ < 2 ? res(status) : res(200, 'ok'));
    const diag = { attempts: [] };
    const f = createDiskChunkFetch({
      fetchImpl, setTimeoutImpl: immediate, random: noJitter, diag, maxRetries: 4,
    });
    const out = await f('./disk/img.ext2.cabcdef.txt');
    assert.equal(out.status, 200, `status=${status}`);
    assert.equal(diag.attempts.filter((a) => a.retrying).length, 2);
    assert.equal(diag.attempts[diag.attempts.length - 1].ok, true);
  }
});

test('createDiskChunkFetch: retries on network TypeError, then succeeds', async () => {
  let i = 0;
  const fetchImpl = async () => {
    if (i++ < 1) throw new TypeError('Failed to fetch');
    return res(200);
  };
  const diag = { attempts: [] };
  const f = createDiskChunkFetch({
    fetchImpl, setTimeoutImpl: immediate, random: noJitter, diag,
  });
  const out = await f('./disk/img.ext2.cabcdef.txt');
  assert.equal(out.status, 200);
  assert.ok(diag.attempts.some((a) => a.retrying && /Failed to fetch/.test(a.error)));
});

test('createDiskChunkFetch: gives up after maxRetries and returns last 503', async () => {
  const fetchImpl = async () => res(503);
  let exhausted = null;
  const f = createDiskChunkFetch({
    fetchImpl, setTimeoutImpl: immediate, random: noJitter,
    maxRetries: 2,
    onPersistentFailure: (info) => { exhausted = info; },
  });
  const out = await f('./disk/img.ext2.cabcdef.txt');
  assert.equal(out.status, 503);
  assert.ok(exhausted);
  assert.equal(exhausted.status, 503);
  assert.equal(exhausted.attempts, 3); // 1 initial + 2 retries
});

test('createDiskChunkFetch: AbortError is not retried', async () => {
  const fetchImpl = async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  };
  const f = createDiskChunkFetch({ fetchImpl, setTimeoutImpl: immediate, random: noJitter });
  await assert.rejects(() => f('./disk/img.ext2.cabcdef.txt'), /aborted/);
});

test('createDiskChunkFetch: 404 is not retried', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return res(404); };
  const f = createDiskChunkFetch({ fetchImpl, setTimeoutImpl: immediate, random: noJitter });
  const out = await f('./disk/img.ext2.cabcdef.txt');
  assert.equal(out.status, 404);
  assert.equal(calls, 1);
});

test('installDiskChunkFetch: is idempotent on the same target', () => {
  const target = { fetch: async () => res(200) };
  const a = installDiskChunkFetch({ target, setTimeoutImpl: immediate, random: noJitter });
  const b = installDiskChunkFetch({ target, setTimeoutImpl: immediate, random: noJitter });
  assert.equal(target.__rustWebBoxDiskFetchInstalled, true);
  assert.equal(b.alreadyInstalled, true);
  a.restore();
  assert.equal(target.__rustWebBoxDiskFetchInstalled, undefined);
});
