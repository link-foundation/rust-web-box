// Issue #43: the iPad-Safari silent-shell advisory must show diagnostics
// in the **VS Code terminal**, not in a "open the browser console" hint
// that iPadOS Safari doesn't offer.
//
// These tests cover three layers of that flow:
//   1. `formatDiagnosticsForTerminal(dumpRuntime(...))` renders the
//      runtime snapshot as a compact, terminal-friendly block.
//   2. `dumpRuntime` exposes the silent-shell signals
//      (outputBytes / silentSpawns / slowFirstOutput) so the terminal
//      block can explain a blank prompt.
//   3. The server-side silent-shell advisory streams that block over the
//      bus on `vm.shell {healthy:false}` instead of pointing the user at
//      a console they can't reach.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dumpRuntime, formatDiagnosticsForTerminal } from '../glue/debug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');

function fakeGlobal({ ua = 'Mozilla/5.0 iPad', shell = null } = {}) {
  return {
    location: { href: 'https://link-foundation.github.io/rust-web-box/' },
    navigator: { userAgent: ua, platform: 'MacIntel', maxTouchPoints: 5 },
    crossOriginIsolated: true,
    SharedArrayBuffer: function () {},
    __rustWebBox: {
      browser: { id: 'safari-ipad', isSafari: true, isIOS: true, isIPad: true },
      vmPhase: 'syncing-workspace',
      vmServer: shell ? { runtime: { shellLoop: shell } } : null,
    },
  };
}

test('dumpRuntime surfaces the silent-shell signals from the shellLoop diag (issue #43)', () => {
  const dump = dumpRuntime(
    fakeGlobal({
      shell: {
        healthy: false,
        running: false,
        spawns: 12,
        exits: 12,
        errors: 0,
        fastCycles: 11,
        outputBytes: 0,
        silentSpawns: 3,
        slowFirstOutput: true,
        lastExitCode: 71,
        lastError: 'TypeError reading "a1"',
      },
    }),
  );
  assert.deepEqual(dump.shellLoop, {
    healthy: false,
    running: false,
    spawns: 12,
    exits: 12,
    errors: 0,
    fastCycles: 11,
    outputBytes: 0,
    silentSpawns: 3,
    slowFirstOutput: true,
    lastExitCode: 71,
    lastError: 'TypeError reading "a1"',
  });
});

test('formatDiagnosticsForTerminal renders the iPad-Safari signature in plain text', () => {
  const dump = dumpRuntime(
    fakeGlobal({
      shell: {
        healthy: false,
        spawns: 4,
        exits: 4,
        errors: 0,
        fastCycles: 3,
        outputBytes: 0,
        silentSpawns: 4,
        slowFirstOutput: true,
        lastExitCode: 0,
      },
    }),
  );
  const block = formatDiagnosticsForTerminal(dump);
  assert.match(block, /rust-web-box diagnostics/);
  assert.match(block, /browser: safari-ipad/);
  assert.match(block, /Safari/);
  assert.match(block, /iPad/);
  assert.match(block, /isolation: crossOriginIsolated=yes/);
  assert.match(block, /shell: healthy=no/);
  assert.match(block, /silentSpawns=4/);
  assert.match(block, /outputBytes=0/);
  // Default ansi=off → no escape codes (test-friendly, log-friendly).
  assert.doesNotMatch(block, /\x1b\[/);
});

test('formatDiagnosticsForTerminal can emit ANSI dim + \\r\\n line endings for a pty', () => {
  const dump = dumpRuntime(fakeGlobal());
  const block = formatDiagnosticsForTerminal(dump, { ansi: true, eol: '\r\n' });
  assert.match(block, /\r\n/);
  assert.match(block, /\x1b\[2m/, 'dim escape opens');
  assert.match(block, /\x1b\[0m/, 'reset escape closes');
});

test('formatDiagnosticsForTerminal handles a missing shellLoop gracefully', () => {
  const dump = dumpRuntime(fakeGlobal()); // shellLoop=null
  const block = formatDiagnosticsForTerminal(dump);
  assert.match(block, /shell: not started/);
});

test('webvm-server: the silent-shell advisory no longer points at the browser console (issue #43)', async () => {
  const src = await fs.readFile(path.join(WEB_ROOT, 'glue/webvm-server.js'), 'utf8');
  // Strip JS line comments — they document the change for code readers and
  // may legitimately mention "browser console". The assertion targets the
  // user-facing strings actually emitted to the terminal.
  const stripped = src.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    stripped,
    /Diagnostics: run [`'"][^`'"]*__rustWebBox\.dump/,
    'the old "Diagnostics: run __rustWebBox.dump()" advisory must be gone',
  );
  assert.doesNotMatch(
    stripped,
    /in the browser console/i,
    'no user-facing string may tell iPadOS users to use a browser console',
  );
  // It must call the new terminal formatter on the unhealthy path.
  assert.match(
    src,
    /formatDiagnosticsForTerminal/,
    'webvm-server must render diagnostics into the terminal',
  );
});

test('webvm-server: vm.diagnostics method returns a structured snapshot + terminal block', async () => {
  const src = await fs.readFile(path.join(WEB_ROOT, 'glue/webvm-server.js'), 'utf8');
  assert.match(src, /'vm\.diagnostics'/);
  assert.match(src, /terminalText:/);
});

test('webvm-host extension contributes the "Show Diagnostics in Terminal" command', async () => {
  const pkg = JSON.parse(
    await fs.readFile(
      path.join(WEB_ROOT, 'extensions/webvm-host/package.json'),
      'utf8',
    ),
  );
  const cmd = pkg.contributes.commands.find(
    (c) => c.command === 'webvm-host.showDiagnostics',
  );
  assert.ok(cmd, 'webvm-host.showDiagnostics must be contributed');
  assert.match(cmd.title, /Diagnostics/);

  const ext = await fs.readFile(
    path.join(WEB_ROOT, 'extensions/webvm-host/extension.js'),
    'utf8',
  );
  assert.match(ext, /registerCommand\('webvm-host\.showDiagnostics'/);
  assert.match(ext, /bus\.request\('vm\.diagnostics'\)/);
  assert.match(ext, /WebVM Diagnostics/);
});

test('boot.js shell-unhealthy warning points at the new VS Code command, not the browser console', async () => {
  const src = await fs.readFile(path.join(WEB_ROOT, 'glue/boot.js'), 'utf8');
  assert.match(src, /Show Diagnostics in Terminal/);
  assert.doesNotMatch(src, /browser console/i);
});
