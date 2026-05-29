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
//      this — the user sees `src/main.rs` the moment the page loads.
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
import { installDiskChunkFetch } from './disk-chunk-fetch.js';
import { detectBrowser } from './browser-info.js';
import {
  categorizeBootError,
  renderBootError,
  installBootDiagnostics,
} from './boot-diagnostics.js';

const debugOpts = {
  search: location.search,
  storage: typeof localStorage !== 'undefined' ? localStorage : null,
};
const dbgBoot = createDebug('boot', debugOpts);
const dbgWorkbench = createDebug('workbench', debugOpts);
const dbgGuest = createDebug('guest', debugOpts);

const shim = createNetworkShim();
globalThis.__rustWebBox = globalThis.__rustWebBox || {};
globalThis.__rustWebBox.shim = shim;
globalThis.__rustWebBox.classifyHost = classifyHost;
globalThis.__rustWebBox.dump = () => dumpRuntime(globalThis);

const toast = document.getElementById('boot-toast');
const toastText = toast?.querySelector('[data-toast-text]');

function setToast(text, kind = 'info', hint = '') {
  if (!toast || !toastText) return;
  const suffix = hint ? `\n${hint}` : '';
  toastText.textContent = `${text}${suffix}`;
  toast.dataset.kind = kind;
  toast.hidden = false;
}

function hideToast() {
  if (!toast) return;
  toast.hidden = true;
}

// Install the chunk-fetch retry wrapper on `globalThis.fetch` BEFORE
// the CheerpX module is imported — CheerpX captures `fetch` once at
// module-eval time, so installing later would miss the warm-disk
// chunk requests. Issue #35 root-cause fix.
const diskFetchDiag = { attempts: [] };
installDiskChunkFetch({
  diag: diskFetchDiag,
  logger: { debug: createDebug('disk-fetch', debugOpts) },
  onPersistentFailure(info) {
    // The chunk fetch ultimately failed after retries. CheerpX may
    // continue (and JIT garbage into invalid WASM), so surface the
    // toast immediately so the user sees the root cause rather than
    // the downstream CompileError.
    const browser = globalThis.__rustWebBox.browser ?? { id: 'unknown', isBrave: false };
    const category = info.status
      ? { kind: 'disk-503', title: 'Warm disk temporarily unavailable',
          body: `GitHub Pages returned HTTP ${info.status} for ${info.url} after ${info.attempts} attempts.` }
      : { kind: 'disk-503', title: 'Warm disk temporarily unavailable',
          body: `Could not fetch ${info.url} after ${info.attempts} attempts: ${info.error?.message ?? info.error ?? 'network error'}.` };
    const rendered = renderBootError(category, browser);
    setToast(rendered.text, 'error', rendered.hint);
  },
});
globalThis.__rustWebBox.diskDiag = diskFetchDiag;

// Capture CheerpX-shaped boot errors into a structured diagnostics
// log so the toast renderer and the e2e harness see the same data.
installBootDiagnostics({ target: globalThis });

// Best-effort browser identity for Brave-aware toast hints.
detectBrowser().then((browser) => {
  globalThis.__rustWebBox.browser = browser;
}).catch(() => {
  globalThis.__rustWebBox.browser = { id: 'unknown', isBrave: false };
});

function showBootError(err, { fallbackTitle } = {}) {
  const category = categorizeBootError({ error: err });
  const browser = globalThis.__rustWebBox.browser ?? { id: 'unknown', isBrave: false };
  const rendered = renderBootError(category, browser);
  const text = category.kind === 'unknown' && fallbackTitle
    ? `${fallbackTitle}: ${rendered.text}`
    : rendered.text;
  setToast(text, 'error', rendered.hint);
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
    showBootError(err, { fallbackTitle: 'Workspace store unavailable' });
    throw err;
  }

  let channel;
  try {
    channel = openBroadcastChannel();
  } catch (err) {
    showBootError(err, { fallbackTitle: 'Bus init failed' });
    throw err;
  }

  // Stage 1 method table: serves fs.* immediately so the Explorer
  // populates without waiting on CheerpX.
  const busServer = createBusServer({
    channel,
    methods: workspaceOnlyMethods({ workspace }),
  });
  workspace.onChange((change) => {
    try { busServer.emit('fs.change', change); } catch {}
  });
  // Tell any extensions that started up first that the bus is alive.
  busServer.emit('vm.boot', { phase: 'workspace-ready' });

  globalThis.__rustWebBox.busChannel = channel;
  globalThis.__rustWebBox.workspace = workspace;
  globalThis.__rustWebBox.busServer = busServer;
  return { workspace, channel, busServer };
}

async function bringUpVM({ workspace, channel, busServer }) {
  // Single source of truth for the page-level vmPhase shim. Every
  // phase transition — whether it comes from the CheerpX bridge during
  // bootLinux, or from webvm-server.js after CheerpX is up — must funnel
  // through here. The e2e harness keys `vmPhase === 'ready'` on this
  // value and CheerpX's own `onProgress` only emits up to `starting
  // Linux`; the final `ready` transition originates inside
  // startWebVMServer.
  const setPhase = (phase) => {
    globalThis.__rustWebBox.vmPhase = phase;
    dbgBoot('vm phase', phase);
    try { busServer.emit('vm.boot', { phase }); } catch {}
  };

  setPhase('loading-cheerpx');
  dbgBoot('loading CheerpX');
  let CheerpX;
  try {
    CheerpX = await loadCheerpX();
  } catch (err) {
    showBootError(err, { fallbackTitle: 'CheerpX failed to load' });
    return null;
  }

  setPhase('booting-linux');
  dbgBoot('CheerpX loaded; booting Linux');
  let vm;
  try {
    vm = await bootLinux({
      CheerpX,
      onProgress: setPhase,
    });
  } catch (err) {
    showBootError(err, { fallbackTitle: 'Linux VM failed to boot' });
    return null;
  }
  dbgBoot('VM booted with disk', vm.diskUrl);

  // Stage 2: hot-swap to the full server (workspace + terminal). The
  // server emits `syncing-workspace` → `ready` from inside its bootTask;
  // forward those into our single-source-of-truth `setPhase` so the
  // page-level shim observes the entire lifecycle.
  //
  // `?skipPrime=1` (or `globalThis.__RUST_WEB_BOX_SKIP_PRIME = true` set
  // before navigation) disables the workspace-prime + shell-profile
  // heredocs. We expose this for e2e tests that need a deterministic boot
  // against the *currently published* disk image, before that image
  // republishes with the new pre-baked seed paths. See the comment above
  // `skipPrime` in webvm-server.js for the underlying CheerpX 1.3.0 bug.
  const skipPrime = (() => {
    try {
      if (globalThis.__RUST_WEB_BOX_SKIP_PRIME === true) return true;
      const params = new URLSearchParams(location.search);
      const v = params.get('skipPrime');
      return v === '1' || v === 'true';
    } catch {
      return false;
    }
  })();
  const skipShellLoop = (() => {
    try {
      if (globalThis.__RUST_WEB_BOX_SKIP_BASH === true) return true;
      const params = new URLSearchParams(location.search);
      const v = params.get('skipShellLoop');
      return v === '1' || v === 'true';
    } catch {
      return false;
    }
  })();
  // Bisect-only escape hatch: when set, do NOT call startWebVMServer at
  // all. Used by experiments/cx-130-bisect-no-server.mjs to test whether
  // the 'a1' wedge fires from CheerpX/VS Code alone, without our server.
  // Safe to leave in place — has no effect unless the flag is set.
  if (globalThis.__RUST_WEB_BOX_BISECT_SKIP_SERVER === true) {
    dbgBoot('startWebVMServer skipped (bisect mode)');
    setPhase('ready');
  } else {
    startWebVMServer({
      cx: vm.cx,
      dataDevice: vm.dataDevice,
      busServer,
      workspace,
      status: { diskUrl: vm.diskUrl, persistKey: vm.persistKey },
      onPhase: setPhase,
      opts: { debug: dbgGuest, skipPrime, skipShellLoop },
    });
  }

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
