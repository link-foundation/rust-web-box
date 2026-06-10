// Uniform notification center for rust-web-box (issue #39).
//
// The page intentionally renders **no** custom HTML error UI — no corner
// toast, no banner, no invented widget of any kind. Every user-facing
// error / warning / info is funnelled through this one center, which
// broadcasts it over the WebVM bus as a `vm.notify` event. The
// `webvm-host` VS Code extension subscribes and surfaces each record
// through VS Code's **native** notification API
// (`window.showErrorMessage` / `showWarningMessage` /
// `showInformationMessage`) — the same surface vscode.dev uses — so the
// app never invents its own UI element for errors and warnings.
//
// Why a buffer + replay: notifications can be produced very early in
// boot (a disk-chunk 503, a CheerpX load failure), *before* the
// extension host has activated and subscribed to the bus. A plain
// fire-and-forget event would be lost. So we keep a bounded buffer and
// replay it (a) whenever a bus transport is attached, and (b) on demand
// when a freshly-activated client emits `vm.notify.sync`. The extension
// dedupes by the monotonic `id`, so a record delivered both live and via
// replay is shown exactly once.

export const NOTIFY_TOPIC = 'vm.notify';
export const NOTIFY_SYNC_TOPIC = 'vm.notify.sync';

const VALID_SEVERITIES = new Set(['error', 'warning', 'info']);

/**
 * Create a notification center.
 *
 * @param {object}  [options]
 * @param {number}  [options.maxBuffer=50] cap on retained records.
 * @returns {{
 *   notify: (input: {severity?: string, message: string, detail?: string, source?: string}) => object,
 *   attach: (bus: {emit: Function, on?: Function} | null) => void,
 *   replayAll: () => void,
 *   list: () => object[],
 *   readonly size: number,
 * }}
 */
export function createNotificationCenter({ maxBuffer = 50 } = {}) {
  const buffer = [];
  let nextId = 1;
  let bus = null;
  let detachSync = null;

  function emit(record) {
    try {
      bus?.emit?.(NOTIFY_TOPIC, record);
    } catch {
      // A dead bus transport must never break the caller that is merely
      // trying to report an error.
    }
  }

  function replayAll() {
    for (const record of buffer) emit(record);
  }

  /**
   * Record and broadcast a notification. Returns the stored record so
   * callers/tests can inspect the assigned id.
   */
  function notify(input) {
    const severity = VALID_SEVERITIES.has(input?.severity)
      ? input.severity
      : 'error';
    const message = String(input?.message ?? '').trim() || 'Unknown error';
    const detail = input?.detail ? String(input.detail).trim() : '';
    const source = input?.source ? String(input.source) : '';
    const record = { id: nextId++, severity, message, detail, source };
    buffer.push(record);
    if (buffer.length > maxBuffer) buffer.shift();
    emit(record);
    return record;
  }

  /**
   * Attach (or replace) the bus transport. Wires the `vm.notify.sync`
   * replay handler and flushes anything buffered before the bus existed.
   * Pass `null` to detach.
   */
  function attach(nextBus) {
    try {
      detachSync?.();
    } catch {
      /* ignore */
    }
    detachSync = null;
    bus = nextBus ?? null;
    if (bus?.on) {
      detachSync = bus.on(NOTIFY_SYNC_TOPIC, () => replayAll());
    }
    replayAll();
  }

  return {
    notify,
    attach,
    replayAll,
    list: () => buffer.slice(),
    get size() {
      return buffer.length;
    },
  };
}
