import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_DIRECT_HOSTS,
  PROXY_ONLY_HOSTS,
  classifyHost,
  createNetworkShim,
  NetworkBlockedError,
  ProxyChainError,
} from '../glue/network-shim.js';

function ok(body = 'ok', init = {}) {
  return new Response(body, { status: 200, ...init });
}

function fail(status = 500) {
  return new Response('x', { status });
}

test('classifyHost: known direct hosts route direct', () => {
  for (const host of ALLOWED_DIRECT_HOSTS) {
    assert.equal(classifyHost(host), 'direct');
  }
});

test('classifyHost: known proxy-only hosts route via proxy', () => {
  for (const host of PROXY_ONLY_HOSTS) {
    assert.equal(classifyHost(host), 'proxy');
  }
});

test('classifyHost: unknown hosts are blocked', () => {
  assert.equal(classifyHost('example.com'), 'blocked');
  assert.equal(classifyHost('crates.io.attacker.example'), 'blocked');
});

test('vmFetch: routes static.crates.io directly', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return ok('crate bytes');
  };
  const { vmFetch } = createNetworkShim({ fetchImpl });

  const url = 'https://static.crates.io/crates/serde/serde-1.0.200.crate';
  const res = await vmFetch(url);

  assert.equal(res.status, 200);
  assert.deepEqual(calls, [url]);
});

test('vmFetch: routes crates.io api directly', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return ok('{"crate":{}}');
  };
  const { vmFetch } = createNetworkShim({ fetchImpl });

  const url = 'https://crates.io/api/v1/crates/serde';
  const res = await vmFetch(url);

  assert.equal(res.status, 200);
  assert.deepEqual(calls, [url]);
});

test('vmFetch: rejects non-allowlisted hosts with NetworkBlockedError', async () => {
  const fetchImpl = async () => {
    throw new Error('should not be called');
  };
  const { vmFetch } = createNetworkShim({ fetchImpl });

  await assert.rejects(
    () => vmFetch('https://example.com/'),
    (err) => err instanceof NetworkBlockedError && err.host === 'example.com',
  );
});

test('vmFetch: index.crates.io tries proxies in order until one succeeds', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('cors.eu.org')) return fail(503);
    if (url.includes('codetabs.com')) return ok('sparse-index-payload');
    throw new Error('should not reach allorigins');
  };
  const proxies = [
    { id: 'cors.eu.org', build: (u) => `https://cors.eu.org/${u}` },
    {
      id: 'api.codetabs.com',
      build: (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
    },
    {
      id: 'api.allorigins.win',
      build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
    },
  ];
  const { vmFetch } = createNetworkShim({ fetchImpl, proxies });

  const res = await vmFetch('https://index.crates.io/se/rd/serde');

  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'sparse-index-payload');
  assert.equal(calls.length, 2, 'second proxy should short-circuit the chain');
  assert.match(calls[0], /cors\.eu\.org/);
  assert.match(calls[1], /codetabs\.com/);
});

test('vmFetch: ProxyChainError when every proxy fails', async () => {
  const fetchImpl = async () => fail(502);
  const proxies = [
    { id: 'p1', build: (u) => `https://p1.example/${u}` },
    { id: 'p2', build: (u) => `https://p2.example/${u}` },
  ];
  const { vmFetch } = createNetworkShim({ fetchImpl, proxies });

  await assert.rejects(
    () => vmFetch('https://index.crates.io/se/rd/serde'),
    (err) =>
      err instanceof ProxyChainError &&
      err.attempts.length === 2 &&
      err.attempts.every((a) => a.status === 502),
  );
});

test('vmFetch: ProxyChainError captures thrown errors per proxy', async () => {
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };
  const proxies = [
    { id: 'p1', build: (u) => `https://p1.example/${u}` },
    { id: 'p2', build: (u) => `https://p2.example/${u}` },
  ];
  const { vmFetch } = createNetworkShim({ fetchImpl, proxies });

  await assert.rejects(
    () => vmFetch('https://index.crates.io/an/yh/anyhow'),
    (err) => {
      assert.ok(err instanceof ProxyChainError);
      assert.equal(err.attempts.length, 2);
      for (const attempt of err.attempts) {
        assert.match(attempt.error, /Failed to fetch/);
      }
      return true;
    },
  );
});

test('createNetworkShim: requires a fetch implementation', () => {
  assert.throws(
    () => createNetworkShim({ fetchImpl: null }),
    /requires a fetch implementation/,
  );
});

test('vmFetch: forwards init across direct and proxy paths', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return ok();
  };
  const proxies = [{ id: 'p1', build: (u) => `https://p1.example/${u}` }];
  const { vmFetch } = createNetworkShim({ fetchImpl, proxies });

  await vmFetch('https://static.crates.io/x', {
    method: 'GET',
    headers: { 'X-Trace': '1' },
  });
  await vmFetch('https://index.crates.io/y', {
    method: 'GET',
    headers: { 'X-Trace': '2' },
  });

  assert.equal(seen.length, 2);
  assert.equal(seen[0].init.headers['X-Trace'], '1');
  assert.equal(seen[1].init.headers['X-Trace'], '2');
});
