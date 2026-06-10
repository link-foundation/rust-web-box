// Issue #39: the page renders NO custom error UI. Every user-facing
// error / warning / info is funnelled through the notification center,
// which broadcasts each record over the WebVM bus as a `vm.notify`
// event for the webvm-host extension to surface via VS Code's native
// notification API.
//
// These tests pin the center's contract: severity validation, the
// monotonic id, the bounded buffer, and — crucially — the buffer/replay
// behaviour that keeps early-boot notifications from being lost when the
// extension host subscribes late.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createNotificationCenter,
  NOTIFY_TOPIC,
  NOTIFY_SYNC_TOPIC,
} from '../glue/notifications.js';

// A minimal in-memory bus that records emitted events and lets a test
// fire `vm.notify.sync` the way the extension would.
function makeFakeBus() {
  const emitted = [];
  const listeners = new Map();
  return {
    emitted,
    emit(topic, payload) {
      emitted.push({ topic, payload });
    },
    on(topic, fn) {
      let ls = listeners.get(topic);
      if (!ls) {
        ls = new Set();
        listeners.set(topic, ls);
      }
      ls.add(fn);
      return () => ls.delete(fn);
    },
    // test helper: simulate a peer firing an event
    fire(topic, payload) {
      const ls = listeners.get(topic);
      if (ls) for (const fn of [...ls]) fn(payload);
    },
    notifyEvents() {
      return emitted.filter((e) => e.topic === NOTIFY_TOPIC);
    },
  };
}

test('notifications: assigns monotonic ids and defaults severity to error', () => {
  const c = createNotificationCenter();
  const a = c.notify({ message: 'first' });
  const b = c.notify({ severity: 'warning', message: 'second' });
  assert.equal(a.id, 1);
  assert.equal(a.severity, 'error'); // default
  assert.equal(b.id, 2);
  assert.equal(b.severity, 'warning');
});

test('notifications: rejects unknown severity and coerces blank message', () => {
  const c = createNotificationCenter();
  const r = c.notify({ severity: 'bogus', message: '   ' });
  assert.equal(r.severity, 'error');
  assert.equal(r.message, 'Unknown error');
});

test('notifications: info and warning severities are preserved', () => {
  const c = createNotificationCenter();
  assert.equal(c.notify({ severity: 'info', message: 'x' }).severity, 'info');
  assert.equal(
    c.notify({ severity: 'warning', message: 'y' }).severity,
    'warning',
  );
});

test('notifications: emits live records on the vm.notify topic once attached', () => {
  const c = createNotificationCenter();
  const bus = makeFakeBus();
  c.attach(bus);
  c.notify({ severity: 'error', message: 'live' });
  const notifies = bus.notifyEvents();
  assert.equal(notifies.length, 1);
  assert.equal(notifies[0].topic, NOTIFY_TOPIC);
  assert.equal(notifies[0].payload.message, 'live');
});

test('notifications: buffers records produced before attach and replays on attach', () => {
  const c = createNotificationCenter();
  // Produced BEFORE any bus exists (early boot disk/CheerpX failure).
  c.notify({ severity: 'error', message: 'early-1' });
  c.notify({ severity: 'warning', message: 'early-2' });
  assert.equal(c.size, 2);

  const bus = makeFakeBus();
  c.attach(bus); // replays the buffered pair
  const msgs = bus.notifyEvents().map((e) => e.payload.message);
  assert.deepEqual(msgs, ['early-1', 'early-2']);
});

test('notifications: replays the buffer when a peer emits vm.notify.sync', () => {
  const c = createNotificationCenter();
  const bus = makeFakeBus();
  c.attach(bus);
  c.notify({ severity: 'error', message: 'one' });
  // The freshly-activated extension asks for a replay.
  bus.fire(NOTIFY_SYNC_TOPIC, {});
  const ones = bus
    .notifyEvents()
    .filter((e) => e.payload.message === 'one');
  // Delivered live once + replayed once = two emissions (extension dedupes by id).
  assert.equal(ones.length, 2);
  assert.equal(ones[0].payload.id, ones[1].payload.id);
});

test('notifications: replayed records keep a stable id so the extension can dedupe', () => {
  const c = createNotificationCenter();
  const bus = makeFakeBus();
  const rec = c.notify({ severity: 'error', message: 'dup' });
  c.attach(bus); // replay
  bus.fire(NOTIFY_SYNC_TOPIC, {}); // replay again
  const ids = new Set(bus.notifyEvents().map((e) => e.payload.id));
  assert.deepEqual([...ids], [rec.id]);
});

test('notifications: bounded buffer drops the oldest beyond maxBuffer', () => {
  const c = createNotificationCenter({ maxBuffer: 3 });
  for (let i = 1; i <= 5; i++) c.notify({ message: `m${i}` });
  assert.equal(c.size, 3);
  const kept = c.list().map((r) => r.message);
  assert.deepEqual(kept, ['m3', 'm4', 'm5']);
});

test('notifications: a throwing bus transport never breaks the caller', () => {
  const c = createNotificationCenter();
  c.attach({
    emit() {
      throw new Error('dead channel');
    },
  });
  // Must not throw despite the dead transport.
  const r = c.notify({ message: 'still recorded' });
  assert.equal(r.message, 'still recorded');
  assert.equal(c.size, 1);
});

test('notifications: attaching a new bus detaches the prior sync handler', () => {
  const c = createNotificationCenter();
  const busA = makeFakeBus();
  c.attach(busA);
  c.notify({ message: 'a' });
  const busB = makeFakeBus();
  c.attach(busB); // should re-subscribe sync on B, drop A's

  const before = busA.notifyEvents().length;
  busA.fire(NOTIFY_SYNC_TOPIC, {}); // A's handler must be gone now
  assert.equal(busA.notifyEvents().length, before, 'old bus sync must be detached');

  busB.fire(NOTIFY_SYNC_TOPIC, {}); // B drives the replay
  assert.ok(busB.notifyEvents().length >= 1, 'new bus replays the buffer');
});
