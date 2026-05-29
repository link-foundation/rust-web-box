import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectBrowser } from '../glue/browser-info.js';

test('detectBrowser: returns unknown when navigator is absent', async () => {
  const b = await detectBrowser({ nav: null });
  assert.equal(b.id, 'unknown');
  assert.equal(b.isBrave, false);
});

test('detectBrowser: recognises Brave via navigator.brave.isBrave()', async () => {
  const nav = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit Chrome/126',
    brave: { isBrave: async () => true },
  };
  const b = await detectBrowser({ nav });
  assert.equal(b.id, 'brave');
  assert.equal(b.isBrave, true);
  assert.equal(b.isChromium, true);
});

test('detectBrowser: recognises Brave via legacy UA token', async () => {
  const nav = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit Brave/1.50 Chrome/126',
  };
  const b = await detectBrowser({ nav });
  assert.equal(b.id, 'brave');
  assert.equal(b.isBrave, true);
});

test('detectBrowser: Chromium UA is reported as chromium, not Brave', async () => {
  const nav = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit Chrome/126 Safari/537.36',
  };
  const b = await detectBrowser({ nav });
  assert.equal(b.id, 'chromium');
  assert.equal(b.isBrave, false);
  assert.equal(b.isChromium, true);
});

test('detectBrowser: nav.brave.isBrave throwing is swallowed', async () => {
  const nav = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/126',
    brave: { isBrave: () => { throw new Error('boom'); } },
  };
  const b = await detectBrowser({ nav });
  assert.equal(b.isBrave, false);
});

test('detectBrowser: Firefox UA reports other / not-chromium', async () => {
  const nav = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
  };
  const b = await detectBrowser({ nav });
  assert.equal(b.id, 'other');
  assert.equal(b.isChromium, false);
});
