// Boot orchestrator for rust-web-box.
//
// The page is intentionally minimal: a single VS Code Web workbench
// fills the viewport, exactly like vscode.dev. CheerpX boots in the
// background; loading status surfaces inside the VS Code terminal
// pane (rendered by the webvm-host extension), not as a custom HTML
// overlay. A tiny corner toast appears only if booting actually fails.
//
// Steps, in order:
//   1. Self-check the network shim (routes static/proxy/blocked correctly).
//   2. Register the COOP/COEP service worker so SharedArrayBuffer is
//      available for CheerpX threading.
//   3. Patch the workbench config so VS Code Web finds our extensions
//      against the current origin.
//   4. Load CheerpX (vendored, falling back to CDN).
//   5. Boot the Linux VM (Alpine + Rust + IDB overlay).
//   6. Open the WebVM ↔ extension bus.

import { createNetworkShim, classifyHost } from './network-shim.js';
import { loadCheerpX, bootLinux } from './cheerpx-bridge.js';
import { startWebVMServer } from './webvm-server.js';
import { openBroadcastChannel } from './webvm-bus.js';

const shim = createNetworkShim();
globalThis.__rustWebBox = globalThis.__rustWebBox || {};
globalThis.__rustWebBox.shim = shim;
globalThis.__rustWebBox.classifyHost = classifyHost;

const toast = document.getElementById('boot-toast');
const toastText = toast?.querySelector('[data-toast-text]');

function setToast(text, kind = 'info') {
  if (!toast || !toastText) return;
  toastText.textContent = text;
  toast.dataset.kind = kind;
  toast.hidden = false;
}

function hideToast() {
  if (!toast) return;
  toast.hidden = true;
}

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
    if (!(direct === 'direct' && proxy === 'proxy' && blocked === 'blocked')) {
      console.warn('[rust-web-box] network-shim routing self-check failed');
    }
  } catch (err) {
    console.warn('[rust-web-box] network-shim self-check threw:', err);
  }
})();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    /* SW registration is best-effort */
  });
}

async function bringUpVM() {
  let CheerpX;
  try {
    CheerpX = await loadCheerpX();
  } catch (err) {
    setToast(`CheerpX failed to load: ${err?.message ?? err}`, 'error');
    return null;
  }

  let vm;
  try {
    vm = await bootLinux({
      CheerpX,
      onProgress: (phase) => {
        // Surface VM boot phases on window for tests/devtools, but don't
        // render a UI overlay — the terminal pane handles user-visible
        // status.
        globalThis.__rustWebBox.vmPhase = phase;
      },
    });
  } catch (err) {
    setToast(`Linux VM failed to boot: ${err?.message ?? err}`, 'error');
    return null;
  }

  let channel;
  try {
    channel = openBroadcastChannel();
  } catch (err) {
    setToast(`Bus init failed: ${err?.message ?? err}`, 'error');
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

// Watch for the workbench mounting; when it does, hide the toast (which
// was only visible on errors).
function watchVSCode() {
  if (window.__vscodeMissing) {
    setToast(
      'VS Code Web bundle not vendored — run `node web/build/build-workbench.mjs`.',
      'error',
    );
    return;
  }
  const obs = new MutationObserver(() => {
    if (document.querySelector('.monaco-workbench')) {
      hideToast();
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

watchVSCode();
bringUpVM();
