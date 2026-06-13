// Full UI-driven end-to-end suite for the rust-web-box workbench.
//
// What this guards against (issue #41, konard's PR #42 request):
//   "We can also have some full e2e tests, that also are runned as manual
//    dispatch, that verify exactly all steps. First cargo run + output,
//    file change (using VS Code UI - editor), cargo run + verify output
//    (all using VS Code terminal)."
//
// Unlike `local-pages-e2e.test.mjs` (which drives the VM through `cx.run`
// and the bus, with the interactive bash *disabled* to dodge the CheerpX
// 1.3.x OverlayDevice 'a1' wedge), this suite exercises the **actual UI a
// user touches**:
//
//   Step 1 — type `cargo run` into the real integrated terminal (xterm),
//            press Enter, and verify the seed greeting "Hello, world!"
//            appears in the terminal output.
//   Step 2 — edit /workspace/src/main.rs in the real Monaco editor
//            (select-all, replace with a uniquely-marked greeting), and
//            save with Ctrl+S — the genuine VS Code FileSystemProvider
//            save path.
//   Step 3 — type `cargo run` again in the terminal and verify the *new*
//            unique marker appears AND that cargo printed "Compiling".
//
// Steps 2+3 together are the anti-fake proof the issue demands: a cached
// or pre-baked binary cannot print a marker that did not exist until this
// run, and "Compiling" proves CheerpX genuinely re-invoked rustc inside
// the VM rather than replaying a stale artifact.
//
// Why this needs the real shell + prime (skipPrime:false, skipBash:false):
//   The terminal keystroke path is handleInput -> proc.write ->
//   `cx.setCustomConsole` reader -> the long-lived `/bin/bash --login`
//   loop (`runShellLoop` in webvm-server.js). With `__RUST_WEB_BOX_SKIP_BASH`
//   set (the default for the other suites) that loop never starts, so
//   keystrokes go nowhere. Booting the real bash is only safe on a disk
//   whose seed inodes all already exist (the warm rust-alpine image or a
//   freshly built one), because the prime then only overwrites existing
//   inodes and never allocates the fresh ones that trip the 'a1' wedge.
//
// This is a *slow* suite by design (a real debug rebuild inside CheerpX
// is minutes long — that is the very thing issue #41 measures), so it is
// dispatched on demand via `.github/workflows/ui-e2e.yml`, never on push.
// Locally it soft-skips unless RUST_WEB_BOX_E2E=1 (and a browser + warm
// disk are present), exactly like the other e2e suites.
//
// To run with a visible browser locally (needs a staged warm disk):
//   RUST_WEB_BOX_E2E=1 RUST_WEB_BOX_E2E_HEADED=1 \
//     node --test web/tests/e2e/ui-driven-e2e.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  DEFAULT_BOOT_TIMEOUT_MS,
  E2E_REQUIRED,
  WEB_ROOT,
  isWarmDiskStaged,
  startDevServer,
  tryLoadBrowserCommander,
  waitForLinux,
  withWorkbench,
} from '../helpers/cheerpx-page-harness.mjs';

const BASE_PREFIX = '/rust-web-box';

// Step 1 (`cargo run` on the pre-baked debug binary) is fast; Step 3 is a
// real rebuild and can take minutes inside CheerpX. Both budgets are
// overridable so a slow CI runner can be given more headroom without an
// edit.
const RUN1_TIMEOUT_MS = Number.parseInt(process.env.RUST_WEB_BOX_UI_RUN1_MS || '180000', 10);
const REBUILD_TIMEOUT_MS = Number.parseInt(process.env.RUST_WEB_BOX_UI_REBUILD_MS || '420000', 10);
// Where to drop human-reviewable evidence (terminal transcript + final
// screenshot). The workflow sets this and uploads the directory.
const ARTIFACT_DIR = process.env.RUST_WEB_BOX_UI_ARTIFACT_DIR || '';

function vendoredCheerpx() {
  return existsSync(path.join(WEB_ROOT, 'cheerpx', 'cx.esm.js'));
}

function vendoredVSCodeWeb() {
  return existsSync(path.join(WEB_ROOT, 'vscode-web', 'out', 'vs', 'workbench', 'workbench.web.main.js'));
}

/**
 * Soft-skip (or hard-fail under RUST_WEB_BOX_E2E=1) for every prerequisite
 * this UI suite needs but cannot bootstrap on its own. Returns `true` when
 * the test should bail.
 */
function bailIfMissingPrereqs(t, { commander }) {
  if (!E2E_REQUIRED && process.env.RUST_WEB_BOX_E2E_NO_SANDBOX !== '1') {
    t.skip('set RUST_WEB_BOX_E2E=1 to run the UI-driven e2e suite');
    return true;
  }
  if (!commander) {
    if (E2E_REQUIRED) throw new Error('browser-commander is required when RUST_WEB_BOX_E2E=1');
    t.skip('browser-commander / playwright not installed; skipping UI e2e');
    return true;
  }
  if (!vendoredCheerpx()) {
    if (E2E_REQUIRED) {
      throw new Error('web/cheerpx/cx.esm.js missing — run `node web/build/build-workbench.mjs` first');
    }
    t.skip('CheerpX not vendored; run `node web/build/build-workbench.mjs` first');
    return true;
  }
  if (!vendoredVSCodeWeb()) {
    if (E2E_REQUIRED) {
      throw new Error('web/vscode-web/out/vs/workbench/workbench.web.main.js missing — run `node web/build/build-workbench.mjs` first');
    }
    t.skip('VS Code Web not vendored; run `node web/build/build-workbench.mjs` first');
    return true;
  }
  if (!isWarmDiskStaged()) {
    // The UI suite types real `cargo run` commands and asserts on the
    // seed greeting + a fresh rebuild. Both need the rust-alpine warm
    // disk (it bakes cargo, the toolchain, and the pre-built binary); the
    // public Debian fallback can't satisfy them. Booting the real
    // interactive bash is also only 'a1'-wedge-safe on this disk.
    if (E2E_REQUIRED) {
      throw new Error(
        'warm rust-alpine disk is not staged under web/disk/ — run ' +
        '`WARM_DISK_SOURCE_URL=https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2 ' +
        'node web/build/stage-pages-disk.mjs` first',
      );
    }
    t.skip('warm rust-alpine disk not staged; run web/build/stage-pages-disk.mjs to enable UI e2e');
    return true;
  }
  return false;
}

/**
 * One bus round-trip (same channel + envelope VS Code's extension uses).
 * Used here only for read-only verification (`fs.readFile`) so it never
 * touches the interactive console the real bash owns.
 */
async function requestWorkbenchBus(page, method, params, { timeoutMs = 60_000 } = {}) {
  return await page.evaluate(async ({ method, params, timeoutMs }) => {
    const channel = new BroadcastChannel('rust-web-box/webvm-bus');
    const id = Math.floor(Math.random() * 1_000_000_000);
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`bus request timed out: ${method}`)),
          timeoutMs,
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
  }, { method, params, timeoutMs });
}

/**
 * Install a sibling BroadcastChannel that records every `proc.stdout`
 * chunk the page-side bus server emits. BroadcastChannel does not deliver
 * to the exact instance that posted, but a *separate* instance in the same
 * page does receive them — so this faithfully mirrors what the terminal
 * sees, independent of VS Code's xterm DOM. Bounded so a runaway build log
 * can't exhaust page memory.
 */
async function installStdoutCollector(page) {
  await page.evaluate(() => {
    if (globalThis.__rwbUiStdoutChannel) return;
    globalThis.__rwbUiStdout = '';
    const ch = new BroadcastChannel('rust-web-box/webvm-bus');
    ch.addEventListener('message', (ev) => {
      const m = ev.data;
      if (m && m.kind === 'event' && m.topic === 'proc.stdout' && m.payload && typeof m.payload.chunk === 'string') {
        globalThis.__rwbUiStdout += m.payload.chunk;
        if (globalThis.__rwbUiStdout.length > 2_000_000) {
          globalThis.__rwbUiStdout = globalThis.__rwbUiStdout.slice(-1_500_000);
        }
      }
    });
    globalThis.__rwbUiStdoutChannel = ch;
  });
}

async function readStdout(page) {
  return await page.evaluate(() => globalThis.__rwbUiStdout || '');
}

/**
 * Extract the first `println!("…")` literal from Rust source and decode the
 * handful of escapes a hello-world greeting can contain. Mirrors
 * `firstSourceGreeting` in the harness so Step 1 asserts on whatever the
 * staged disk actually seeds — robust across the version-skew window where a
 * PR build may stage a previously published disk image. Returns null when no
 * println is found.
 */
function extractGreeting(source) {
  const m = String(source).match(/println!\(\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  return m[1]
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\');
}

// Strip CSI/SGR escapes (cargo colourises "Compiling"/"Finished") so plain
// substring assertions are robust. The server already filters the
// workspace-sync and cargo-bench OSC frames before they reach proc.stdout.
function stripAnsi(s) {
  return String(s)
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[\[\]][0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[=>]/g, '');
}

/**
 * Poll the captured terminal output until the slice after `sinceIndex`
 * contains every needle in `contains`. Throws a diagnostic error (with the
 * tail of what we did see) on timeout so a stuck build or a corrupted edit
 * surfaces its cause, not just "timed out".
 */
async function waitForTerminalOutput(page, { contains, sinceIndex = 0, timeoutMs, label, intervalMs = 2000 }) {
  const needles = Array.isArray(contains) ? contains : [contains];
  const deadline = Date.now() + timeoutMs;
  let lastDelta = '';
  for (;;) {
    const full = await readStdout(page);
    const delta = stripAnsi(full.slice(sinceIndex));
    lastDelta = delta;
    if (needles.every((n) => delta.includes(n))) return { full, deltaStart: sinceIndex };
    if (Date.now() >= deadline) {
      const tail = lastDelta.slice(-3000);
      throw new Error(
        `[ui-e2e] timed out after ${timeoutMs}ms waiting for ${label} ` +
        `(needed all of ${JSON.stringify(needles)}).\n` +
        `--- terminal output tail (ANSI-stripped) ---\n${tail}`,
      );
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

/**
 * Focus the integrated terminal's xterm surface so subsequent
 * page.keyboard input is delivered as real keystrokes
 * (handleInput -> proc.write). Tries a few selectors across VS Code
 * versions.
 */
async function focusTerminal(page) {
  const selectors = [
    '.terminal-wrapper.active .xterm-screen',
    '.terminal-outer-container .xterm-screen',
    '.xterm-screen',
    '.terminal .xterm',
    '.xterm',
  ];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      return sel;
    }
  }
  throw new Error('[ui-e2e] could not find the integrated terminal (.xterm) to focus');
}

/**
 * Focus the Monaco editor showing main.rs. Clicks the main.rs tab first
 * (it auto-opens active, but a stray welcome tab could steal focus), then
 * clicks the visible text region so the caret lands in the document.
 */
async function focusMainEditor(page) {
  const tab = await page.$('.tab[aria-label*="main.rs"]');
  if (tab) {
    try { await tab.click(); } catch { /* tab may already be active */ }
  }
  const selectors = [
    '.editor-group-container.active .monaco-editor .view-lines',
    '.editor-instance .monaco-editor .view-lines',
    '.monaco-editor .view-lines',
  ];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el) {
      await el.click();
      return sel;
    }
  }
  throw new Error('[ui-e2e] could not find the main.rs Monaco editor to focus');
}

/** Type a command into the focused terminal and submit it with Enter. */
async function runInTerminal(page, command) {
  await page.keyboard.type(command, { delay: 8 });
  await page.keyboard.press('Enter');
}

/**
 * Handshake: prove the terminal is wired end-to-end AND that bash is
 * actually executing commands (xterm -> proc.write -> bash -> proc.stdout
 * -> our collector) before we depend on it.
 *
 * We deliberately do NOT just `echo` a literal sentinel: the tty echoes
 * typed keystrokes back to stdout, so a literal would "appear" even if bash
 * never ran it. Instead we echo an arithmetic *expansion* — the typed
 * command contains `$((21 * 2))` but only an executing shell turns that into
 * `42`. Waiting for the computed form proves real execution, not echo.
 *
 * Retries because the pty's open() (which calls proc.spawn) fires shortly
 * after the extension reveals the terminal, and keystrokes typed before
 * that are dropped.
 */
async function waitForLiveTerminal(page, nonce) {
  const expected = `RWB_TERM_READY_${nonce}_42`;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await focusTerminal(page);
    // Typed text holds `$((21 * 2))`; the executed output holds `_42`.
    await runInTerminal(page, `echo RWB_TERM_READY_${nonce}_$((21 * 2))`);
    try {
      await waitForTerminalOutput(page, {
        contains: expected,
        label: `terminal handshake (attempt ${attempt})`,
        timeoutMs: 6000,
        intervalMs: 500,
      });
      return;
    } catch {
      // pty not live yet — reveal/focus and retry.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  const tail = stripAnsi(await readStdout(page)).slice(-2000);
  throw new Error(
    `[ui-e2e] integrated terminal never became interactive ` +
    `(computed sentinel ${expected} never appeared).\n` +
    `--- terminal output tail ---\n${tail}`,
  );
}

function writeArtifact(name, contents) {
  if (!ARTIFACT_DIR) return;
  try {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    writeFileSync(path.join(ARTIFACT_DIR, name), contents);
  } catch (err) {
    // Evidence is best-effort; never fail the test over it.
    // eslint-disable-next-line no-console
    console.warn(`[ui-e2e] could not write artifact ${name}:`, err?.message ?? err);
  }
}

async function screenshotArtifact(page, name) {
  if (!ARTIFACT_DIR) return;
  try {
    mkdirSync(ARTIFACT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(ARTIFACT_DIR, name), fullPage: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[ui-e2e] could not capture screenshot ${name}:`, err?.message ?? err);
  }
}

test(
  'ui e2e: cargo run → edit main.rs in the editor → cargo run reflects the edit (issue #41)',
  { timeout: DEFAULT_BOOT_TIMEOUT_MS + RUN1_TIMEOUT_MS + REBUILD_TIMEOUT_MS + 180_000 },
  async (t) => {
    const commander = await tryLoadBrowserCommander();
    if (bailIfMissingPrereqs(t, { commander })) return;

    const server = await startDevServer({ basePrefix: BASE_PREFIX });
    t.after(() => server.stop());

    // Unique per run so a cached/pre-baked binary cannot possibly print it.
    const nonce = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    const marker = `Hello, ui-e2e ${nonce}!`;
    const editedSource = `fn main() {\n    println!("${marker}");\n}\n`;

    await withWorkbench(server.url, async ({ page, errors, diagnostics }) => {
      // Boot the real interactive shell + workspace prime (see file header).
      const vmPhase = await waitForLinux(page, { diagnostics: { ...diagnostics, errors } });
      assert.equal(vmPhase, 'ready', 'expected CheerpX to reach vmPhase=ready');

      // The workbench chrome and the auto-opened editor + terminal must
      // actually mount before we drive them.
      await page.waitForSelector('.monaco-workbench.vs-dark', { timeout: 60_000 });
      await page.waitForSelector('.monaco-editor .view-lines', { timeout: 60_000 });
      await page.waitForSelector('.xterm', { timeout: 60_000 });

      await installStdoutCollector(page);

      // Confirm the terminal is interactive end-to-end before we rely on it.
      await waitForLiveTerminal(page, nonce);

      // Read the seed greeting straight off the guest workspace so Step 1
      // asserts on whatever this disk actually seeds, not a hardcoded string
      // (the same version-skew guard `firstSourceGreeting` uses).
      const seedBytes = await requestWorkbenchBus(page, 'fs.readFile', { path: '/workspace/src/main.rs' });
      const seedSource = Buffer.from(seedBytes).toString('utf8');
      const seedGreeting = extractGreeting(seedSource);
      assert.ok(seedGreeting, `expected a println! greeting in the seed main.rs, got:\n${seedSource}`);
      // The seed must differ from our marker, else Step 3's check is hollow.
      assert.ok(!seedGreeting.includes(nonce), 'seed greeting unexpectedly already contains the run nonce');

      // === Step 1: first `cargo run` in the real terminal ===
      // The disk pre-bakes the debug binary, so this finishes quickly and
      // prints the seed greeting (typically "Hello, world!").
      const run1Start = (await readStdout(page)).length;
      await focusTerminal(page);
      await runInTerminal(page, 'cargo run');
      await waitForTerminalOutput(page, {
        contains: seedGreeting,
        sinceIndex: run1Start,
        label: `Step 1: first \`cargo run\` seed greeting (${JSON.stringify(seedGreeting)})`,
        timeoutMs: RUN1_TIMEOUT_MS,
      });

      // === Step 2: edit main.rs through the real Monaco editor ===
      // insertText delivers the replacement as a single bulk input event
      // (like a paste), which bypasses Monaco's per-keystroke auto-closing
      // of brackets/quotes — so the source lands verbatim.
      await focusMainEditor(page);
      await page.keyboard.press('Control+A');
      await page.keyboard.insertText(editedSource);
      await page.keyboard.press('Control+S');

      // The genuine VS Code save path is editor -> FileSystemProvider ->
      // bus `fs.writeFile`, which writes the guest file (awaited) *before*
      // the JS workspace store. So once `fs.readFile` (the store) shows the
      // marker, the guest copy cargo will read is already updated too.
      let savedSource = '';
      const saveDeadline = Date.now() + 30_000;
      for (;;) {
        const bytes = await requestWorkbenchBus(page, 'fs.readFile', { path: '/workspace/src/main.rs' });
        savedSource = Buffer.from(bytes).toString('utf8');
        if (savedSource.includes(marker)) break;
        if (Date.now() >= saveDeadline) {
          throw new Error(
            `[ui-e2e] editor save did not reach /workspace/src/main.rs within 30s.\n` +
            `--- last read content ---\n${savedSource}`,
          );
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      assert.match(savedSource, /fn\s+main/, 'edited source must still define fn main');
      assert.ok(savedSource.includes('println!'), 'edited source must keep the println! call');
      assert.ok(savedSource.includes(marker), 'edited source must contain the unique marker');

      // === Step 3: second `cargo run` must reflect the edit ===
      // The save staled cargo's fingerprints, so this is a *real* rebuild.
      // Anti-fake: the brand-new marker can only appear if the edited
      // source compiled and ran, and "Compiling" proves CheerpX re-invoked
      // rustc rather than replaying the pre-baked binary.
      const run2Start = (await readStdout(page)).length;
      await focusTerminal(page);
      await runInTerminal(page, 'cargo run');
      await waitForTerminalOutput(page, {
        contains: [marker, 'Compiling'],
        sinceIndex: run2Start,
        label: 'Step 3: rebuilt `cargo run` output (marker + Compiling)',
        timeoutMs: REBUILD_TIMEOUT_MS,
      });

      // Evidence for human review (uploaded by the workflow).
      const transcript = stripAnsi(await readStdout(page));
      writeArtifact('ui-e2e-terminal.txt', transcript);
      writeArtifact(
        'ui-e2e-report.md',
        [
          '# UI-driven e2e — issue #41',
          '',
          `- marker: \`${marker}\``,
          `- Step 1 \`cargo run\`: seed greeting \`${JSON.stringify(seedGreeting)}\` observed ✅`,
          '- Step 2 editor save: marker reached /workspace/src/main.rs ✅',
          '- Step 3 rebuilt `cargo run`: marker + "Compiling" observed ✅',
          '',
          '## Edited source (read back from the guest workspace)',
          '```rust',
          savedSource.trimEnd(),
          '```',
          '',
          '## Terminal transcript (ANSI-stripped)',
          '```',
          transcript.slice(-8000),
          '```',
          '',
        ].join('\n'),
      );
      await screenshotArtifact(page, 'ui-e2e-final.png');

      // No fatal CheerpX runtime error must have leaked during the run.
      const fatal = errors.filter((e) => /CheerpException|Program exited with code 71|function signature mismatch/.test(e));
      assert.deepEqual(fatal, [], `unexpected fatal CheerpX errors:\n${fatal.join('\n')}`);
    }, { commander, skipPrime: false, skipBash: false, bootTimeoutMs: DEFAULT_BOOT_TIMEOUT_MS });
  },
);
