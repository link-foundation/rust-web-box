import { createNetworkShim, classifyHost } from './network-shim.js';

const shim = createNetworkShim();

// Expose for debugging from devtools.
globalThis.__rustWebBox = { shim, classifyHost };

const indicator = document.querySelector('strong[data-status="shim"]');

(async function selfCheck() {
  if (!indicator) return;
  try {
    // The static.crates.io origin is verified CORS-open; the index check is
    // a routing-only smoke test (we don't follow it, just confirm classify
    // logic agrees with the architecture).
    const direct = classifyHost('static.crates.io');
    const proxy = classifyHost('index.crates.io');
    const blocked = classifyHost('example.com');
    if (direct === 'direct' && proxy === 'proxy' && blocked === 'blocked') {
      indicator.textContent = 'routing rules ok';
      indicator.dataset.state = 'ok';
    } else {
      indicator.textContent = 'routing mismatch';
      indicator.dataset.state = 'fail';
    }
  } catch (err) {
    indicator.textContent = `error: ${err.message}`;
    indicator.dataset.state = 'fail';
  }
})();

if ('serviceWorker' in navigator) {
  // Registration is best-effort; failing to register the SW must not break
  // the page (e.g. on file:// or cross-origin previews).
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
