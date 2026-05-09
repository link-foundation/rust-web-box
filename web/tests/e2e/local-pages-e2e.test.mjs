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

test('local e2e: workbench boots with COOP/COEP and CheerpX 1.3.0 runs `tree --version`', async (t) => {
  const commander = await tryLoadBrowserCommander();
  if (bailIfMissingPrereqs(t, { commander })) return;

  const server = await startDevServer({ basePrefix: BASE_PREFIX });
  t.after(() => server.stop());

  await withWorkbench(server.url, async ({ page, errors, diagnostics }) => {
    // Wait for Linux boot. CheerpX 1.2.11 fell over here with
    // `Program exited with code 71`; 1.3.0 must reach `vmPhase: 'ready'`.
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
    // waiting on a build.
    const hello = await runInVM(page, '/workspace/target/release/hello');
    assert.equal(hello.status?.status ?? hello.status, 0);
    assert.match(hello.output, /Hello from rust-web-box!/);

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
    assert.match(cargoRun.output, /Hello from rust-web-box!/, `cargo run output:\n${cargoRun.output}`);
    assert.match(cargoRun.output, /Finished/, `cargo run did not print Finished:\n${cargoRun.output}`);

    // Stage E: save through the same FileSystemProvider bus that VS Code
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

test('local e2e: terminal proc.stdout does not duplicate bytes when reattached (issue #27)', async (t) => {
  // Issue #27 regression. The user-visible symptom was: every typed
  // character appeared twice in the terminal, and every line of command
  // output (e.g. `cargo run`'s "Hello from rust-web-box!") rendered
  // duplicated. The root cause lived in the webvm-host extension: each
  // call to `makePseudoterminal().open()` did
  //   `stdoutDispose = bus.on('proc.stdout', …)`
  // without disposing the previous subscriber. VS Code Web calls open()
  // more than once per pty (panel reattach, terminal restore), so each
  // reattach added a fresh listener and the writeEmitter received N
  // copies of every byte.
  //
  // We can't reach VS Code's xterm DOM from this harness (the workbench
  // panel only mounts after a user gesture), so we exercise the lower
  // bus layer directly: simulate two pty `open()` calls by attaching two
  // listeners that BOTH call `bus.request('proc.spawn')`, then ensure
  // `bus.on('proc.stdout')` events for a single typed line still arrive
  // exactly once per subscriber. The fix's invariant is that the
  // *underlying* busServer emits each stdout chunk once — duplication
  // came from doubled subscribers, never from the source.
  const commander = await tryLoadBrowserCommander();
  if (bailIfMissingPrereqs(t, { commander })) return;

  const server = await startDevServer({ basePrefix: BASE_PREFIX });
  t.after(() => server.stop());

  await withWorkbench(server.url, async ({ page, errors, diagnostics }) => {
    const vmPhase = await waitForLinux(page, { diagnostics: { ...diagnostics, errors } });
    assert.equal(vmPhase, 'ready');

    // Drive the bus directly: spawn a "shell subscriber", record every
    // proc.stdout chunk for two seconds while we send a recognisable
    // line, then count occurrences of the marker. The marker is unique
    // enough that it cannot legitimately appear twice in the stream.
    const result = await page.evaluate(async () => {
      const channel = new BroadcastChannel('rust-web-box/webvm-bus');
      const inbox = [];
      const onMessage = (ev) => {
        const msg = ev.data;
        if (msg?.kind === 'event' && msg.topic === 'proc.stdout' && msg.payload?.chunk) {
          inbox.push(msg.payload.chunk);
        }
      };
      channel.addEventListener('message', onMessage);

      // Helper: bus.request via promise.
      function request(method, params) {
        return new Promise((resolve, reject) => {
          const id = Math.floor(Math.random() * 1_000_000_000);
          const handler = (ev) => {
            const m = ev.data;
            if (!m || m.kind !== 'response' || m.id !== id) return;
            channel.removeEventListener('message', handler);
            if (m.error) reject(new Error(m.error.message));
            else resolve(m.result);
          };
          channel.addEventListener('message', handler);
          channel.postMessage({ id, kind: 'request', method, params });
          setTimeout(() => {
            channel.removeEventListener('message', handler);
            reject(new Error(`timeout: ${method}`));
          }, 30_000);
        });
      }

      // First: simulate two pty `open()` cycles. Before the issue #27
      // fix this is exactly what the extension did, leaking subscribers.
      // We do it at the bus layer so we exercise the same
      // proc.spawn/proc.write code path, but we never DOUBLE-subscribe
      // here — the bus itself only ever emits once per chunk, and that's
      // the invariant we're guarding.
      await request('proc.spawn', {});
      await request('proc.spawn', {});

      // Sentinel marker the test will count.
      const MARKER = 'rwb_dup_check_' + Math.random().toString(36).slice(2, 10);
      const line = `echo ${MARKER}\n`;
      const bytes = Array.from(new TextEncoder().encode(line));
      await request('proc.write', { bytes });

      // Drain stdout for ~3s — bash's prompt cycle plus echo + output
      // completes well within this window.
      await new Promise((r) => setTimeout(r, 3_000));
      channel.removeEventListener('message', onMessage);
      channel.close();

      const joined = inbox.join('');
      // Count non-overlapping occurrences of the marker.
      let count = 0;
      let from = 0;
      while (true) {
        const at = joined.indexOf(MARKER, from);
        if (at < 0) break;
        count += 1;
        from = at + MARKER.length;
      }
      return { marker: MARKER, count, sampleLength: joined.length };
    });

    // Bash echoes the typed line once (the input echo) and then runs
    // `echo MARKER`, which prints the marker once on its own line — so a
    // *correctly-behaving* stream contains the marker exactly twice. The
    // pre-fix (doubled-listener) regression would have exposed it as 4
    // (each chunk delivered twice). Anything > 2 is the regression
    // returning; anything < 2 means our `echo` never executed.
    assert.equal(
      result.count, 2,
      `marker ${result.marker} should appear exactly 2x in proc.stdout (one bash echo + one program output), saw ${result.count} in ${result.sampleLength} bytes`,
    );
  }, { commander });
});
