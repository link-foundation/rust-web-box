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
 * Drive a single browser session against `url`. Calls `body({ commander,
 * page, errors })` once the workbench has reached stage 1 (`__rustWebBox.shim`
 * present). `errors` is a live array of console-error strings the test can
 * assert on.
 *
 * The browser is always closed on exit, even when `body` throws.
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
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      // CheerpX writes some "expected" warnings to console.error during
      // boot (CSP for service workers, missing source maps, etc.). We
      // record everything but the assertion layer filters it.
      errors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    errors.push(`pageerror: ${err.message}`);
  });

  try {
    await commander.goto({ url, waitUntil: 'domcontentloaded', timeout: bootTimeoutMs });

    // Stage 1: wait for the workspace shim to populate
    // `globalThis.__rustWebBox`. That confirms `boot.js` ran and the
    // BroadcastChannel server is listening.
    await page.waitForFunction(
      () => Boolean(globalThis.__rustWebBox && globalThis.__rustWebBox.shim),
      { timeout: bootTimeoutMs },
    );

    return await body({ commander, page, errors });
  } finally {
    try { await commander.destroy(); } catch {}
    try { await browser.close(); } catch {}
  }
}

/**
 * Wait until CheerpX has booted Linux (stage 2). Returns the `vmPhase`
 * string (e.g. `'ready'`).
 */
export async function waitForLinux(page, { timeoutMs = DEFAULT_BOOT_TIMEOUT_MS } = {}) {
  return page.waitForFunction(
    () => {
      const rwb = globalThis.__rustWebBox;
      return rwb && rwb.vm && rwb.vmPhase === 'ready' ? rwb.vmPhase : false;
    },
    { timeout: timeoutMs },
  ).then((handle) => handle.jsonValue());
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
    const { vm } = rwb;
    const chunks = [];
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });
    const writer = {
      write: (data) => chunks.push(data),
      flush: () => {},
    };
    vm.setCustomConsole(writer, 80, 24);
    const timer = setTimeout(() => resolveDone({ timeout: true }), timeoutMs);
    let status;
    try {
      status = await vm.run('/bin/sh', ['-c', command], {
        env: ['HOME=/root', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'TERM=xterm-256color'],
        cwd: '/workspace',
        uid: 0, gid: 0,
      });
    } finally {
      clearTimeout(timer);
    }
    return { status, output: chunks.join(''), timedOut: false };
  }, { command, timeoutMs });
}

export { WEB_ROOT, REPO_ROOT };
