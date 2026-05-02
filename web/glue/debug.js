// Opt-in verbose mode — turned on with `?debug=1` in the URL,
// `?debug=cheerpx,bus` to filter by namespace, or
// `localStorage.rustWebBoxDebug = '1'` for a sticky setting. The
// namespace grammar intentionally follows the npm `debug` package
// (`rust-web-box:*`, comma/space lists, and `-namespace` exclusions),
// while arguments may be functions and are evaluated lazily in the same
// spirit as `log-lazy`.
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
 * Returns either `null` (debug off), or an object:
 *   `{ all: true, skips: Set<RegExp> }`
 *   `{ namespaces: Set<string>, patterns: Set<RegExp>, skips: Set<RegExp> }`
 */
export function parseDebugSpec({ search = '', storage = null } = {}) {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  let raw = params.get('debug');
  if (raw == null && storage) {
    try {
      raw =
        storage.getItem?.('rustWebBoxDebug') ??
        storage.getItem?.('debug') ??
        storage.getItem?.('DEBUG') ??
        null;
    } catch { /* private mode */ }
  }
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === '' || trimmed === '0' || trimmed === 'false' || trimmed === 'off') return null;
  const tokens = trimmed.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return null;

  const spec = { namespaces: new Set(), patterns: new Set(), skips: new Set() };
  for (const token of tokens) {
    if (token === '1' || token === 'true' || token === 'on' || token === 'all') {
      spec.all = true;
      continue;
    }
    let name = token;
    let excluded = false;
    if (name.startsWith('-')) {
      excluded = true;
      name = name.slice(1);
    }
    name = normalizeNamespace(name);
    if (!name) continue;
    if (name === '*') {
      spec.all = true;
      continue;
    }
    if (excluded) {
      spec.skips.add(namespacePattern(name));
    } else if (name.includes('*')) {
      spec.patterns.add(namespacePattern(name));
    } else {
      spec.namespaces.add(name);
    }
  }
  if (!spec.all && spec.namespaces.size === 0 && spec.patterns.size === 0) return null;
  return spec.all && spec.skips.size === 0 ? { all: true } : spec;
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
  const fullNamespace = normalizeNamespace(namespace);
  const enabled = !!spec && namespaceEnabled(fullNamespace, spec);
  if (!enabled) {
    const noop = () => {};
    noop.enabled = false;
    return noop;
  }
  const shortNamespace = fullNamespace.startsWith('rust-web-box:')
    ? fullNamespace.slice('rust-web-box:'.length)
    : fullNamespace;
  const log = (...args) => sink(`${NAMESPACE_PREFIX}[${shortNamespace}]`, ...resolveLazy(args));
  log.enabled = true;
  return log;
}

function normalizeNamespace(namespace) {
  const s = String(namespace ?? '').trim();
  if (s === '') return '';
  if (s === '*') return '*';
  return s.includes(':') ? s : `rust-web-box:${s}`;
}

function namespacePattern(namespace) {
  const escaped = namespace.replace(/[|\\{}()[\]^$+?.]/g, '\\$&').replace(/\*/g, '.*?');
  return new RegExp(`^${escaped}$`);
}

function namespaceEnabled(namespace, spec) {
  for (const pattern of spec.skips ?? []) {
    if (pattern.test(namespace)) return false;
  }
  if (spec.all) return true;
  if (spec.namespaces?.has(namespace)) return true;
  for (const pattern of spec.patterns ?? []) {
    if (pattern.test(namespace)) return true;
  }
  return false;
}

function resolveLazy(args) {
  return args.map((arg) => (typeof arg === 'function' ? arg() : arg));
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
