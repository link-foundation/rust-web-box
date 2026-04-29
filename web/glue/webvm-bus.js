// WebVM ↔ VS Code Web extension message bus.
//
// VS Code Web runs each web extension inside a dedicated Web Worker (the
// extension host). That worker has no DOM, no `SharedArrayBuffer` access
// to CheerpX, and cannot hold the VM directly. The page (workbench
// document) holds CheerpX. Messages flow:
//
//   extension worker  <—— MessagePort ——>  page bridge  <——>  CheerpX
//
// We use BroadcastChannel as the transport so the worker doesn't need
// MessagePort handoff coordination (BC is supported in dedicated workers
// of same-origin pages).
//
// Protocol (request/response, both directions):
//   { id, kind: 'request', method, params }
//   { id, kind: 'response', result?, error? }
//   { kind: 'event', topic, payload }
//
// `method`s implemented by the page-side server are:
//   `fs.readFile(path) -> Uint8Array`
//   `fs.writeFile(path, data) -> void`
//   `fs.stat(path) -> { type, size, mtime }`
//   `fs.readDir(path) -> Array<[name, type]>`
//   `fs.delete(path, opts?) -> void`
//   `fs.rename(from, to, opts?) -> void`
//   `fs.createDirectory(path) -> void`
//   `proc.spawn({argv, cwd, env}) -> { pid }`
//   `proc.write(pid, bytes) -> void`
//   `proc.resize(pid, cols, rows) -> void`
//   `proc.kill(pid, signal?) -> void`
//   `proc.wait(pid) -> { exitCode }`
//   `vm.status() -> { booted, diskUrl, persistKey }`
//
// `event`s emitted by the server:
//   `proc.stdout` { pid, chunk }
//   `proc.exit`   { pid, exitCode }
//   `vm.boot`     { phase }

export const CHANNEL_NAME = 'rust-web-box/webvm-bus';

export class BusError extends Error {
  constructor(message, code = 'BUS_ERROR') {
    super(message);
    this.name = 'BusError';
    this.code = code;
  }
}

/**
 * Tiny request/response client. Fully transport-agnostic: takes anything
 * with a `postMessage(msg)` and an `addEventListener('message', cb)` pair.
 * The same client is used from both ends of the bus.
 */
export function createBusClient({
  channel,
  timeoutMs = 30000,
  now = () => Date.now(),
} = {}) {
  if (!channel) throw new TypeError('createBusClient requires a channel');

  let nextId = 1;
  const pending = new Map();
  const eventListeners = new Map();

  channel.addEventListener('message', (ev) => {
    const msg = ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'response') {
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(new BusError(msg.error.message, msg.error.code));
      } else {
        entry.resolve(msg.result);
      }
    } else if (msg.kind === 'event') {
      const ls = eventListeners.get(msg.topic);
      if (ls) for (const fn of ls) fn(msg.payload);
    }
  });

  function request(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new BusError(`request timed out: ${method}`, 'TIMEOUT'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, started: now() });
      channel.postMessage({ id, kind: 'request', method, params });
    });
  }

  function on(topic, fn) {
    let ls = eventListeners.get(topic);
    if (!ls) {
      ls = new Set();
      eventListeners.set(topic, ls);
    }
    ls.add(fn);
    return () => ls.delete(fn);
  }

  function emit(topic, payload) {
    channel.postMessage({ kind: 'event', topic, payload });
  }

  return { request, on, emit };
}

/**
 * Server-side handler. `methods` is an object mapping method name -> async
 * handler (params) -> result. Errors are caught and forwarded as
 * structured error responses so the client can surface them.
 *
 * Returns an object with:
 *   * `emit(topic, payload)`: broadcast an event.
 *   * `setMethods(next)`: hot-swap the method table. Used to upgrade
 *     from a workspace-only stage to a full VM-backed server when
 *     CheerpX finishes booting, without re-registering an extra
 *     message listener (which would double-respond to every request).
 *   * `dispose()`: detach the listener; subsequent messages are ignored.
 */
export function createBusServer({ channel, methods = {} } = {}) {
  if (!channel) throw new TypeError('createBusServer requires a channel');

  let active = true;
  let table = methods;

  const onMessage = async (ev) => {
    const msg = ev.data;
    if (!active) return;
    if (!msg || msg.kind !== 'request') return;
    const handler = table[msg.method];
    if (!handler) {
      channel.postMessage({
        id: msg.id,
        kind: 'response',
        error: { message: `unknown method: ${msg.method}`, code: 'NO_METHOD' },
      });
      return;
    }
    try {
      const result = await handler(msg.params ?? {});
      channel.postMessage({ id: msg.id, kind: 'response', result });
    } catch (err) {
      channel.postMessage({
        id: msg.id,
        kind: 'response',
        error: {
          message: err?.message ?? String(err),
          code: err?.code ?? 'HANDLER_ERROR',
        },
      });
    }
  };
  channel.addEventListener('message', onMessage);

  function emit(topic, payload) {
    channel.postMessage({ kind: 'event', topic, payload });
  }

  function setMethods(next) {
    table = next ?? {};
  }

  function dispose() {
    active = false;
    try { channel.removeEventListener('message', onMessage); } catch {}
  }

  return { emit, setMethods, dispose };
}

/**
 * Open a same-origin BroadcastChannel as the default transport.
 * Provided as a thin helper so tests can swap it.
 */
export function openBroadcastChannel(name = CHANNEL_NAME) {
  if (typeof BroadcastChannel !== 'function') {
    throw new BusError(
      'BroadcastChannel is not available in this environment',
      'NO_BROADCAST_CHANNEL',
    );
  }
  return new BroadcastChannel(name);
}
