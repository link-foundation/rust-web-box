// Opt-in verbose mode — turned on with `?debug=1` in the URL,
// `?debug=cheerpx,bus` to filter by namespace, or
// `localStorage.rustWebBoxDebug = '1'` for a sticky setting.
//
// Why this exists (issue #3): when the page loaded an empty workbench
// on GitHub Pages, the only signal the maintainer had was a blank
// screen and three console errors. The root causes were buried in
// silently-swallowed paths (404 on extension manifest, no-cors probe
// hiding XHR-blocking CORS, etc.). Verbose mode logs every important
// decision point so the next regression can be diagnosed in seconds
// rather than hours.
//
// Design constraints:
//   * Zero overhead when disabled (the log function becomes a no-op).
//   * Namespaced — pick one subsystem at a time without log spam.
//   * No DOM or network coupling so it's safe to import from any glue
//     file (including pure-Node tests).

const NAMESPACE_PREFIX = '[rust-web-box]';

/**
 * Parse the debug spec from a search-string and a localStorage shim.
 * Exposed for tests; production callers use {@link createDebug}.
 *
 * Returns either `null` (debug off), or an object
 *   `{ all: true }`                       — all namespaces enabled
 *   `{ namespaces: Set<string> }`         — only these namespaces enabled
 */
export function parseDebugSpec({ search = '', storage = null } = {}) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  let raw = params.get('debug');
  if (raw == null && storage) {
    try { raw = storage.getItem?.('rustWebBoxDebug') ?? null; } catch { /* private mode */ }
  }
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '' || trimmed === '0' || trimmed === 'false' || trimmed === 'off') return null;
  if (trimmed === '1' || trimmed === 'true' || trimmed === 'on' || trimmed === '*' || trimmed === 'all') {
    return { all: true };
  }
  const namespaces = new Set(
    trimmed.split(',').map((s) => s.trim()).filter(Boolean),
  );
  if (namespaces.size === 0) return null;
  return { namespaces };
}

/**
 * Build a debug logger for a given namespace. The returned function is
 * a no-op when debug is disabled or the namespace is filtered out.
 *
 * @example
 *   const dbg = createDebug('cheerpx', { search: location.search, storage: localStorage });
 *   dbg('probe result', { url, ok, reason });
 */
export function createDebug(namespace, { search, storage, sink = console.log } = {}) {
  const spec = parseDebugSpec({ search, storage });
  const enabled = !!spec && (spec.all || spec.namespaces?.has(namespace));
  if (!enabled) {
    const noop = () => {};
    noop.enabled = false;
    return noop;
  }
  const log = (...args) => sink(`${NAMESPACE_PREFIX}[${namespace}]`, ...args);
  log.enabled = true;
  return log;
}

/**
 * Snapshot of the runtime state for diagnostics. Wired into
 * `globalThis.__rustWebBox.dump()` by boot.js so a maintainer can paste
 * the output into a bug report. Pure JSON — no functions or live refs.
 */
export function dumpRuntime(globalRef = globalThis) {
  const r = globalRef.__rustWebBox || {};
  const safe = (v) => {
    if (v == null) return v;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    return undefined; // drop live objects so JSON.stringify can't choke
  };
  return {
    timestamp: new Date().toISOString(),
    href: globalRef.location?.href ?? null,
    userAgent: globalRef.navigator?.userAgent ?? null,
    crossOriginIsolated: globalRef.crossOriginIsolated ?? null,
    sharedArrayBuffer: typeof globalRef.SharedArrayBuffer === 'function',
    serviceWorker: !!globalRef.navigator?.serviceWorker?.controller,
    vmPhase: safe(r.vmPhase),
    vmDiskUrl: safe(r.vm?.diskUrl),
    vmPersistKey: safe(r.vm?.persistKey),
    workspaceReady: !!r.workspace,
    busAlive: !!r.busServer,
    shimAlive: !!r.shim,
  };
}
