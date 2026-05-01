// Trace bus calls when skipPrime + skipShellLoop are BOTH true.
// We want to see if VS Code calls any cx.run-triggering methods
// (fs.writeFile, fs.delete, fs.rename, fs.createDirectory) during mount.
import {
  startDevServer,
  tryLoadBrowserCommander,
} from '../web/tests/helpers/cheerpx-page-harness.mjs';

const cx = await tryLoadBrowserCommander();
if (!cx) { console.error('install first'); process.exit(2); }
const { launchBrowser, makeBrowserCommander } = cx;

const server = await startDevServer({ basePrefix: '/rust-web-box' });
console.log('[trace-skip] dev server:', server.url);

const { browser, page } = await launchBrowser({
  engine: 'playwright',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const commander = makeBrowserCommander({ page });
const t0 = Date.now();
const stamp = () => `[+${(Date.now() - t0).toString().padStart(5, ' ')}ms]`;
page.on('pageerror', (err) => console.log(stamp(), '[pageerror]', err.message));
page.on('console', (msg) => {
  const t = msg.text();
  if (/bus\.method|method\.call|skip|exit|prime|a1|wedge|ENOPRO/i.test(t)) {
    console.log(stamp(), `[${msg.type()}]`, t.slice(0, 250));
  }
});

await page.addInitScript(() => {
  globalThis.__RUST_WEB_BOX_SKIP_PRIME = true;
  globalThis.__RUST_WEB_BOX_SKIP_BASH = true;
  // Also wrap setMethods to log every method call
  const tap = setInterval(() => {
    const bus = globalThis.__rustWebBox?.busServer;
    if (!bus) return;
    clearInterval(tap);
    const origSetMethods = bus.setMethods?.bind(bus);
    if (origSetMethods) {
      bus.setMethods = function(methods) {
        console.log('[bus.method.set] keys=' + Object.keys(methods || {}).join(','));
        const wrapped = {};
        for (const [k, fn] of Object.entries(methods || {})) {
          wrapped[k] = async (...args) => {
            console.log('[bus.method.call]', k, JSON.stringify(args)?.slice(0, 200));
            try {
              const r = await fn(...args);
              return r;
            } catch (err) {
              console.log('[bus.method.error]', k, err?.message);
              throw err;
            }
          };
        }
        return origSetMethods(wrapped);
      };
    }
  }, 50);
});

await commander.goto({ url: server.url, waitUntil: 'load', timeout: 60000 });

// Don't wait for vm.cx — it might never come. Just give it 15 seconds.
await new Promise((r) => setTimeout(r, 15_000));

console.log(stamp(), '[trace-skip] done watching');

await commander.destroy();
await browser.close();
await server.stop();
