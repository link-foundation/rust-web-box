// Boot diagnostics: categorise the error shapes we see when CheerpX
// fails to bring up the Linux VM, and convert them into structured
// toast content.
//
// The categories model the three Brave-on-rust-web-box failure modes
// captured in docs/case-studies/issue-35/README.md:
//
//   * `disk-503` — warm-disk chunk fetch returned a 5xx after the
//     retry budget was exhausted. The page literally cannot read
//     the disk; the most useful actions are retry and check Pages
//     status.
//   * `wasm-compile` — CheerpX's worker threw `WebAssembly.CompileError`.
//     Most likely caused by a poisoned chunk (see `disk-503`), but
//     can also be the upstream Brave/V8 issue #36187.
//   * `worker-missing-export` — `TypeError: e is not a function`
//     downstream of a CheerpX worker that never finished
//     initialising. Treated as a sibling of `wasm-compile`.
//   * `network-blocked` — a fetch was blocked outright (CSP, CORS,
//     extension, network filter). Returned as a generic last-resort
//     category.
//   * `unknown` — fallback.
//
// The renderer side returns plain strings; no DOM. The boot module
// owns the toast DOM.

const COMPILE_ERROR_NAMES = new Set(['CompileError', 'WebAssembly.CompileError']);
const WASM_ERROR_MESSAGE_RE = /WebAssembly\.(Module|Instance|compile|instantiate)|\bwasm-function\b|elements on the stack for fallthru/i;
const E_NOT_FUNCTION_RE = /\b[a-zA-Z_$][\w$]*\s+is not a function\b/;

export function categorizeBootError(input) {
  const err = input?.error || input?.reason || input;
  const message = String(err?.message ?? err ?? '');
  const name = String(err?.name ?? '');
  const stack = String(err?.stack ?? '');
  const filename = String(input?.filename ?? '');

  if (
    typeof input?.url === 'string' &&
    typeof input?.status === 'number' &&
    input.status >= 500
  ) {
    return {
      kind: 'disk-503',
      title: 'Warm disk temporarily unavailable',
      body: `GitHub Pages returned HTTP ${input.status} for a disk chunk after retrying.`,
    };
  }

  if (
    COMPILE_ERROR_NAMES.has(name) ||
    WASM_ERROR_MESSAGE_RE.test(message) ||
    WASM_ERROR_MESSAGE_RE.test(stack)
  ) {
    return {
      kind: 'wasm-compile',
      title: 'WebAssembly failed to compile',
      body: 'CheerpX could not validate a generated module — likely a corrupted disk read or a disabled V8 JIT for this site.',
    };
  }

  if (
    E_NOT_FUNCTION_RE.test(message) &&
    (/blob:/.test(filename) || /MessagePort|Worker/.test(stack))
  ) {
    return {
      kind: 'worker-missing-export',
      title: 'CheerpX worker did not finish loading',
      body: 'A WebAssembly module did not export an expected symbol — usually a downstream symptom of a WASM compile failure earlier in the boot.',
    };
  }

  if (/blocked|CSP|CORS|network/i.test(message) || /TypeError: Failed to fetch/i.test(message)) {
    return {
      kind: 'network-blocked',
      title: 'A required resource could not be fetched',
      body: message || 'A network request was blocked before it reached its origin.',
    };
  }

  return {
    kind: 'unknown',
    title: 'Linux VM failed to boot',
    body: message || String(err) || 'Unknown error',
  };
}

/**
 * Convert a categorised error + browser identity into the toast
 * text the user sees. Returns `{ text, hint, kind }`.
 */
export function renderBootError(category, browser = { id: 'unknown', isBrave: false }) {
  const { kind, title, body } = category;
  const hints = [];
  if (browser?.isBrave) {
    if (kind === 'wasm-compile' || kind === 'worker-missing-export') {
      hints.push(
        'Brave detected. If the page keeps failing, ensure the V8 optimizer is enabled for this site at brave://settings/content/v8 (upstream brave-browser#36187).',
      );
      hints.push(
        'You can also try lowering Brave Shields to "Standard" for this site.',
      );
    }
    if (kind === 'disk-503') {
      hints.push(
        'GitHub Pages is intermittently unhealthy. Brave usually surfaces this faster than Chrome — reload in a minute.',
      );
    }
  }
  if (kind === 'disk-503' && !browser?.isBrave) {
    hints.push('GitHub Pages backend is intermittently unhealthy — reload in a minute.');
  }
  if (kind === 'wasm-compile' && !browser?.isBrave) {
    hints.push('Try a hard reload (Shift-Reload). If it persists, file an issue with the console output.');
  }
  return {
    kind,
    text: title + (body ? `: ${body}` : ''),
    hint: hints.join(' '),
  };
}

/**
 * Install global `unhandledrejection` + `error` listeners that
 * route CheerpX-shaped failures into `target.__rustWebBox.diagnostics`.
 * Returns a `restore()` for tests.
 */
export function installBootDiagnostics({
  target = globalThis,
  rootName = '__rustWebBox',
} = {}) {
  if (!target.addEventListener) return { restore: () => {} };
  const root = target[rootName] = target[rootName] || {};
  const diag = root.diagnostics = root.diagnostics || { events: [] };

  function record(category, raw) {
    diag.events.push({
      kind: category.kind,
      title: category.title,
      body: category.body,
      raw: typeof raw === 'string' ? raw : raw?.message ?? String(raw),
    });
    if (diag.events.length > 50) diag.events.shift();
  }

  const onRejection = (event) => {
    const cat = categorizeBootError({ reason: event.reason });
    if (cat.kind === 'unknown') return;
    record(cat, event.reason);
  };
  const onError = (event) => {
    const cat = categorizeBootError({
      error: event.error,
      message: event.message,
      filename: event.filename,
    });
    if (cat.kind === 'unknown') return;
    record(cat, event.error || event.message);
  };

  target.addEventListener('unhandledrejection', onRejection, true);
  target.addEventListener('error', onError, true);

  return {
    diag,
    restore() {
      target.removeEventListener('unhandledrejection', onRejection, true);
      target.removeEventListener('error', onError, true);
    },
  };
}
