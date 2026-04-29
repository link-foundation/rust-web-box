// End-to-end test for "cargo install serde": exercises the full
// network-shim sequence cargo would issue when adding a popular crate,
// using the production routing rules (no test overrides). This is the
// R7 acceptance test from issue #3.
//
// Why this matters: cargo's failure mode for a half-broken proxy is
// silent corruption of the sparse index, which then surfaces hours
// later as "cannot find crate <foo>" or a checksum mismatch. The
// happy-path tests in network-shim.test.mjs verify each routing rule
// in isolation — this test verifies that the rules compose correctly
// for the realistic sequence of HTTP calls cargo makes for a popular
// dependency.
//
// Sequence under test (real shape from `CARGO_LOG=trace cargo add serde`):
//   1. GET https://index.crates.io/config.json           (sparse-index bootstrap)
//   2. GET https://index.crates.io/se/rd/serde           (crate metadata line-delimited JSON)
//   3. GET https://crates.io/api/v1/crates/serde         (web API for version list)
//   4. GET https://static.crates.io/crates/serde/serde-1.0.219.crate  (tarball)
//
// (1) and (2) hit the proxy chain (index.crates.io has no CORS).
// (3) and (4) go direct (CORS-open hosts).
//
// We don't simulate cargo itself — too heavy for unit tests, and the
// CheerpX VM boot is too slow for CI — but we DO exercise every routing
// decision that determines whether `cargo install` will succeed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALLOWED_DIRECT_HOSTS,
  PROXY_ONLY_HOSTS,
  classifyHost,
  createNetworkShim,
  NetworkBlockedError,
} from '../glue/network-shim.js';

// A popular, real crate. Choosing serde because:
//   * It is in the top-3 most-downloaded crates of all time.
//   * Its name (no underscores, no rename) is the simplest sparse-index
//     path: /se/rd/serde — matches the production layout.
//   * If this works, every more complex crate (with-_, with-/, etc) works.
const CRATE = 'serde';
// Realistic-looking 1.0.x version; the exact number doesn't matter, the
// URL shape does.
const CRATE_VERSION = '1.0.219';

function ok(body, contentType = 'application/octet-stream') {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

// Synthesise a plausible sparse-index reply: one JSON line per published
// version. cargo parses these line-by-line.
function fakeSparseIndex(crate, versions) {
  return versions
    .map((v) => JSON.stringify({
      name: crate,
      vers: v,
      // cksum is required by cargo; any 64-hex string works for routing.
      cksum: '0'.repeat(64),
      deps: [],
      yanked: false,
      features: {},
    }))
    .join('\n');
}

test('cargo-install: full request sequence for `cargo install serde` routes correctly', async () => {
  const seen = [];
  // Mock cargo's actual sequence of HTTP calls. Each handler returns
  // the same shape the real upstream would return — proxies pass these
  // through unchanged.
  const fetchImpl = async (url) => {
    seen.push(url);
    // Sparse index calls are wrapped by a proxy; the underlying URL is
    // embedded in the proxy URL. Match on substring.
    if (url.includes('index.crates.io%2Fconfig.json') ||
        url.endsWith('index.crates.io/config.json')) {
      return ok(JSON.stringify({ dl: 'https://static.crates.io/crates' }), 'application/json');
    }
    if (url.includes(`index.crates.io%2Fse%2Frd%2F${CRATE}`) ||
        url.endsWith(`index.crates.io/se/rd/${CRATE}`)) {
      return ok(fakeSparseIndex(CRATE, ['1.0.0', '1.0.100', CRATE_VERSION]),
        'application/json');
    }
    if (url === `https://crates.io/api/v1/crates/${CRATE}`) {
      return ok(JSON.stringify({
        crate: { id: CRATE, max_stable_version: CRATE_VERSION },
      }), 'application/json');
    }
    if (url === `https://static.crates.io/crates/${CRATE}/${CRATE}-${CRATE_VERSION}.crate`) {
      // Real .crate files are gzipped tarballs, but the bytes are
      // opaque to the network shim — any payload exercises the routing.
      return ok(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]).buffer);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const { vmFetch } = createNetworkShim({ fetchImpl });

  // 1. Sparse-index bootstrap: must use a proxy.
  const config = await vmFetch('https://index.crates.io/config.json');
  assert.equal(config.status, 200);
  const cfg = JSON.parse(await config.text());
  assert.equal(cfg.dl, 'https://static.crates.io/crates');

  // 2. Sparse-index lookup for the crate: must use a proxy.
  const idx = await vmFetch(`https://index.crates.io/se/rd/${CRATE}`);
  assert.equal(idx.status, 200);
  const lines = (await idx.text()).split('\n').filter(Boolean);
  assert.equal(lines.length, 3, 'sparse index must return one JSON line per version');
  const latest = JSON.parse(lines[lines.length - 1]);
  assert.equal(latest.vers, CRATE_VERSION);

  // 3. Web API lookup: direct (CORS-open).
  const api = await vmFetch(`https://crates.io/api/v1/crates/${CRATE}`);
  assert.equal(api.status, 200);
  assert.equal(JSON.parse(await api.text()).crate.id, CRATE);

  // 4. Crate tarball: direct (static.crates.io is CORS-open).
  const tar = await vmFetch(
    `https://static.crates.io/crates/${CRATE}/${CRATE}-${CRATE_VERSION}.crate`,
  );
  assert.equal(tar.status, 200);
  const bytes = new Uint8Array(await tar.arrayBuffer());
  // Quick sanity check: gzip magic.
  assert.equal(bytes[0], 0x1f);
  assert.equal(bytes[1], 0x8b);

  // Routing assertions: which hops actually went through which path?
  // The proxy chain prepends `https://cors.eu.org/` (the first proxy in
  // DEFAULT_PROXIES) to the underlying URL. Direct calls do not.
  const proxied = seen.filter((u) => /cors\.eu\.org|codetabs|allorigins/.test(u));
  const direct = seen.filter((u) => !/cors\.eu\.org|codetabs|allorigins/.test(u));

  assert.equal(proxied.length, 2, 'index.crates.io requests must go through the proxy chain');
  assert.equal(direct.length, 2, 'crates.io API + static.crates.io must go direct');
  assert.ok(direct.some((u) => u.startsWith('https://crates.io/api/')));
  assert.ok(direct.some((u) => u.startsWith('https://static.crates.io/')));
});

test('cargo-install: sparse-index host classification matches production rules', () => {
  // Pin the assumption: if someone adds a host to ALLOWED_DIRECT_HOSTS
  // by mistake, this test breaks loudly. Sparse-index latency relies on
  // this routing being correct.
  assert.equal(classifyHost('index.crates.io'), 'proxy');
  assert.equal(classifyHost('static.crates.io'), 'direct');
  assert.equal(classifyHost('crates.io'), 'direct');
  assert.ok(PROXY_ONLY_HOSTS.includes('index.crates.io'));
  assert.ok(ALLOWED_DIRECT_HOSTS.includes('static.crates.io'));
  assert.ok(ALLOWED_DIRECT_HOSTS.includes('crates.io'));
});

test('cargo-install: docs.rs and crates.io mirrors are blocked (defence in depth)', async () => {
  // If a maintainer adds docs.rs (or a CDN mirror) to the allowlist,
  // they must also verify the CORS posture. Until they do, requests
  // must hard-fail rather than silently work.
  const fetchImpl = async () => { throw new Error('should not be called'); };
  const { vmFetch } = createNetworkShim({ fetchImpl });

  for (const url of [
    'https://docs.rs/serde/latest/serde/',
    'https://crates.io.cdn-mirror.example/api/v1/crates/serde',
    'https://attacker.example/crates/serde/serde-1.0.0.crate',
  ]) {
    await assert.rejects(
      () => vmFetch(url),
      (err) => err instanceof NetworkBlockedError,
      `expected ${url} to be blocked`,
    );
  }
});

test('cargo-install: tarball download survives transient proxy failure on an index call', async () => {
  // Realistic failure mode: cors.eu.org rate-limits us mid-install.
  // The shim must fall through to the next proxy without failing the
  // overall install. (This is the property that turns "cargo install
  // succeeded sometimes" into "cargo install always succeeds".)
  let corsCalls = 0;
  const fetchImpl = async (url) => {
    if (url.includes('cors.eu.org')) {
      corsCalls += 1;
      return new Response('rate limited', { status: 429 });
    }
    if (url.includes('codetabs.com')) {
      // codetabs is the second proxy; serve the index from here.
      return ok(fakeSparseIndex(CRATE, [CRATE_VERSION]), 'application/json');
    }
    if (url === `https://static.crates.io/crates/${CRATE}/${CRATE}-${CRATE_VERSION}.crate`) {
      return ok(new Uint8Array([0x1f, 0x8b]).buffer);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const { vmFetch } = createNetworkShim({ fetchImpl });

  const idx = await vmFetch(`https://index.crates.io/se/rd/${CRATE}`);
  assert.equal(idx.status, 200, 'fallback proxy must serve the index');
  assert.equal(corsCalls, 1, 'first proxy must be tried exactly once before fallback');

  const tar = await vmFetch(
    `https://static.crates.io/crates/${CRATE}/${CRATE}-${CRATE_VERSION}.crate`,
  );
  assert.equal(tar.status, 200, 'direct tarball download must still work after proxy fallback');
});
