// Boot orchestrator for rust-web-box.
//
// The page is intentionally minimal: a single VS Code Web workbench
// fills the viewport, exactly like vscode.dev. CheerpX boots in the
// background; loading status surfaces inside the VS Code terminal
// pane (rendered by the webvm-host extension), not as a custom HTML
// overlay. Errors and warnings surface through VS Code's native
// notification API — the page never invents its own UI element
// (issue #39).
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
import {
  createBusServer,
  createBusClient,
  openBroadcastChannel,
} from './webvm-bus.js';
import { createNotificationCenter } from './notifications.js';
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

// Issue #39: the page renders NO custom UI element for errors/warnings.
// Every user-facing notification is funnelled through this center, which
// broadcasts `vm.notify` over the bus; the webvm-host extension renders
// each one with VS Code's native notification API. The center buffers
// records produced before the extension subscribes (early-boot disk /
// CheerpX failures) and replays them on attach / on the extension's
// `vm.notify.sync` request.
const notifications = createNotificationCenter();
globalThis.__rustWebBox.notifications = notifications;

/**
 * Single uniform entry point for surfacing an error/warning/info. Always
 * also mirrored to the console so a failure is never truly silent even
 * before VS Code's extension host is live (issue #39 — handle every error
 * and warning uniformly, never fail silently).
 */
function notify(severity, message, detail = '') {
  const line = detail ? `${message} — ${detail}` : message;
  if (severity === 'warning') console.warn(`[rust-web-box] ${line}`);
  else if (severity === 'info') console.info(`[rust-web-box] ${line}`);
  else console.error(`[rust-web-box] ${line}`);
  return notifications.notify({ severity, message, detail });
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
    // notification immediately so the user sees the root cause rather
    // than the downstream CompileError.
    const browser = globalThis.__rustWebBox.browser ?? { id: 'unknown', isBrave: false };
    const category = info.status
      ? { kind: 'disk-503', title: 'Warm disk temporarily unavailable',
          body: `GitHub Pages returned HTTP ${info.status} for ${info.url} after ${info.attempts} attempts.` }
      : { kind: 'disk-503', title: 'Warm disk temporarily unavailable',
          body: `Could not fetch ${info.url} after ${info.attempts} attempts: ${info.error?.message ?? info.error ?? 'network error'}.` };
    const rendered = renderBootError(category, browser);
    notify('error', rendered.text, rendered.hint);
  },
});
globalThis.__rustWebBox.diskDiag = diskFetchDiag;

// Capture CheerpX-shaped boot errors into a structured diagnostics
// log so the notification center and the e2e harness see the same data.
installBootDiagnostics({ target: globalThis });

// Best-effort browser identity for Brave-aware notification hints.
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
  notify('error', text, rendered.hint);
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

  // Wire the notification center to the bus. We use a dedicated client on
  // its own BroadcastChannel instance (same channel name) so it can both
  // emit `vm.notify` and listen for the extension's `vm.notify.sync`
  // replay request — `busServer` only emits and would not survive the
  // stage-1 → stage-2 method-table hot-swap as a listener. Attaching here
  // also flushes any notifications buffered during early boot.
  try {
    const notifyBus = createBusClient({ channel: openBroadcastChannel() });
    notifications.attach(notifyBus);
    globalThis.__rustWebBox.notifyBus = notifyBus;
  } catch (err) {
    // Notifications still buffer; only live delivery is unavailable.
    console.warn('[rust-web-box] could not attach notification bus:', err);
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
  // `skipPrime` in webvm-server.js for the underlying CheerpX 1.3.x bug.
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
    const vmServer = startWebVMServer({
      cx: vm.cx,
      dataDevice: vm.dataDevice,
      busServer,
      workspace,
      status: { diskUrl: vm.diskUrl, persistKey: vm.persistKey },
      onPhase: setPhase,
      opts: {
        debug: dbgGuest,
        skipPrime,
        skipShellLoop,
        // If the interactive shell turns out to be unhealthy (keeps dying
        // immediately — the iPad Safari signature from issue #37), tell
        // the user instead of leaving an empty terminal with no
        // explanation.
        onShellUnhealthy: ({ kind, detail }) => {
          dbgGuest('interactive shell unhealthy: %s %o', kind, detail);
          // Surface as a native VS Code warning (issue #39 — no invented
          // UI). The terminal itself also shows the failure and exits
          // non-zero via the `vm.shell` event handled in the extension.
          notify(
            'warning',
            'The Linux shell did not start in this browser.',
            'Terminal features may be unavailable — see the terminal for ' +
              'details, then reload the tab or try a Chromium-based browser.',
          );
        },
      },
    });
    // Surface live server runtime (interactive-shell health, prime
    // errors) so dumpRuntime() can report it — issue #37 diagnostics.
    globalThis.__rustWebBox.vmServer = vmServer;
  }

  globalThis.__rustWebBox.vm = vm;
  return vm;
}

// If the VS Code Web bundle failed to load there is no workbench — and
// therefore no extension host to render a native notification through.
// This is a build/deploy fault (the deployed app always vendors the
// bundle), so the only honest surface left is the console. We still
// record it in the notification center so it replays if an extension
// host somehow comes up later. We never inject a custom DOM element.
function checkVSCode() {
  if (window.__vscodeMissing) {
    notify(
      'error',
      'VS Code Web bundle not vendored — run `node web/build/build-workbench.mjs`.',
    );
  }
}

checkVSCode();

(async () => {
  try {
    const ws = await bringUpWorkspace();
    // Bring up the VM in the background; the workspace is already
    // serving fs.* requests so VS Code's Explorer populates on its own
    // schedule.
    bringUpVM(ws);
  } catch (err) {
    // bringUpWorkspace already surfaces a notification; nothing more to do.
    // eslint-disable-next-line no-console
    console.warn('[rust-web-box] boot failed:', err);
  }
})();
