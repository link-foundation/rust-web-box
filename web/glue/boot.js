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
import { applyWorkbenchPlaceholders } from './workbench-config.js';
import { createDebug, dumpRuntime } from './debug.js';

const debugOpts = {
  search: location.search,
  storage: typeof localStorage !== 'undefined' ? localStorage : null,
};
const dbgBoot = createDebug('boot', debugOpts);
const dbgWorkbench = createDebug('workbench', debugOpts);

const shim = createNetworkShim();
globalThis.__rustWebBox = globalThis.__rustWebBox || {};
globalThis.__rustWebBox.shim = shim;
globalThis.__rustWebBox.classifyHost = classifyHost;
globalThis.__rustWebBox.dump = () => dumpRuntime(globalThis);

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

// Substitute {ORIGIN_SCHEME}/{ORIGIN_HOST}/{BASE_PATH} placeholders in
// the workbench configuration so VS Code Web resolves our extensions
// against the current origin AND the directory the page is served from.
// The build step writes URI components into the meta tag using literal
// placeholders so the rendered HTML is portable.
//
// Why {BASE_PATH} matters: under GitHub Pages our document is at
// `/rust-web-box/`, but `additionalBuiltinExtensions[].path` is a
// host-absolute URL path. Without prefixing the deploy base, the
// browser asks for `https://host/extensions/...` and 404s silently —
// the workbench then has no FileSystemProvider for `webvm:`, no
// terminal profile, and the user sees an empty Welcome page (issue #3).
//
// This runs as a defensive backstop for the inline copy in
// index.html — both copies must agree, otherwise the inline copy wins
// (it executes before this module loads).
(function patchWorkbenchConfig() {
  const meta = document.getElementById('vscode-workbench-web-configuration');
  if (!meta) return;
  const raw = meta.getAttribute('data-settings');
  if (!raw || raw === '"not-built"') return;
  try {
    const cfg = JSON.parse(raw);
    const ctx = {
      scheme: location.protocol.replace(':', ''),
      host: location.host,
      basePath: new URL('./', location.href).pathname.replace(/\/$/, ''),
    };
    dbgWorkbench('substituting placeholders with', ctx);
    applyWorkbenchPlaceholders(cfg, ctx);
    dbgWorkbench('extensions resolved to', cfg.additionalBuiltinExtensions);
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

// Service worker registration is owned by `./coi-bootstrap.js`, which
// runs as a classic <script> in <head> before this module loads. It
// registers `./sw.js`, then forces a one-shot reload if the page is
// not yet `crossOriginIsolated` so the next navigation receives the
// SW-synthesized COOP/COEP headers. Issue #7 root-cause fix.

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
  dbgBoot('loading CheerpX');
  let CheerpX;
  try {
    CheerpX = await loadCheerpX();
  } catch (err) {
    setToast(`CheerpX failed to load: ${err?.message ?? err}`, 'error');
    return null;
  }

  busServer.emit('vm.boot', { phase: 'booting-linux' });
  dbgBoot('CheerpX loaded; booting Linux');
  let vm;
  try {
    vm = await bootLinux({
      CheerpX,
      onProgress: (phase) => {
        globalThis.__rustWebBox.vmPhase = phase;
        dbgBoot('vm phase', phase);
        try { busServer.emit('vm.boot', { phase }); } catch {}
      },
    });
  } catch (err) {
    setToast(`Linux VM failed to boot: ${err?.message ?? err}`, 'error');
    return null;
  }
  dbgBoot('VM booted with disk', vm.diskUrl);

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
