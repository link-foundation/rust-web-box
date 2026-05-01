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

  await withWorkbench(LIVE_URL, async ({ page, errors }) => {
    const vmPhase = await waitForLinux(page, { timeoutMs: BOOT_MS });
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

    const fatal = errors.filter((e) => /CheerpException|Program exited with code 71/.test(e));
    assert.deepEqual(fatal, [], `unexpected fatal CheerpX errors on live site:\n${fatal.join('\n')}`);
  }, { commander, bootTimeoutMs: BOOT_MS });
});
