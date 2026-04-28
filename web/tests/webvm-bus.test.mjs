import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createBusClient,
  createBusServer,
  BusError,
} from '../glue/webvm-bus.js';

// A pair of in-memory channels that mimic a BroadcastChannel link.
// `clientChannel.postMessage(x)` delivers to `serverChannel`'s listeners
// asynchronously (matching real BroadcastChannel semantics), and vice-
// versa. EventTarget gives us addEventListener/dispatchEvent for free.
function makeChannelPair() {
  const a = new EventTarget();
  const b = new EventTarget();
  a.postMessage = (data) => {
    queueMicrotask(() => {
      b.dispatchEvent(new MessageEvent('message', { data }));
    });
  };
  b.postMessage = (data) => {
    queueMicrotask(() => {
      a.dispatchEvent(new MessageEvent('message', { data }));
    });
  };
  return [a, b];
}

test('bus: client request / server response round-trip', async () => {
  const [c, s] = makeChannelPair();
  createBusServer({
    channel: s,
    methods: {
      'fs.stat': async ({ path }) => ({ path, type: 1, size: 12 }),
    },
  });
  const client = createBusClient({ channel: c });
  const result = await client.request('fs.stat', { path: '/etc/hosts' });
  assert.deepEqual(result, { path: '/etc/hosts', type: 1, size: 12 });
});

test('bus: unknown method returns NO_METHOD error', async () => {
  const [c, s] = makeChannelPair();
  createBusServer({ channel: s, methods: {} });
  const client = createBusClient({ channel: c });

  await assert.rejects(
    () => client.request('mystery'),
    (err) => err instanceof BusError && err.code === 'NO_METHOD',
  );
});

test('bus: handler errors propagate to client', async () => {
  const [c, s] = makeChannelPair();
  createBusServer({
    channel: s,
    methods: {
      'fs.readFile': async () => {
        const e = new Error('ENOENT');
        e.code = 'ENOENT';
        throw e;
      },
    },
  });
  const client = createBusClient({ channel: c });

  await assert.rejects(
    () => client.request('fs.readFile', { path: '/missing' }),
    (err) => err instanceof BusError && err.message === 'ENOENT' && err.code === 'ENOENT',
  );
});

test('bus: events broadcast to subscribers', async () => {
  const [c, s] = makeChannelPair();
  const server = createBusServer({ channel: s, methods: {} });
  const client = createBusClient({ channel: c });

  const seen = [];
  client.on('proc.stdout', (p) => seen.push(p));

  server.emit('proc.stdout', { pid: 7, chunk: 'hello' });
  server.emit('proc.stdout', { pid: 7, chunk: 'world' });
  server.emit('proc.exit', { pid: 7, exitCode: 0 });

  // Allow the queueMicrotask delivery to run.
  await new Promise((r) => setTimeout(r, 5));

  assert.deepEqual(seen, [
    { pid: 7, chunk: 'hello' },
    { pid: 7, chunk: 'world' },
  ]);
});

test('bus: request times out when server never responds', async () => {
  const [c, s] = makeChannelPair();
  createBusServer({ channel: s, methods: { sink: async () => new Promise(() => {}) } });
  const client = createBusClient({ channel: c, timeoutMs: 25 });

  await assert.rejects(
    () => client.request('sink'),
    (err) => err instanceof BusError && err.code === 'TIMEOUT',
  );
});

test('bus: parallel requests do not interfere', async () => {
  const [c, s] = makeChannelPair();
  createBusServer({
    channel: s,
    methods: {
      echo: async ({ value, delay = 0 }) => {
        await new Promise((r) => setTimeout(r, delay));
        return value;
      },
    },
  });
  const client = createBusClient({ channel: c });

  const results = await Promise.all([
    client.request('echo', { value: 'a', delay: 20 }),
    client.request('echo', { value: 'b', delay: 5 }),
    client.request('echo', { value: 'c' }),
  ]);
  assert.deepEqual(results, ['a', 'b', 'c']);
});

test('bus: client throws on missing channel', () => {
  assert.throws(
    () => createBusClient({}),
    /requires a channel/,
  );
});

test('bus: server throws on missing channel', () => {
  assert.throws(
    () => createBusServer({}),
    /requires a channel/,
  );
});
