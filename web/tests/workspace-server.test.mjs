// Tests for the stage-1 workspace-only bus method table.
//
// We verify:
//   * Every fs.* method delegates to the underlying workspace store.
//   * proc.* methods reject with VM_BOOTING (stage 1 has no VM).
//   * vm.status reports `booted: false, stage: 'workspace-only'`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { workspaceOnlyMethods } from '../glue/workspace-server.js';

function fakeWorkspace() {
  const calls = [];
  return {
    calls,
    stat: async (path) => {
      calls.push(['stat', path]);
      return { type: 1, size: 9, ctime: 0, mtime: 0 };
    },
    readDirectory: async (path) => {
      calls.push(['readDirectory', path]);
      return [['src', 2], ['Cargo.toml', 1]];
    },
    readFile: async (path) => {
      calls.push(['readFile', path]);
      return new Uint8Array([1, 2, 3]);
    },
    writeFile: async (path, bytes, opts) => {
      calls.push(['writeFile', path, Array.from(bytes), opts]);
    },
    delete: async (path, opts) => {
      calls.push(['delete', path, opts]);
    },
    rename: async (from, to) => {
      calls.push(['rename', from, to]);
    },
    createDirectory: async (path) => {
      calls.push(['createDirectory', path]);
    },
    snapshot: async () => ({}),
  };
}

test('workspace-server: vm.status reports stage 1', async () => {
  const ws = fakeWorkspace();
  const m = workspaceOnlyMethods({ workspace: ws });
  const r = await m['vm.status']();
  assert.equal(r.booted, false);
  assert.equal(r.stage, 'workspace-only');
});

test('workspace-server: fs.* methods delegate to the workspace', async () => {
  const ws = fakeWorkspace();
  const m = workspaceOnlyMethods({ workspace: ws });
  await m['fs.stat']({ path: '/workspace' });
  await m['fs.readDir']({ path: '/workspace' });
  await m['fs.readFile']({ path: '/workspace/src/main.rs' });
  await m['fs.writeFile']({
    path: '/workspace/src/main.rs',
    data: [4, 5, 6],
    options: { create: true, overwrite: true },
  });
  await m['fs.delete']({ path: '/workspace/x', recursive: true });
  await m['fs.rename']({ from: '/a', to: '/b' });
  await m['fs.createDirectory']({ path: '/workspace/sub' });
  assert.deepEqual(ws.calls, [
    ['stat', '/workspace'],
    ['readDirectory', '/workspace'],
    ['readFile', '/workspace/src/main.rs'],
    ['writeFile', '/workspace/src/main.rs', [4, 5, 6], { create: true, overwrite: true }],
    ['delete', '/workspace/x', { recursive: true }],
    ['rename', '/a', '/b'],
    ['createDirectory', '/workspace/sub'],
  ]);
});

test('workspace-server: proc.spawn / write / wait reject with VM_BOOTING', async () => {
  const ws = fakeWorkspace();
  const m = workspaceOnlyMethods({ workspace: ws });
  for (const name of ['proc.spawn', 'proc.write', 'proc.wait']) {
    let err;
    try { await m[name]({}); } catch (e) { err = e; }
    assert.ok(err, `${name} should reject`);
    assert.equal(err.code, 'VM_BOOTING');
  }
});

test('workspace-server: proc.resize and proc.kill are no-ops in stage 1', async () => {
  const ws = fakeWorkspace();
  const m = workspaceOnlyMethods({ workspace: ws });
  await m['proc.resize']({ cols: 80, rows: 24 });
  await m['proc.kill']({ sub: 1 });
  // No throws is the assertion.
});

test('workspace-server: throws when workspace is missing', () => {
  assert.throws(() => workspaceOnlyMethods({}), /requires a workspace/);
});
