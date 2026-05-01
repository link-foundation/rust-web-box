// Final narrow: which exact operation triggers the 1.3.0 a1 bug on rust-alpine.
// 1) touch a new file in an existing dir
// 2) mkdir a new directory
// 3) echo > a new file
// 4) heredoc > a new file
import {
  startDevServer,
  tryLoadBrowserCommander,
} from '../web/tests/helpers/cheerpx-page-harness.mjs';

const cx = await tryLoadBrowserCommander();
if (!cx) { console.error('install first'); process.exit(2); }
const { launchBrowser, makeBrowserCommander } = cx;

const server = await startDevServer({ basePrefix: '/rust-web-box' });
console.log('[narrow5] dev server:', server.url);

async function runOne(label, script, timeoutMs = 15_000) {
  const { browser, page } = await launchBrowser({
    engine: 'playwright',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const commander = makeBrowserCommander({ page });
  const errors = [];
  page.on('pageerror', (err) => { errors.push(err.message); });
  await commander.goto({ url: server.url, waitUntil: 'domcontentloaded', timeout: 60000 });
  const result = await page.evaluate(async ({ script, timeoutMs }) => {
    try {
      const bridge = await import('./glue/cheerpx-bridge.js');
      const CheerpX = await bridge.loadCheerpX();
      const cfg = await bridge.resolveDiskConfig();
      const handle = await bridge.bootLinux({ CheerpX, diskConfig: cfg });
      await handle.dataDevice.writeFile('/test.sh', script);
      const winner = await Promise.race([
        handle.cx.run('/bin/sh', ['/data/test.sh'], {
          env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
          cwd: '/root', uid: 0, gid: 0,
        }).then((e) => ({ ok: true, exit: e })),
        new Promise((r) => setTimeout(() => r({ ok: false, error: `TIMEOUT_${timeoutMs / 1000}s` }), timeoutMs)),
      ]);
      return winner;
    } catch (err) {
      return { error: { name: err?.name, message: err?.message } };
    }
  }, { script, timeoutMs });
  await commander.destroy();
  await browser.close();
  console.log(`[${label}] ${JSON.stringify(result)}`);
  return result;
}

await runOne('Y1-touch-tmp', "set -eu\ntouch /tmp/foo\nexit 0\n");
await runOne('Y2-touch-workspace', "set -eu\ntouch /workspace/foo\nexit 0\n");
await runOne('Y3-mkdir-tmp', "set -eu\nmkdir /tmp/newdir\nexit 0\n");
await runOne('Y4-mkdir-workspace', "set -eu\nmkdir /workspace/newdir\nexit 0\n");
await runOne('Y5-echo-tmp', "set -eu\necho hi > /tmp/echo-test\nexit 0\n");
await runOne('Y6-echo-workspace', "set -eu\necho hi > /workspace/echo-test\nexit 0\n");

await server.stop();
