// Debug script: launch the dev server, point a Chromium at it, and
// dump everything it logs/errs in the first 60s so we can see why
// __rustWebBox.shim isn't appearing during the local e2e harness run.
import {
  startDevServer,
  tryLoadBrowserCommander,
} from '../web/tests/helpers/cheerpx-page-harness.mjs';

const { launchBrowser, makeBrowserCommander } =
  await tryLoadBrowserCommander();

const server = await startDevServer({ basePrefix: '/rust-web-box' });
console.log(`[e2e-debug] dev server: ${server.url}`);

const { browser, page } = await launchBrowser({
  engine: 'playwright',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
const commander = makeBrowserCommander({ page });

page.on('console', (msg) => {
  console.log(`[console.${msg.type()}]`, msg.text());
});
page.on('pageerror', (err) => {
  console.error(`[pageerror]`, err.message);
});
page.on('requestfailed', (req) => {
  console.error(`[requestfailed]`, req.url(), req.failure()?.errorText);
});
page.on('response', (res) => {
  if (res.status() >= 400) {
    console.error(`[response ${res.status()}]`, res.url());
  }
});

await commander.goto({ url: server.url, waitUntil: 'domcontentloaded', timeout: 30000 });
const cxVer = await page.evaluate(async () => {
  const r = await fetch('./cheerpx/.version');
  return r.ok ? await r.text() : 'NOT FOUND';
});
console.log('[cheerpx version on page]', cxVer.trim());

await new Promise((r) => setTimeout(r, 35_000));
const snapshot = await page.evaluate(() => ({
  hasRwb: typeof globalThis.__rustWebBox === 'object' && !!globalThis.__rustWebBox,
  keys: globalThis.__rustWebBox ? Object.keys(globalThis.__rustWebBox) : null,
  vmPhase: globalThis.__rustWebBox?.vmPhase,
  vmType: typeof globalThis.__rustWebBox?.vm,
  url: location.href,
  documentReady: document.readyState,
}));
console.log('[snapshot]', JSON.stringify(snapshot, null, 2));

await commander.destroy();
await browser.close();
await server.stop();
