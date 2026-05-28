// Retrying fetch wrapper for warm-disk chunks.
//
// CheerpX's GitHubDevice streams the ext2 image as same-origin
// `.c{hex6}.txt` chunks of 128 KB each. Browsers issue a plain
// `fetch()` per chunk. When the page is hosted on GitHub Pages a
// single transient 5xx ("Backend is unhealthy") permanently poisons
// that block: CheerpX's JIT then compiles the zero-padded payload
// into invalid WebAssembly and the worker rejects with
// `CompileError: expected 1 elements on the stack for fallthru`.
//
// This module wraps `globalThis.fetch` so that any request whose URL
// matches the warm-disk chunk pattern is retried on
//   * `5xx` (server error),
//   * `408` (request timeout),
//   * `429` (rate limited),
//   * `TypeError` (network drop / CORS error masquerading as one).
// Other status codes are passed through unchanged — a `404` still
// means "missing chunk", which the caller already handles.
//
// Issue #35 case study at docs/case-studies/issue-35/README.md
// covers the failure chain and rationale.

export const RETRY_STATUSES = Object.freeze([408, 429, 500, 502, 503, 504]);
export const DEFAULT_MAX_RETRIES = 4;
export const DEFAULT_BASE_DELAY_MS = 250;
export const DEFAULT_MAX_DELAY_MS = 6000;

const CHUNK_PATH_RE = /\.c[0-9a-f]{6}\.txt(?:\?|$|#)/i;

export function isDiskChunkUrl(url, { chunkBase = null } = {}) {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (chunkBase && !url.startsWith(chunkBase)) return false;
  return CHUNK_PATH_RE.test(url);
}

function defaultDelay(attempt, { baseDelayMs, maxDelayMs, random }) {
  // Full jitter — see https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const rand = typeof random === 'function' ? random() : Math.random();
  return Math.floor(rand * exp);
}

function shouldRetryResponse(res) {
  return res && RETRY_STATUSES.includes(res.status);
}

function shouldRetryError(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return false;
  // `TypeError` is the standard "network failure" surface from fetch.
  return err.name === 'TypeError' || /network|fetch/i.test(err.message || '');
}

export function createDiskChunkFetch({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  maxRetries = DEFAULT_MAX_RETRIES,
  baseDelayMs = DEFAULT_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  setTimeoutImpl = (cb, ms) => setTimeout(cb, ms),
  random = Math.random,
  logger = null,
  diag = null,
  chunkBase = null,
  match = null,
  onPersistentFailure = null,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createDiskChunkFetch requires a fetch implementation');
  }
  const matcher = typeof match === 'function'
    ? match
    : (url) => isDiskChunkUrl(url, { chunkBase });

  async function sleep(ms) {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeoutImpl(resolve, ms));
  }

  function record(entry) {
    if (diag && Array.isArray(diag.attempts)) {
      diag.attempts.push(entry);
      // Cap the diagnostic ring so a long-running boot doesn't bloat
      // memory; the last ~50 attempts are by far the most useful.
      if (diag.attempts.length > 50) diag.attempts.shift();
    }
    if (logger?.debug) {
      try { logger.debug('[disk-chunk-fetch]', entry); } catch {}
    }
  }

  return async function diskChunkFetch(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    if (!matcher(url)) {
      return fetchImpl(input, init);
    }
    let lastError = null;
    let lastResponse = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await fetchImpl(input, init);
        if (!shouldRetryResponse(res) || attempt === maxRetries) {
          record({ url, attempt, status: res?.status ?? null, ok: res?.ok ?? false });
          if (shouldRetryResponse(res) && attempt === maxRetries && onPersistentFailure) {
            try { onPersistentFailure({ url, status: res.status, attempts: attempt + 1 }); } catch {}
          }
          return res;
        }
        lastResponse = res;
        record({ url, attempt, status: res.status, ok: false, retrying: true });
      } catch (err) {
        lastError = err;
        if (!shouldRetryError(err) || attempt === maxRetries) {
          record({ url, attempt, error: String(err?.message ?? err), ok: false });
          if (onPersistentFailure) {
            try { onPersistentFailure({ url, error: err, attempts: attempt + 1 }); } catch {}
          }
          throw err;
        }
        record({ url, attempt, error: String(err?.message ?? err), ok: false, retrying: true });
      }
      await sleep(defaultDelay(attempt, { baseDelayMs, maxDelayMs, random }));
    }
    // Loop only exits via the `return res` branch or the `throw`
    // branch above. This is reachable only if maxRetries < 0.
    if (lastError) throw lastError;
    return lastResponse;
  };
}

/**
 * Install the retrying fetch on a target object (defaults to
 * `globalThis`). Returns a `restore()` that undoes the wrap.
 *
 * The wrap is idempotent: if a prior install marker is found on the
 * target, we return a no-op restore. This makes it safe for the boot
 * sequence and the e2e harness to both call it.
 */
export function installDiskChunkFetch({
  target = globalThis,
  ...opts
} = {}) {
  const original = target.fetch;
  if (!original) return { restore: () => {} };
  if (target.__rustWebBoxDiskFetchInstalled) return { restore: () => {}, alreadyInstalled: true };
  const fetchImpl = original.bind(target);
  const wrapped = createDiskChunkFetch({ ...opts, fetchImpl });
  target.fetch = wrapped;
  target.__rustWebBoxDiskFetchInstalled = true;
  return {
    restore() {
      if (target.fetch === wrapped) {
        target.fetch = original;
        delete target.__rustWebBoxDiskFetchInstalled;
      }
    },
  };
}
