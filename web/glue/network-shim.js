// Network shim that mediates traffic from inside the WebVM (CheerpX) to the
// open web. The browser cannot open raw TCP, so cargo's network calls are
// intercepted and re-issued from the page using `fetch`.
//
// Routing rules, derived from CORS-headers verified against the live origins:
//   * static.crates.io  -> direct fetch (CORS-open, serves crate tarballs)
//   * crates.io/api     -> direct fetch (CORS-open, serves the JSON API)
//   * index.crates.io   -> sequential CORS-proxy fallback
//                          (the sparse index does not send CORS headers)
//   * everything else   -> blocked, surfaces as a network error to cargo
//
// The proxy list is ordered by measured latency. Hosts that have failed in
// the past (paywalled, gated, or shut down) are not included here even when
// they accept connections, because cargo's failure mode for a half-broken
// proxy is silent corruption of the sparse index.

export const ALLOWED_DIRECT_HOSTS = Object.freeze([
  'static.crates.io',
  'crates.io',
]);

export const PROXY_ONLY_HOSTS = Object.freeze([
  'index.crates.io',
]);

export const DEFAULT_PROXIES = Object.freeze([
  {
    id: 'cors.eu.org',
    build: (u) => `https://cors.eu.org/${u}`,
  },
  {
    id: 'api.codetabs.com',
    build: (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  },
  {
    id: 'api.allorigins.win',
    build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
  },
]);

export const DEFAULT_PROXY_TIMEOUT_MS = 8000;

export class NetworkBlockedError extends Error {
  constructor(host) {
    super(`network blocked: ${host}`);
    this.name = 'NetworkBlockedError';
    this.host = host;
  }
}

export class ProxyChainError extends Error {
  constructor(url, attempts) {
    super(`all proxies failed for ${url}`);
    this.name = 'ProxyChainError';
    this.url = url;
    this.attempts = attempts;
  }
}

export function classifyHost(host, {
  allowedDirect = ALLOWED_DIRECT_HOSTS,
  proxyOnly = PROXY_ONLY_HOSTS,
} = {}) {
  if (allowedDirect.includes(host)) return 'direct';
  if (proxyOnly.includes(host)) return 'proxy';
  return 'blocked';
}

export function createNetworkShim({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  proxies = DEFAULT_PROXIES,
  timeoutMs = DEFAULT_PROXY_TIMEOUT_MS,
  allowedDirect = ALLOWED_DIRECT_HOSTS,
  proxyOnly = PROXY_ONLY_HOSTS,
  AbortControllerImpl = globalThis.AbortController,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createNetworkShim requires a fetch implementation');
  }

  async function corsFetch(url, init = {}) {
    const attempts = [];
    for (const proxy of proxies) {
      const ctrl = AbortControllerImpl ? new AbortControllerImpl() : null;
      const timer = ctrl
        ? setTimeout(() => ctrl.abort(), timeoutMs)
        : null;
      try {
        const response = await fetchImpl(proxy.build(url), {
          ...init,
          signal: ctrl?.signal ?? init.signal,
        });
        if (response && response.ok) {
          return response;
        }
        attempts.push({ proxy: proxy.id, status: response?.status ?? null });
      } catch (err) {
        attempts.push({ proxy: proxy.id, error: String(err) });
      } finally {
        if (timer !== null) clearTimeout(timer);
      }
    }
    throw new ProxyChainError(url, attempts);
  }

  async function vmFetch(url, init = {}) {
    const parsed = new URL(url);
    const route = classifyHost(parsed.host, { allowedDirect, proxyOnly });
    if (route === 'direct') {
      return fetchImpl(url, init);
    }
    if (route === 'proxy') {
      return corsFetch(url, init);
    }
    throw new NetworkBlockedError(parsed.host);
  }

  return { vmFetch, corsFetch };
}
