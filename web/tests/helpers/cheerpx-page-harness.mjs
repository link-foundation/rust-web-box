// Reusable harness for end-to-end tests that drive the deployed
// rust-web-box page from a real browser.
//
// The harness is shared between the **local** e2e suite (which serves
// `web/` from the dev server on a free port) and the **post-deploy** e2e
// suite (which hits whatever GitHub Pages URL CI hands us). Both suites
// need the same primitives:
//
//   - launch a Chromium with cross-origin isolation enabled
//   - navigate to the workbench URL with COOP/COEP headers
//   - capture console errors so the suite fails on regressions
//   - wait for `globalThis.__rustWebBox.shim` to come up — that's our
//     stage-1 boot signal (workspace ready, CheerpX still loading)
//   - drive `cx.run` directly to verify `tree`, the shell, and the
//     pre-built `/workspace/target/release/hello` binary all work end
//     to end on the same warm disk that ships with Pages
//
// We use [`browser-commander`](https://github.com/link-foundation/browser-commander)
// for browser launch and navigation (issue #15 mandates it) and fall
// through to `commander.page.evaluate` for the in-page work — the
// library's documented escape hatch (see issues #35-#38 upstream).
// Anything we discover that the library should wrap natively is filed
// under `docs/case-studies/issue-15/upstream-issues/`.
//
// The harness is **soft-fails** on missing prerequisites (no Chromium
// installed, dev-server unable to bind, network blocked) so contributors
// without the full test toolchain still get a green `node --test`. CI
// turns those soft skips into hard failures via `RUST_WEB_BOX_E2E=1`.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');

/** Default boot timeout: tweak with RUST_WEB_BOX_E2E_BOOT_MS. */
export const DEFAULT_BOOT_TIMEOUT_MS = Number.parseInt(
  process.env.RUST_WEB_BOX_E2E_BOOT_MS || '120000',
  10,
);

/** True when `RUST_WEB_BOX_E2E=1` — fail hard instead of skipping. */
export const E2E_REQUIRED = process.env.RUST_WEB_BOX_E2E === '1';

/**
 * Returns true when the chunked rust-alpine warm disk is staged under
 * `web/disk/`. The file is produced by `node web/build/stage-pages-disk.mjs`
 * (CI runs it during the deploy build); locally a contributor must opt in
 * by setting `WARM_DISK_SOURCE_URL` and running the staging script.
 *
 * Without the warm disk, CheerpX falls back to the public WebVM Debian
 * image. That fallback works *at runtime* but doesn't carry `cargo` or
 * `tree`, so the `tree --version` / `cargo run` assertions in our local
 * e2e suite cannot succeed against it.
 */
export function isWarmDiskStaged() {
  const meta = path.join(WEB_ROOT, 'disk', 'rust-alpine.ext2.meta');
  const firstChunk = path.join(WEB_ROOT, 'disk', 'rust-alpine.ext2.c000000.txt');
  return existsSync(meta) && existsSync(firstChunk);
}

/**
 * Try to import `browser-commander`. Returns `null` if it (or playwright)
 * is not installed locally — the suite then `t.skip()`s instead of
 * crashing.
 */
export async function tryLoadBrowserCommander() {
  try {
    const mod = await import('browser-commander');
    if (typeof mod.launchBrowser !== 'function') {
      return null;
    }
    return mod;
  } catch (err) {
    if (E2E_REQUIRED) throw err;
    return null;
  }
}

/**
 * Bind a free localhost port. We can't pass `0` to dev-server.mjs because
 * it parses an explicit number, so we ask the OS for an ephemeral port,
 * close the listener, and pass the freed port to the child. There's a
 * tiny race window but in practice it's always fine for a sequential
 * test suite.
 */
export async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Spawn `node web/build/dev-server.mjs <port>` as a subprocess and wait
 * for it to print its `rust-web-box dev server: http://...` banner.
 *
 * Returns `{ url, stop }`. `stop()` SIGKILLs the child and resolves once
 * it has exited. `await using` is *not* used so this works on Node 20.
 */
export async function startDevServer({ basePrefix = '' } = {}) {
  const port = await getFreePort();
  const args = [path.join(WEB_ROOT, 'build', 'dev-server.mjs'), String(port)];
  if (basePrefix) args.push(`--base=${basePrefix}`);

  const child = spawn(process.execPath, args, {
    cwd: WEB_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const ready = new Promise((resolve, reject) => {
    let output = '';
    const onData = (chunk) => {
      output += chunk.toString('utf8');
      if (output.includes('rust-web-box dev server')) {
        child.stdout.off('data', onData);
        child.stderr.off('data', onErr);
        resolve();
      }
    };
    const onErr = (chunk) => {
      output += chunk.toString('utf8');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onErr);
    child.once('exit', (code) => {
      child.stdout.off('data', onData);
      child.stderr.off('data', onErr);
      reject(new Error(
        `dev-server exited with code ${code} before printing ready banner.\n` +
        output,
      ));
    });
    child.once('error', reject);
  });

  await ready;

  return {
    // Trailing slash matters: the workbench resolves relative URLs (like
    // `glue/boot.js`) against the document URL, so without it
    // `glue/boot.js` becomes `http://host/glue/boot.js` and 404s.
    url: `http://127.0.0.1:${port}${basePrefix}/`,
    stop: async () => {
      if (child.exitCode != null) return;
      await new Promise((resolve) => {
        child.once('exit', () => resolve());
        child.kill('SIGKILL');
      });
    },
  };
}

/**
 * Capture in-page state for failure diagnostics. Returns whatever we can
 * reach safely — never throws. The fields we surface are exactly the
 * things we wished we had the first time CheerpX cold-boot stalled in
 * CI: the last-observed `vmPhase`, the booleans for vm/workspace/shim,
 * the disk URL the bridge resolved to, and a bus-level boot history if
 * the page is wired to record it (we add the recorder below).
 */
async function captureWorkbenchSnapshot(page) {
  try {
    return await page.evaluate(() => {
      const safe = (v) => {
        try { return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : Boolean(v); }
        catch { return null; }
      };
      const rwb = globalThis.__rustWebBox || {};
      return {
        vmPhase: safe(rwb.vmPhase),
        hasVm: Boolean(rwb.vm),
        hasShim: Boolean(rwb.shim),
        hasWorkspace: Boolean(rwb.workspace),
        hasBusServer: Boolean(rwb.busServer),
        diskUrl: safe(rwb.vm && rwb.vm.diskUrl),
        diskKind: safe(rwb.vm && rwb.vm.diskKind),
        bootHistory: Array.isArray(globalThis.__rustWebBoxBootHistory)
          ? globalThis.__rustWebBoxBootHistory.slice(-50)
          : null,
        documentTitle: typeof document !== 'undefined' ? document.title : null,
        readyState: typeof document !== 'undefined' ? document.readyState : null,
      };
    });
  } catch (err) {
    return { captureError: err?.message ?? String(err) };
  }
}

/**
 * Format the structured timeout context as multi-line text we can attach
 * to a thrown error, so a single-line `Timeout 180000ms exceeded` in a
 * CI log expands into actionable evidence.
 */
function formatTimeoutContext({ stage, snapshot, consoleHistory, errors, failedRequests }) {
  const lines = [];
  lines.push(`workbench timeout at stage: ${stage}`);
  lines.push('--- in-page snapshot ---');
  lines.push(JSON.stringify(snapshot, null, 2));
  if (consoleHistory?.length) {
    lines.push('--- last console messages ---');
    for (const msg of consoleHistory.slice(-30)) lines.push(msg);
  }
  if (errors?.length) {
    lines.push('--- captured console.error / pageerror ---');
    for (const e of errors.slice(-20)) lines.push(e);
  }
  if (failedRequests?.length) {
    lines.push('--- failed network requests ---');
    for (const r of failedRequests.slice(-20)) lines.push(r);
  }
  return lines.join('\n');
}

/**
 * Drive a single browser session against `url`. Calls `body({ commander,
 * page, errors })` once the workbench has reached stage 1 (`__rustWebBox.shim`
 * present). `errors` is a live array of console-error strings the test can
 * assert on.
 *
 * The browser is always closed on exit, even when `body` throws. On a
 * stage-1 timeout we attach a snapshot + console + network log to the
 * thrown error so CI logs surface the *cause* of the stall rather than
 * just `Timeout Xms exceeded`.
 */
export async function withWorkbench(url, body, {
  commander: commanderMod,
  bootTimeoutMs = DEFAULT_BOOT_TIMEOUT_MS,
  headless = process.env.RUST_WEB_BOX_E2E_HEADED === '1' ? false : true,
} = {}) {
  const { launchBrowser, makeBrowserCommander } = commanderMod;
  // CI builds and most container/sandbox dev environments cannot use
  // Chromium's seccomp/userns sandbox. We turn it off either when CI=1
  // or when the user explicitly opts in via RUST_WEB_BOX_E2E_NO_SANDBOX.
  // Local desktop runs leave the sandbox on for safety.
  const noSandbox = process.env.CI || process.env.RUST_WEB_BOX_E2E_NO_SANDBOX === '1';
  const args = noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [];

  const { browser, page } = await launchBrowser({ engine: 'playwright', headless, args });
  const commander = makeBrowserCommander({ page, verbose: false });

  const errors = [];
  const consoleHistory = [];
  const failedRequests = [];
  page.on('console', (msg) => {
    const line = `[${msg.type()}] ${msg.text()}`;
    consoleHistory.push(line);
    if (msg.type() === 'error') {
      // CheerpX writes some "expected" warnings to console.error during
      // boot (CSP for service workers, missing source maps, etc.). We
      // record everything but the assertion layer filters it.
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
    consoleHistory.push(`[pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    try {
      failedRequests.push(`${req.method?.() ?? 'GET'} ${req.url?.() ?? '?'}: ${req.failure?.()?.errorText ?? 'failed'}`);
    } catch {}
  });
  page.on('response', (res) => {
    try {
      const status = res.status?.();
      if (typeof status === 'number' && status >= 400) {
        failedRequests.push(`HTTP ${status} ${res.url?.()}`);
      }
    } catch {}
  });

  // Inject a recorder for every `vm.boot` payload published on the
  // workspace's BroadcastChannel. We hook `postMessage` (not
  // `addEventListener`) because BroadcastChannel does NOT echo messages
  // back to the sender — only sibling instances receive them, and the
  // page only opens one channel during boot. `addInitScript` runs before
  // any page script so we don't miss the early `loading-cheerpx` /
  // `booting-linux` transitions.
  //
  // We don't filter by channel name. The bus uses `'rust-web-box/webvm-bus'`
  // (CHANNEL_NAME in web/glue/webvm-bus.js), and a stricter `===` check
  // here previously dropped every event — that's why the in-page snapshot
  // surfaced `bootHistory: []` even on runs that DID emit phases. Letting
  // any `vm.boot` event through is fine: the topic + kind discriminator is
  // unique enough.
  await page.addInitScript(() => {
    globalThis.__rustWebBoxBootHistory = [];
    const origBC = globalThis.BroadcastChannel;
    if (typeof origBC === 'function') {
      const origPost = origBC.prototype.postMessage;
      origBC.prototype.postMessage = function (data) {
        try {
          if (data && data.kind === 'event' && data.topic === 'vm.boot') {
            globalThis.__rustWebBoxBootHistory.push(
              `${Date.now()} ${this.name || '?'} ${data.payload && data.payload.phase}`,
            );
          }
        } catch {}
        return origPost.call(this, data);
      };
    }
    // CheerpX 1.3.0 has a flaky OverlayDevice bug: writing a brand-new
    // inode under /workspace can fire `TypeError: …reading 'a1'`,
    // `Program exited with code 71`, and wedge the runtime so every
    // subsequent `cx.run` errors with `function signature mismatch`.
    // See web/glue/webvm-server.js for full notes. The e2e suite runs
    // against whichever rust-alpine disk image is currently published
    // (which already ships the seed paths the prime would touch), so
    // skipping the prime is the safe choice that keeps boot deterministic.
    globalThis.__RUST_WEB_BOX_SKIP_PRIME = true;
    globalThis.__RUST_WEB_BOX_SKIP_BASH = true;
  });

  try {
    await commander.goto({ url, waitUntil: 'domcontentloaded', timeout: bootTimeoutMs });

    // Stage 1: wait for the workspace shim to populate
    // `globalThis.__rustWebBox`. That confirms `boot.js` ran and the
    // BroadcastChannel server is listening.
    //
    // Note: Playwright's `page.waitForFunction(fn, arg, options)` takes
    // *three* positional arguments; the options object is third, not
    // second. Passing `{ timeout }` as the second arg silently falls
    // through to the default 30s timeout — which is too short for a
    // cold CheerpX boot in CI. Always pass `undefined` as `arg`.
    try {
      await page.waitForFunction(
        () => Boolean(globalThis.__rustWebBox && globalThis.__rustWebBox.shim),
        undefined,
        { timeout: bootTimeoutMs },
      );
    } catch (err) {
      const snapshot = await captureWorkbenchSnapshot(page);
      const detail = formatTimeoutContext({
        stage: 'stage-1 (workspace shim)',
        snapshot,
        consoleHistory,
        errors,
        failedRequests,
      });
      err.message = `${err.message}\n${detail}`;
      throw err;
    }

    return await body({ commander, page, errors, diagnostics: { consoleHistory, failedRequests } });
  } finally {
    try { await commander.destroy(); } catch {}
    try { await browser.close(); } catch {}
  }
}

/**
 * Wait until CheerpX has booted Linux (stage 2). Returns the `vmPhase`
 * string (e.g. `'ready'`).
 *
 * On timeout the thrown error is enriched with the same in-page snapshot
 * + console + network log captured by `withWorkbench`, when those are
 * passed in via `diagnostics`. Tests should forward the `diagnostics`
 * argument they receive from the body callback so the failure surface is
 * uniform across both stages.
 */
export async function waitForLinux(page, { timeoutMs = DEFAULT_BOOT_TIMEOUT_MS, diagnostics } = {}) {
  // See note in `withWorkbench` — `waitForFunction` takes (fn, arg,
  // options). Pass `undefined` as `arg` so the options object lands on
  // the third positional, otherwise the default 30s timeout silently
  // applies and CheerpX cold boots in CI fail before they finish.
  try {
    return await page.waitForFunction(
      () => {
        const rwb = globalThis.__rustWebBox;
        return rwb && rwb.vm && rwb.vmPhase === 'ready' ? rwb.vmPhase : false;
      },
      undefined,
      { timeout: timeoutMs },
    ).then((handle) => handle.jsonValue());
  } catch (err) {
    const snapshot = await captureWorkbenchSnapshot(page);
    const detail = formatTimeoutContext({
      stage: 'stage-2 (CheerpX vmPhase=ready)',
      snapshot,
      consoleHistory: diagnostics?.consoleHistory,
      errors: diagnostics?.errors,
      failedRequests: diagnostics?.failedRequests,
    });
    err.message = `${err.message}\n${detail}`;
    throw err;
  }
}

/**
 * Run a single shell command inside the booted CheerpX VM and return
 * `{ status, output }`. Output is captured by piping `cx.run` through a
 * custom console.
 *
 * This is the lowest-level "cargo run / tree work" check: if it returns
 * `status: 0` and the expected text, the bug from issue #15 is gone.
 */
export async function runInVM(page, command, { timeoutMs = 60_000 } = {}) {
  return page.evaluate(async ({ command, timeoutMs }) => {
    const rwb = globalThis.__rustWebBox;
    if (!rwb || !rwb.vm) throw new Error('CheerpX VM is not ready');
    // boot.js stores the bootLinux *handle* on rwb.vm, so the CheerpX
    // Linux instance is at rwb.vm.cx — `setCustomConsole` and `run` live
    // there.
    const cx = rwb.vm.cx ?? rwb.vm;
    // CheerpX `setCustomConsole(writer, cols, rows)` expects a writer
    // FUNCTION `(buf, vt) => void` (matches attachConsole in
    // cheerpx-bridge.js), not an object with `.write`. The function is
    // called once per chunk of guest stdout/stderr; `vt` is the virtual
    // terminal index — we only collect vt=1 (the foreground tty).
    const chunks = [];
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const writer = (buf, vt) => {
      if (vt !== undefined && vt !== 1) return;
      let view;
      if (buf instanceof Uint8Array) view = buf;
      else if (buf instanceof ArrayBuffer) view = new Uint8Array(buf);
      else if (Array.isArray(buf)) view = new Uint8Array(buf);
      else return;
      chunks.push(decoder.decode(view, { stream: true }));
    };
    cx.setCustomConsole(writer, 80, 24);
    // CheerpX 1.3.0 has a flaky 'a1' bug where cx.run can hang forever
    // after a runtime crash (the JS-level promise never settles). Race
    // it with a timeout so a wedged probe surfaces as a clear failure
    // rather than the test runner's overall timeout.
    const TIMEOUT = Symbol('runInVM-timeout');
    const winner = await Promise.race([
      cx.run('/bin/sh', ['-c', command], {
        // Match Dockerfile.disk's /root/.bash_profile: include
        // /root/.cargo/bin (rustup-managed toolchain) and disable
        // incremental builds (issue #17 — fresh fingerprint inodes
        // trip the CheerpX 1.3.0 OverlayDevice 'a1' wedge).
        env: [
          'HOME=/root',
          'PATH=/root/.cargo/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
          'TERM=xterm-256color',
          'CARGO_INCREMENTAL=0',
        ],
        cwd: '/workspace',
        uid: 0, gid: 0,
      }),
      new Promise((resolve) => setTimeout(() => resolve(TIMEOUT), timeoutMs)),
    ]);
    chunks.push(decoder.decode());
    if (winner === TIMEOUT) {
      return { status: null, output: chunks.join(''), timedOut: true };
    }
    return { status: winner, output: chunks.join(''), timedOut: false };
  }, { command, timeoutMs });
}

export { WEB_ROOT, REPO_ROOT };
