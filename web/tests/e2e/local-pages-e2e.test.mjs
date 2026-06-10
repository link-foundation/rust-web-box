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
//      CheerpX to 1.3.0 (now tracked to the latest 1.3.3, issue #37) and
//      we lock the vendored version in here.
//   3. `tree`, the workspace listing, and the pre-built
//      `/workspace/target/release/hello` binary all execute. These are
//      the three commands the issue calls out as "must work".
//
// The harness uses `browser-commander` (issue #15 mandates it). When
// `browser-commander` or Chromium is missing locally we `t.skip()`
// instead of failing — CI overrides that with `RUST_WEB_BOX_E2E=1`.
//
// To run with a visible browser locally:
//   RUST_WEB_BOX_E2E=1 RUST_WEB_BOX_E2E_HEADED=1 node --test web/tests/e2e/local-pages-e2e.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';

import {
  E2E_REQUIRED,
  WEB_ROOT,
  firstSourceGreeting,
  hasLeanCargoDevProfile,
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

function vendoredVSCodeWeb() {
  return existsSync(path.join(WEB_ROOT, 'vscode-web', 'out', 'vs', 'workbench', 'workbench.web.main.js'));
}

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

function bailIfMissingWorkbenchPrereqs(t, { commander }) {
  if (!E2E_REQUIRED && process.env.RUST_WEB_BOX_E2E_NO_SANDBOX !== '1') {
    t.skip('set RUST_WEB_BOX_E2E=1 to run workbench e2e');
    return true;
  }
  if (!commander) {
    if (E2E_REQUIRED) throw new Error('browser-commander is required when RUST_WEB_BOX_E2E=1');
    t.skip('browser-commander / playwright not installed; skipping workbench e2e');
    return true;
  }
  if (!vendoredVSCodeWeb()) {
    if (E2E_REQUIRED) {
      throw new Error('web/vscode-web/out/vs/workbench/workbench.web.main.js missing — run `node web/build/build-workbench.mjs` first');
    }
    t.skip('VS Code Web not vendored; run `node web/build/build-workbench.mjs` first');
    return true;
  }
  return false;
}

async function waitForIssue37Chrome(page) {
  await page.waitForSelector('.monaco-workbench.vs-dark', { timeout: 30_000 });
  await page.waitForSelector('a.action-label[aria-label="Customize Layout..."]', { timeout: 30_000 });
  await page.waitForSelector('a.action-label[aria-label^="Split Editor Right"]', { timeout: 30_000 });
  await page.waitForSelector('a.action-label[aria-label="Hide Panel"]', { timeout: 30_000 });
  await page.waitForSelector('.monaco-list-row[aria-label=".vscode"] .monaco-tl-twistie', { timeout: 30_000 });
}

async function collectIssue37ChromeGeometry(page) {
  return await page.evaluate(() => {
    function mustQuery(selector, root = document) {
      const el = root.querySelector(selector);
      if (!el) throw new Error(`missing selector: ${selector}`);
      return el;
    }

    function metric(selector, root = document) {
      const el = mustQuery(selector, root);
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        selector,
        boxSizing: style.boxSizing,
        padding: style.padding,
        widthStyle: style.width,
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          right: rect.right,
          bottom: rect.bottom,
        },
      };
    }

    const folderRow = mustQuery('.monaco-list-row[aria-label=".vscode"]');
    const folderRowRect = folderRow.getBoundingClientRect();
    const folderLabelRect = mustQuery('.label-name', folderRow).getBoundingClientRect();
    const folderTwistie = metric('.monaco-tl-twistie', folderRow);

    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      workbench: metric('.monaco-workbench'),
      layoutButton: metric('a.action-label[aria-label="Customize Layout..."]'),
      editorSplitButton: metric('a.action-label[aria-label^="Split Editor Right"]'),
      panelCloseButton: metric('a.action-label[aria-label="Hide Panel"]'),
      folderTwistie,
      folderLabelOffset: folderLabelRect.x - folderRowRect.x,
    };
  });
}

function assertIssue37ChromeGeometry(geometry, phase) {
  assert.equal(geometry.workbench.rect.x, 0, `${phase}: workbench must start at viewport left`);
  assert.equal(geometry.workbench.rect.y, 0, `${phase}: workbench must start at viewport top`);
  assert.equal(
    Math.round(geometry.workbench.rect.width),
    geometry.viewportWidth,
    `${phase}: workbench width must equal viewport width`,
  );
  assert.equal(
    Math.round(geometry.workbench.rect.height),
    geometry.viewportHeight,
    `${phase}: workbench height must equal viewport height`,
  );

  for (const [name, button] of [
    ['layout button', geometry.layoutButton],
    ['editor split button', geometry.editorSplitButton],
    ['panel close button', geometry.panelCloseButton],
  ]) {
    assert.equal(button.boxSizing, 'content-box', `${phase}: ${name} must keep VS Code box sizing`);
    assert.ok(
      button.rect.width >= 22,
      `${phase}: ${name} hitbox should include VS Code's 16px icon plus padding; got ${button.rect.width}`,
    );
    assert.ok(
      button.rect.right <= geometry.viewportWidth,
      `${phase}: ${name} must stay inside the viewport; right=${button.rect.right}, viewport=${geometry.viewportWidth}`,
    );
  }

  assert.equal(
    geometry.folderTwistie.boxSizing,
    'content-box',
    `${phase}: Explorer twistie must keep VS Code box sizing`,
  );
  assert.ok(
    geometry.folderTwistie.rect.width >= 28,
    `${phase}: Explorer twistie should reserve icon plus padding; got ${geometry.folderTwistie.rect.width}`,
  );
  assert.ok(
    geometry.folderLabelOffset >= 32,
    `${phase}: Explorer label must not slide under the twistie; offset=${geometry.folderLabelOffset}`,
  );
}

test('local e2e: issue #37 preserves VS Code control geometry and hover hitboxes', async (t) => {
  const commander = await tryLoadBrowserCommander();
  if (bailIfMissingWorkbenchPrereqs(t, { commander })) return;

  const server = await startDevServer({ basePrefix: BASE_PREFIX });
  t.after(() => server.stop());

  await withWorkbench(server.url, async ({ page }) => {
    await waitForIssue37Chrome(page);

    const resting = await collectIssue37ChromeGeometry(page);
    assertIssue37ChromeGeometry(resting, 'resting');

    await page.hover('a.action-label[aria-label="Customize Layout..."]');
    const titleHover = await collectIssue37ChromeGeometry(page);
    assertIssue37ChromeGeometry(titleHover, 'title hover');

    await page.hover('.monaco-list-row[aria-label=".vscode"]');
    const treeHover = await collectIssue37ChromeGeometry(page);
    assertIssue37ChromeGeometry(treeHover, 'tree hover');
  }, { commander });
});

test('local e2e: workbench boots with COOP/COEP and CheerpX 1.3.3 runs `tree --version`', async (t) => {
  const commander = await tryLoadBrowserCommander();
  if (bailIfMissingPrereqs(t, { commander })) return;

  const server = await startDevServer({ basePrefix: BASE_PREFIX });
  t.after(() => server.stop());

  await withWorkbench(server.url, async ({ page, errors, diagnostics }) => {
    // Wait for Linux boot. CheerpX 1.2.11 fell over here with
    // `Program exited with code 71`; 1.3.x must reach `vmPhase: 'ready'`.
    const vmPhase = await waitForLinux(page, { diagnostics: { ...diagnostics, errors } });
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
    assert.match(ls.output, /target/);

    // Stage C: pre-built `cargo run` artifact. The disk image bakes a
    // release binary so we can verify the *execution* path without
    // waiting on a build. The exact greeting is asserted against the
    // source on disk below (issue #33) — here we only require that the
    // prebuilt binary actually executes and prints its hello line.
    const hello = await runInVM(page, '/workspace/target/release/hello');
    assert.equal(hello.status?.status ?? hello.status, 0);
    assert.match(hello.output, /Hello/, `prebuilt binary output:\n${hello.output}`);

    // Stage D: end-to-end `cargo run --release` (issue #17). This is
    // the operation that actually broke on the live site — running the
    // pre-built binary directly proved CheerpX could execute it but
    // skipped cargo's own code path (mtime check + linker invocation).
    // With the disk pre-bake (Dockerfile.disk: `cargo build --release`
    // AND `cargo build`), cargo's mtime check returns "Finished … 0.00s"
    // and no fresh inodes are allocated, so the OverlayDevice 'a1'
    // wedge cannot fire here.
    const cargoRun = await runInVM(page, 'cd /workspace && cargo run --release 2>&1', { timeoutMs: 120_000 });
    assert.equal(cargoRun.timedOut, false, `cargo run --release timed out — likely OverlayDevice wedge: ${cargoRun.output}`);
    assert.equal(cargoRun.status?.status ?? cargoRun.status, 0, `cargo run exit: ${JSON.stringify(cargoRun.status)}\noutput:\n${cargoRun.output}`);
    assert.match(cargoRun.output, /Hello/, `cargo run output:\n${cargoRun.output}`);
    assert.match(cargoRun.output, /Finished/, `cargo run did not print Finished:\n${cargoRun.output}`);

    // Stage C/D anti-fake / de-branding proof (issue #33). The
    // discriminator is the prebuilt binary's own output: it is baked into
    // the disk and is unaffected by the workspace prime or CheerpX's
    // guest clock, so it reliably tells the issue #33 plain-seed disk
    // (prints just `Hello, world!`) apart from a previously published
    // branded disk. We only assert the issue #33 guarantees on the former
    // so the suite stays green during the version-skew window where a PR
    // Pages build can still stage the older published disk.
    const prebuiltBranded =
      /compiled inside CheerpX|Compiled by Rust|Hello from rust-web-box/i.test(hello.output);
    if (!prebuiltBranded) {
      // The greeting the binary and `cargo run` print must be exactly the
      // literal in the source on disk — not an injected/hardcoded string.
      const greeting = await firstSourceGreeting(page);
      assert.equal(greeting, 'Hello, world!', `unexpected seed greeting: ${JSON.stringify(greeting)}`);
      assert.ok(hello.output.includes(greeting), `prebuilt binary did not print source greeting:\n${hello.output}`);
      assert.ok(cargoRun.output.includes(greeting), `cargo run did not print source greeting:\n${cargoRun.output}`);
      // The canonical cargo new program prints nothing else (issue #33):
      // no "rust-web-box" / "CheerpX" branding on every command.
      assert.doesNotMatch(cargoRun.output, /Compiled by Rust|compiled inside CheerpX/);
    }

    // Stage E: expanding target/ in the Explorer calls fs.readDir. That
    // should refresh target metadata from the guest on demand, without
    // reintroducing the issue #27 prompt-time full-target scan.
    const targetRoot = await requestWorkbenchBus(page, 'fs.readDir', {
      path: '/workspace/target',
    });
    assert.ok(targetRoot.some(([name]) => name === 'debug'), JSON.stringify(targetRoot));
    assert.ok(targetRoot.some(([name]) => name === 'release'), JSON.stringify(targetRoot));
    const targetDebug = await requestWorkbenchBus(page, 'fs.readDir', {
      path: '/workspace/target/debug',
    });
    assert.ok(targetDebug.length > 0, 'expected target/debug metadata after on-demand refresh');

    // Stage F: save through the same FileSystemProvider bus that VS Code
    // uses, then read from inside the guest. This is the narrow e2e
    // guard for issue #21's "Ctrl+S must affect the next VM command"
    // report without forcing a fresh cargo build in the browser.
    const editedSource = [
      'fn main() {',
      '    println!("saved through webvm fs bus");',
      '}',
      '',
    ].join('\n');
    await requestWorkbenchBus(page, 'fs.writeFile', {
      path: '/workspace/src/main.rs',
      data: Array.from(new TextEncoder().encode(editedSource)),
      options: { create: false, overwrite: true },
    });
    const catEdited = await runInVM(page, 'cat /workspace/src/main.rs');
    assert.equal(catEdited.status?.status ?? catEdited.status, 0);
    assert.match(catEdited.output, /saved through webvm fs bus/);

    // Stage G: the next user-facing cargo run must complete with the
    // edited source, not merely enter Cargo's compile path. Issue #31
    // reproduced as a second real debug rebuild that sat in `Compiling`
    // for minutes before CheerpX exited with code 71; accepting that
    // timeout masked the regression. PR Pages builds may still stage the
    // currently published disk-latest image, so only run this assertion
    // when the disk advertises the issue #31 lean dev profile.
    if (await hasLeanCargoDevProfile(page)) {
      const rerunEdited = await runInVM(page, 'cd /workspace && cargo run 2>&1', { timeoutMs: 180_000 });
      assert.equal(rerunEdited.timedOut, false, `edited cargo run timed out before completing:\n${rerunEdited.output}`);
      assert.equal(rerunEdited.status?.status ?? rerunEdited.status, 0, `edited cargo run exit: ${JSON.stringify(rerunEdited.status)}\noutput:\n${rerunEdited.output}`);
      assert.match(rerunEdited.output, /saved through webvm fs bus/, `edited cargo run output:\n${rerunEdited.output}`);
    } else {
      console.warn('[rust-web-box e2e] skipping issue #31 repeated debug cargo run: staged warm disk lacks the lean dev profile');
    }

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

test('local e2e: proc.stdout emit pipeline is single-delivery and disposers detach listeners (issue #27)', async (t) => {
  // Issue #27 regression. The user-visible symptom was: every typed
  // character appeared twice in the terminal, and every line of command
  // output (e.g. `cargo run`'s "Hello from rust-web-box!") rendered
  // duplicated. The root cause lived in the webvm-host extension: each
  // call to `makePseudoterminal().open()` did
  //   `stdoutDispose = bus.on('proc.stdout', …)`
  // without disposing the previous subscriber. VS Code Web calls open()
  // more than once per pty (panel reattach, terminal restore), so each
  // reattach added a fresh listener, and the writeEmitter that fanned
  // those subscribers into xterm received N copies of every byte.
  //
  // We can't reach VS Code's xterm DOM from this harness (the workbench
  // panel only mounts after a user gesture, and the e2e harness sets
  // `__RUST_WEB_BOX_SKIP_BASH = true` to avoid the CheerpX 1.3.x 'a1'
  // OverlayDevice wedge), so we validate the runtime invariants the
  // extension's fix relies on, exercised against the real page-side bus:
  //
  //   1. The page's busServer emits each `proc.stdout` chunk exactly once
  //      per BroadcastChannel subscriber. (If this regressed, every
  //      consumer — extension, debugger, future tooling — would see
  //      doubles regardless of how disciplined they were about
  //      subscriber lifecycle.)
  //
  //   2. The unsubscribe function returned by the page's bus dispatcher
  //      actually detaches the listener. The extension's fix
  //      (detachBusListeners() before re-binding) only works if calling
  //      that disposer stops further deliveries — so this is the runtime
  //      precondition for the fix.
  //
  // The narrow source-shape regression (every `bus.on('proc.stdout', …)`
  // site in extension.js is preceded by a paired `detachBusListeners()`
  // call) is asserted separately in
  // `web/tests/extension-pty-listeners.test.mjs`.
  const commander = await tryLoadBrowserCommander();
  if (bailIfMissingPrereqs(t, { commander })) return;

  const server = await startDevServer({ basePrefix: BASE_PREFIX });
  t.after(() => server.stop());

  await withWorkbench(server.url, async ({ page, errors, diagnostics }) => {
    const vmPhase = await waitForLinux(page, { diagnostics: { ...diagnostics, errors } });
    assert.equal(vmPhase, 'ready');

    const result = await page.evaluate(async () => {
      const busServer = globalThis.__rustWebBox?.busServer;
      if (!busServer || typeof busServer.emit !== 'function') {
        throw new Error('page-side busServer not exposed on __rustWebBox');
      }

      // Sentinel markers that cannot legitimately appear in the stream
      // unless we put them there.
      const MARKER_A = 'rwb_dup_check_a_' + Math.random().toString(36).slice(2, 10);
      const MARKER_B = 'rwb_dup_check_b_' + Math.random().toString(36).slice(2, 10);

      // Spin up an *independent* BroadcastChannel subscriber — the same
      // way the webvm-host extension would in its host worker. The bus
      // server lives in the page; this listener attaches from the same
      // page context, which still exercises the BroadcastChannel
      // postMessage → message-event delivery path.
      const channel = new BroadcastChannel('rust-web-box/webvm-bus');
      const inbox = [];
      const onMessage = (ev) => {
        const msg = ev.data;
        if (msg?.kind === 'event' && msg.topic === 'proc.stdout' && msg.payload?.chunk) {
          inbox.push(msg.payload.chunk);
        }
      };
      channel.addEventListener('message', onMessage);

      // Wait one microtask + one macrotask flush so the listener is wired
      // before we emit. BroadcastChannel postMessage is synchronous-ish
      // but message dispatch is on the next task; emitting too early
      // would mask the regression by losing chunks unrelated to the bug.
      await new Promise((r) => setTimeout(r, 0));

      // Invariant 1: page-side emit is single-delivery. Emit once and
      // give the message-event a tick to land. The pre-#27 doubled
      // pipeline would put MARKER_A in the inbox twice; the fixed
      // pipeline puts it in once.
      busServer.emit('proc.stdout', { pid: 1, chunk: MARKER_A });
      await new Promise((r) => setTimeout(r, 100));

      const countA = inbox.filter((c) => c === MARKER_A).length;

      // Invariant 2: subscribers detach cleanly. Remove our listener and
      // emit a *different* marker — it must not arrive. The extension's
      // fix (detachBusListeners() before re-binding) is built on this
      // exact precondition. If `removeEventListener` no-ops here, the
      // detach pattern in extension.js silently leaks listeners again.
      channel.removeEventListener('message', onMessage);
      busServer.emit('proc.stdout', { pid: 1, chunk: MARKER_B });
      await new Promise((r) => setTimeout(r, 100));

      const countB = inbox.filter((c) => c === MARKER_B).length;

      channel.close();
      return {
        markerA: MARKER_A,
        markerB: MARKER_B,
        countA,
        countB,
        inboxSize: inbox.length,
      };
    });

    assert.equal(
      result.countA, 1,
      `marker ${result.markerA} should appear exactly 1x in proc.stdout ` +
      `(single-delivery invariant), saw ${result.countA}. ` +
      `> 1 is the regression returning.`,
    );
    assert.equal(
      result.countB, 0,
      `marker ${result.markerB} should appear 0x after the listener detached ` +
      `(disposer invariant), saw ${result.countB}. > 0 means the unsubscribe ` +
      `function returned by the bus did not actually remove the listener — ` +
      `the extension's detachBusListeners() fix would silently leak.`,
    );
  }, { commander });
});
