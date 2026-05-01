// Local e2e suite for the rust-web-box workbench.
//
// What this guards against (issue #15):
//   1. The workbench page boots from the dev server with COOP/COEP
//      headers exactly mirroring GitHub Pages — same path prefix, same
//      same-origin warm disk layout. If it boots locally, it boots on
//      Pages.
//   2. CheerpX successfully runs a shell command. The 1.2.11 bug we
//      tracked down for issue #15 only surfaced *after* the page mounted
//      — `cx.run` itself crashed with `TypeError: …reading 'a1'` and
//      `CheerpException: Program exited with code 71`. The fix bumped
//      CheerpX to 1.3.0 and we lock that in here.
//   3. `tree`, the workspace listing, and the pre-built
//      `/workspace/target/release/hello` binary all execute. These are
//      the three commands the issue calls out as "must work".
//
// The harness uses `browser-commander` (issue #15 mandates it). When
// `browser-commander` or Chromium is missing locally we `t.skip()`
// instead of failing — CI overrides that with `RUST_WEB_BOX_E2E=1`.
//
// To run with a visible browser locally:
//   RUST_WEB_BOX_E2E_HEADED=1 node --test web/tests/e2e/local-pages-e2e.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  E2E_REQUIRED,
  WEB_ROOT,
  isWarmDiskStaged,
  runInVM,
  startDevServer,
  tryLoadBrowserCommander,
  waitForLinux,
  withWorkbench,
} from '../helpers/cheerpx-page-harness.mjs';

const BASE_PREFIX = '/rust-web-box';

function vendoredCheerpx() {
  return existsSync(path.join(WEB_ROOT, 'cheerpx', 'cx.esm.js'));
}

/**
 * Soft-fails / hard-fails uniformly for prerequisites the local suite
 * needs but cannot bootstrap on its own (browser, vendored runtime,
 * staged warm disk). Returns `true` when the test should bail.
 */
function bailIfMissingPrereqs(t, { commander }) {
  if (!commander) {
    if (E2E_REQUIRED) throw new Error('browser-commander is required when RUST_WEB_BOX_E2E=1');
    t.skip('browser-commander / playwright not installed; skipping local e2e');
    return true;
  }
  if (!vendoredCheerpx()) {
    if (E2E_REQUIRED) {
      throw new Error('web/cheerpx/cx.esm.js missing — run `node web/build/build-workbench.mjs` first');
    }
    t.skip('CheerpX not vendored; run `node web/build/build-workbench.mjs` first');
    return true;
  }
  if (!isWarmDiskStaged()) {
    // The local suite asserts on `cargo`, `tree`, and the prebuilt
    // `/workspace/target/release/hello` binary. All three are baked into
    // the rust-alpine warm disk; the public Debian fallback doesn't
    // carry them. Skip cleanly instead of "passing" against a disk that
    // can't ever satisfy our assertions.
    if (E2E_REQUIRED) {
      throw new Error(
        'warm rust-alpine disk is not staged under web/disk/ — run ' +
        '`WARM_DISK_SOURCE_URL=https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2 ' +
        'node web/build/stage-pages-disk.mjs` first',
      );
    }
    t.skip('warm rust-alpine disk not staged; run web/build/stage-pages-disk.mjs to enable local e2e');
    return true;
  }
  return false;
}

test('local e2e: workbench boots with COOP/COEP and CheerpX 1.3.0 runs `tree --version`', async (t) => {
  const commander = await tryLoadBrowserCommander();
  if (bailIfMissingPrereqs(t, { commander })) return;

  const server = await startDevServer({ basePrefix: BASE_PREFIX });
  t.after(() => server.stop());

  await withWorkbench(server.url, async ({ page, errors }) => {
    // Wait for Linux boot. CheerpX 1.2.11 fell over here with
    // `Program exited with code 71`; 1.3.0 must reach `vmPhase: 'ready'`.
    const vmPhase = await waitForLinux(page);
    assert.equal(vmPhase, 'ready', 'expected CheerpX to reach vmPhase=ready');

    // Stage A: pure CheerpX call — independent of the bus / VS Code
    // extension, so a failure here narrows the bug to the runtime.
    const tree = await runInVM(page, 'tree --version 2>&1');
    assert.equal(tree.status?.status ?? tree.status, 0, `tree exit: ${JSON.stringify(tree.status)}`);
    assert.match(tree.output, /tree v\d+\.\d+\.\d+/, `tree output: ${tree.output}`);

    // Stage B: workspace is mirrored. `tree /workspace -L 2` must list
    // Cargo.toml + src + target — the same things the issue's screenshot
    // shows the user typing into a terminal that just echoes
    // `Linux.run terminal not implemented`.
    const ls = await runInVM(page, 'tree /workspace -L 2');
    assert.equal(ls.status?.status ?? ls.status, 0);
    assert.match(ls.output, /Cargo\.toml/);
    assert.match(ls.output, /src/);

    // Stage C: pre-built `cargo run` artifact. Real `cargo run` from
    // cold takes minutes (orthogonal scaling work, see issue #15
    // discussion); the disk image bakes a release binary so we can
    // verify the *execution* path of `cargo run --release` without
    // waiting on the build itself.
    const hello = await runInVM(page, '/workspace/target/release/hello');
    assert.equal(hello.status?.status ?? hello.status, 0);
    assert.match(hello.output, /Hello from rust-web-box!/);

    // No CheerpException must have leaked into console.error during the
    // run. (CheerpX 1.2.11 logged it asynchronously, after `cx.run`
    // already returned, so we check at the end.)
    const fatal = errors.filter((e) => /CheerpException|Program exited with code 71/.test(e));
    assert.deepEqual(fatal, [], `unexpected fatal CheerpX errors:\n${fatal.join('\n')}`);
  }, { commander });
});

test('local e2e: workbench surfaces the warm disk manifest', async (t) => {
  // This sub-test only checks that the dev server hands us back the
  // manifest CheerpX needs, so it doesn't actually require a browser.
  // We still soft-skip when browser-commander is missing to keep the
  // "what's required" surface area uniform across the local suite.
  const commander = await tryLoadBrowserCommander();
  if (!commander) {
    if (E2E_REQUIRED) throw new Error('browser-commander required');
    t.skip('browser-commander / playwright not installed');
    return;
  }
  const server = await startDevServer({ basePrefix: BASE_PREFIX });
  t.after(() => server.stop());

  // Just a same-origin fetch — this is the cheap probe that tells us
  // whether GitHub Pages will hand the page our `web/disk/manifest.json`
  // when it ships. No CheerpX needed, so this works even on contributors
  // who have not vendored the runtime locally.
  const res = await fetch(`${server.url}/disk/manifest.json`);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.ok(json.warm, 'manifest must have a "warm" entry');
  assert.equal(json.warm.kind, 'github');
  assert.equal(json.warm.release_tag, 'disk-latest');
});
