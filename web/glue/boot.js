// Boot orchestrator for rust-web-box.
//
// Steps, in order:
//   1. Self-check the network shim (routes static/proxy/blocked correctly).
//   2. Register the COOP/COEP service worker so SharedArrayBuffer is
//      available for CheerpX threading.
//   3. Load CheerpX (vendored, falling back to CDN).
//   4. Boot the Linux VM (Debian + IDB overlay).
//   5. Open the WebVM ↔ extension bus.
//   6. Wait for VS Code Web's workbench to mount; once it does, hide the
//      boot overlay.
//
// Each step updates its `<strong data-status="...">` indicator so the
// visible boot screen reflects progress. If a step fails the overlay
// stays visible and surfaces the error.

import { createNetworkShim, classifyHost } from './network-shim.js';
import { loadCheerpX, bootLinux } from './cheerpx-bridge.js';
import { startWebVMServer } from './webvm-server.js';
import { openBroadcastChannel } from './webvm-bus.js';

const indicators = {
  shim: document.querySelector('strong[data-status="shim"]'),
  cheerpx: document.querySelector('strong[data-status="cheerpx"]'),
  vm: document.querySelector('strong[data-status="vm"]'),
  vscode: document.querySelector('strong[data-status="vscode"]'),
};

function setStatus(name, text, state = '') {
  const el = indicators[name];
  if (!el) return;
  el.textContent = text;
  if (state) el.dataset.state = state;
  else delete el.dataset.state;
}

const shim = createNetworkShim();
globalThis.__rustWebBox = globalThis.__rustWebBox || {};
globalThis.__rustWebBox.shim = shim;
globalThis.__rustWebBox.classifyHost = classifyHost;

// Substitute {ORIGIN_SCHEME}/{ORIGIN_HOST} placeholders in the workbench
// configuration so VS Code Web resolves our extensions against the
// current origin. The build step writes URI components into the meta
// tag using literal placeholders so the rendered HTML is portable.
(function patchWorkbenchConfig() {
  const meta = document.getElementById('vscode-workbench-web-configuration');
  if (!meta) return;
  const raw = meta.getAttribute('data-settings');
  if (!raw || raw === '"not-built"') return;
  try {
    const cfg = JSON.parse(raw);
    if (Array.isArray(cfg.additionalBuiltinExtensions)) {
      const scheme = location.protocol.replace(':', '');
      const host = location.host;
      for (const ext of cfg.additionalBuiltinExtensions) {
        if (typeof ext !== 'object') continue;
        if (ext.scheme === '{ORIGIN_SCHEME}') ext.scheme = scheme;
        if (ext.authority === '{ORIGIN_HOST}') ext.authority = host;
      }
    }
    meta.setAttribute('data-settings', JSON.stringify(cfg));
  } catch (err) {
    console.warn('[rust-web-box] could not patch workbench config:', err);
  }
})();

(function selfCheckShim() {
  try {
    const direct = classifyHost('static.crates.io');
    const proxy = classifyHost('index.crates.io');
    const blocked = classifyHost('example.com');
    if (direct === 'direct' && proxy === 'proxy' && blocked === 'blocked') {
      setStatus('shim', 'routing rules ok', 'ok');
    } else {
      setStatus('shim', 'routing mismatch', 'fail');
    }
  } catch (err) {
    setStatus('shim', `error: ${err.message}`, 'fail');
  }
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* SW registration is best-effort; failure shouldn't break the page */
  });
}

async function bringUpVM() {
  setStatus('cheerpx', 'loading', '');
  let CheerpX;
  try {
    CheerpX = await loadCheerpX();
  } catch (err) {
    setStatus('cheerpx', `failed: ${err?.message ?? err}`, 'fail');
    return null;
  }
  setStatus('cheerpx', 'loaded', 'ok');

  setStatus('vm', 'booting', '');
  let vm;
  try {
    vm = await bootLinux({
      CheerpX,
      onProgress: (phase) => setStatus('vm', phase),
    });
  } catch (err) {
    setStatus('vm', `boot failed: ${err?.message ?? err}`, 'fail');
    return null;
  }
  setStatus('vm', 'ready', 'ok');

  let channel;
  try {
    channel = openBroadcastChannel();
  } catch (err) {
    setStatus('vm', `bus error: ${err?.message ?? err}`, 'fail');
    return null;
  }

  startWebVMServer({
    cx: vm.cx,
    channel,
    status: { diskUrl: vm.diskUrl, persistKey: vm.persistKey },
  });

  globalThis.__rustWebBox.vm = vm;
  globalThis.__rustWebBox.busChannel = channel;
  return vm;
}

// VS Code Web mounts into <body>; if the bundle is missing this never
// happens. Watch for either the workbench shell or a short timeout.
function watchVSCode() {
  setStatus('vscode', 'mounting', '');
  if (window.__vscodeMissing) {
    setStatus('vscode', 'bundle not vendored', 'fail');
    return;
  }
  const start = performance.now();
  const obs = new MutationObserver(() => {
    if (document.querySelector('.monaco-workbench')) {
      setStatus('vscode', 'ready', 'ok');
      // Keep the overlay around for ~250ms so the transition reads.
      setTimeout(() => {
        const overlay = document.getElementById('boot-overlay');
        if (overlay) overlay.classList.add('hidden');
      }, 250);
      obs.disconnect();
    } else if (performance.now() - start > 30000) {
      setStatus('vscode', 'timed out', 'fail');
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

// Kick everything off.
(async () => {
  watchVSCode();
  await bringUpVM();
})();
