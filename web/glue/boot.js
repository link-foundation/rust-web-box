// Boot orchestrator for rust-web-box.
//
// The page is intentionally minimal: a single VS Code Web workbench
// fills the viewport, exactly like vscode.dev. CheerpX boots in the
// background; loading status surfaces inside the VS Code terminal
// pane (rendered by the webvm-host extension), not as a custom HTML
// overlay. A tiny corner toast appears only if booting actually fails.
//
// Boot order (each step decoupled from the next so VS Code can show a
// populated workspace immediately, even while CheerpX is still
// downloading):
//
//   1. Self-check the network shim (routes static/proxy/blocked correctly).
//   2. Register the COOP/COEP service worker so SharedArrayBuffer is
//      available for CheerpX threading.
//   3. Patch the workbench config so VS Code Web finds our extensions.
//   4. Open the JS-side workspace (IDB-backed) and start serving its
//      contents over the bus IMMEDIATELY. The Explorer populates from
//      this — the user sees `hello_world.rs` the moment the page loads.
//   5. (Background) Load CheerpX, boot Linux, then upgrade the bus to
//      the full server with terminal support. The workspace is mirrored
//      into the VM at this point so `cargo run` works.

import { createNetworkShim, classifyHost } from './network-shim.js';
import { loadCheerpX, bootLinux } from './cheerpx-bridge.js';
import { startWebVMServer } from './webvm-server.js';
import { workspaceOnlyMethods } from './workspace-server.js';
import { createBusServer, openBroadcastChannel } from './webvm-bus.js';
import { openWorkspaceFS } from './workspace-fs.js';

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

async function bringUpWorkspace() {
  let workspace;
  try {
    workspace = await openWorkspaceFS();
  } catch (err) {
    setToast(`Workspace store unavailable: ${err?.message ?? err}`, 'error');
    throw err;
  }

  let channel;
  try {
    channel = openBroadcastChannel();
  } catch (err) {
    setToast(`Bus init failed: ${err?.message ?? err}`, 'error');
    throw err;
  }

  // Stage 1 method table: serves fs.* immediately so the Explorer
  // populates without waiting on CheerpX.
  const busServer = createBusServer({
    channel,
    methods: workspaceOnlyMethods({ workspace }),
  });
  // Tell any extensions that started up first that the bus is alive.
  busServer.emit('vm.boot', { phase: 'workspace-ready' });

  globalThis.__rustWebBox.busChannel = channel;
  globalThis.__rustWebBox.workspace = workspace;
  globalThis.__rustWebBox.busServer = busServer;
  return { workspace, channel, busServer };
}

async function bringUpVM({ workspace, channel, busServer }) {
  busServer.emit('vm.boot', { phase: 'loading-cheerpx' });
  let CheerpX;
  try {
    CheerpX = await loadCheerpX();
  } catch (err) {
    setToast(`CheerpX failed to load: ${err?.message ?? err}`, 'error');
    return null;
  }

  busServer.emit('vm.boot', { phase: 'booting-linux' });
  let vm;
  try {
    vm = await bootLinux({
      CheerpX,
      onProgress: (phase) => {
        globalThis.__rustWebBox.vmPhase = phase;
        try { busServer.emit('vm.boot', { phase }); } catch {}
      },
    });
  } catch (err) {
    setToast(`Linux VM failed to boot: ${err?.message ?? err}`, 'error');
    return null;
  }

  // Stage 2: hot-swap to the full server (workspace + terminal).
  startWebVMServer({
    cx: vm.cx,
    busServer,
    workspace,
    status: { diskUrl: vm.diskUrl, persistKey: vm.persistKey },
  });

  globalThis.__rustWebBox.vm = vm;
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

(async () => {
  try {
    const ws = await bringUpWorkspace();
    // Bring up the VM in the background; the workspace is already
    // serving fs.* requests so VS Code's Explorer populates on its own
    // schedule.
    bringUpVM(ws);
  } catch (err) {
    // bringUpWorkspace already surfaces a toast; nothing more to do.
    // eslint-disable-next-line no-console
    console.warn('[rust-web-box] boot failed:', err);
  }
})();
