// Post-deploy e2e suite: drives whatever URL CI just deployed (or the
// production https://link-foundation.github.io/rust-web-box). This is
// the test the PR description for issue #15 calls out — the suite that
// proves the *deployed* page works, not just our local copy.
//
// Run modes:
//
//   - In CI, the `pages.yml` post-deploy job sets
//     RUST_WEB_BOX_LIVE_URL=${{ steps.deployment.outputs.page_url }} and
//     RUST_WEB_BOX_E2E=1, so the suite runs hard-fail against the URL
//     GitHub Pages just published.
//
//   - Locally, leaving RUST_WEB_BOX_LIVE_URL unset skips the suite (so
//     `node --test web/tests/` stays fast and offline-friendly).
//     Setting `RUST_WEB_BOX_LIVE_URL=https://link-foundation.github.io/rust-web-box`
//     drives the production site directly.
//
// The suite asserts the same three things the local one does — Linux
// boot, `tree`, pre-built hello binary — because the scenario in issue
// #15 ("execute `cargo run` or `tree` inside WebVM terminal") only
// counts as fixed when those work end-to-end on the deployed page, not
// just locally.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  E2E_REQUIRED,
  runInVM,
  tryLoadBrowserCommander,
  waitForLinux,
  withWorkbench,
} from '../helpers/cheerpx-page-harness.mjs';

const LIVE_URL = process.env.RUST_WEB_BOX_LIVE_URL;
// Live boot from a cold fastly cache + cold IDB overlay can take longer
// than the local dev server. We let CI override.
const BOOT_MS = parseInt(process.env.RUST_WEB_BOX_E2E_BOOT_MS || '180000', 10);

async function requestWorkbenchBus(page, method, params) {
  return await page.evaluate(async ({ method, params }) => {
    const channel = new BroadcastChannel('rust-web-box/webvm-bus');
    const id = Math.floor(Math.random() * 1_000_000_000);
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`bus request timed out: ${method}`)),
          60_000,
        );
        channel.addEventListener('message', (ev) => {
          const msg = ev.data;
          if (!msg || msg.kind !== 'response' || msg.id !== id) return;
          clearTimeout(timer);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        });
        channel.postMessage({ id, kind: 'request', method, params });
      });
    } finally {
      channel.close();
    }
  }, { method, params });
}

test('live e2e: the deployed Pages site boots and runs `tree --version`', async (t) => {
  if (!LIVE_URL) {
    if (E2E_REQUIRED) {
      throw new Error('RUST_WEB_BOX_LIVE_URL is required when RUST_WEB_BOX_E2E=1');
    }
    t.skip('RUST_WEB_BOX_LIVE_URL not set; skipping live e2e');
    return;
  }
  const commander = await tryLoadBrowserCommander();
  if (!commander) {
    if (E2E_REQUIRED) throw new Error('browser-commander required when RUST_WEB_BOX_E2E=1');
    t.skip('browser-commander / playwright not installed');
    return;
  }

  await withWorkbench(LIVE_URL, async ({ page, errors, diagnostics }) => {
    const vmPhase = await waitForLinux(page, { timeoutMs: BOOT_MS, diagnostics: { ...diagnostics, errors } });
    assert.equal(vmPhase, 'ready', `live workbench did not reach vmPhase=ready (was: ${vmPhase})`);

    const tree = await runInVM(page, 'tree --version 2>&1');
    assert.equal(tree.status?.status ?? tree.status, 0, `tree exit: ${JSON.stringify(tree.status)}`);
    assert.match(tree.output, /tree v\d+\.\d+\.\d+/, `tree output: ${tree.output}`);

    const ls = await runInVM(page, 'tree /workspace -L 2');
    assert.equal(ls.status?.status ?? ls.status, 0);
    assert.match(ls.output, /Cargo\.toml/);

    const hello = await runInVM(page, '/workspace/target/release/hello');
    assert.equal(hello.status?.status ?? hello.status, 0);
    assert.match(hello.output, /Hello from rust-web-box!/);

    // Issue #17 regression guard: `cargo run --release` was the user-
    // facing operation that broke on the live site (CheerpException 71
    // / 'a1' wedge). The earlier suite only proved the prebuilt binary
    // could execute, which doesn't catch a regression in cargo's own
    // path. With the disk pre-bake (Dockerfile.disk), cargo's mtime
    // check is satisfied immediately and `cargo run --release` returns
    // in ~1s — no fresh inodes, no wedge.
    const cargoRun = await runInVM(page, 'cd /workspace && cargo run --release 2>&1', { timeoutMs: 120_000 });
    assert.equal(cargoRun.timedOut, false, `cargo run --release timed out — likely OverlayDevice wedge: ${cargoRun.output}`);
    assert.equal(cargoRun.status?.status ?? cargoRun.status, 0, `cargo run exit: ${JSON.stringify(cargoRun.status)}\noutput:\n${cargoRun.output}`);
    assert.match(cargoRun.output, /Hello from rust-web-box!/, `cargo run output:\n${cargoRun.output}`);
    assert.match(cargoRun.output, /Finished/, `cargo run did not print Finished:\n${cargoRun.output}`);

    const targetRoot = await requestWorkbenchBus(page, 'fs.readDir', {
      path: '/workspace/target',
    });
    assert.ok(targetRoot.some(([name]) => name === 'debug'), JSON.stringify(targetRoot));
    assert.ok(targetRoot.some(([name]) => name === 'release'), JSON.stringify(targetRoot));
    const targetDebug = await requestWorkbenchBus(page, 'fs.readDir', {
      path: '/workspace/target/debug',
    });
    assert.ok(targetDebug.length > 0, 'expected target/debug metadata after on-demand refresh');

    const editedSource = [
      'fn main() {',
      '    println!("saved through live webvm fs bus");',
      '}',
      '',
    ].join('\n');
    await requestWorkbenchBus(page, 'fs.writeFile', {
      path: '/workspace/src/main.rs',
      data: Array.from(new TextEncoder().encode(editedSource)),
      options: { create: false, overwrite: true },
    });
    const rerunEdited = await runInVM(page, 'cd /workspace && cargo run --release 2>&1', { timeoutMs: 120_000 });
    assert.equal(rerunEdited.timedOut, false, `edited cargo run timed out: ${rerunEdited.output}`);
    assert.equal(rerunEdited.status?.status ?? rerunEdited.status, 0, `edited cargo run exit: ${JSON.stringify(rerunEdited.status)}\noutput:\n${rerunEdited.output}`);
    assert.match(rerunEdited.output, /saved through live webvm fs bus/, `edited cargo run output:\n${rerunEdited.output}`);

    const fatal = errors.filter((e) => /CheerpException|Program exited with code 71/.test(e));
    assert.deepEqual(fatal, [], `unexpected fatal CheerpX errors on live site:\n${fatal.join('\n')}`);
  }, { commander, bootTimeoutMs: BOOT_MS });
});
