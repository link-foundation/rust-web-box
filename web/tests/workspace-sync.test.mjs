import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKSPACE_SYNC_OSC_END,
  WORKSPACE_SYNC_OSC_PREFIX,
  applyWorkspaceSyncSnapshot,
  buildGuestSyncProfileBlock,
  createWorkspaceSyncFrameParser,
  decodeWorkspaceSyncPayload,
} from '../glue/workspace-sync.js';

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64(input) {
  return Buffer.from(input).toString('base64');
}

function payload(lines) {
  return b64(['RWB_SYNC_V1', ...lines, ''].join('\n'));
}

function makeWorkspace(files = {}) {
  const entries = new Map();
  entries.set('/workspace', { type: 2 });
  for (const [path, text] of Object.entries(files)) {
    entries.set(path, { type: 1, data: enc.encode(text) });
    const dir = path.replace(/\/[^/]+$/, '');
    entries.set(dir, { type: 2 });
  }
  return {
    entries,
    async stat(path) {
      const entry = entries.get(path);
      if (!entry) {
        const err = new Error(`ENOENT: ${path}`);
        err.code = 'FileNotFound';
        throw err;
      }
      return { type: entry.type, size: entry.data?.byteLength ?? entry.size ?? 0, mtime: 0 };
    },
    async readFile(path) {
      const entry = entries.get(path);
      if (!entry || entry.type !== 1) {
        const err = new Error(`ENOENT: ${path}`);
        err.code = 'FileNotFound';
        throw err;
      }
      return entry.data;
    },
    async writeFile(path, bytes) {
      entries.set(path, { type: 1, data: bytes });
    },
    async writeMetadataFile(path, { size = 0 } = {}) {
      entries.set(path, { type: 1, metadataOnly: true, size });
    },
    async createDirectory(path) {
      entries.set(path, { type: 2 });
    },
    async delete(path) {
      entries.delete(path);
    },
  };
}

test('workspace-sync: parser strips OSC frames and handles split chunks', () => {
  const frames = [];
  const parser = createWorkspaceSyncFrameParser({ onFrame: (p) => frames.push(p) });
  const encoded = payload([
    `D\t${b64('/workspace/src')}`,
    `F\t${b64('/workspace/src/main.rs')}\t${b64('fn main() {}\n')}`,
  ]);

  assert.equal(parser.filter(`before ${WORKSPACE_SYNC_OSC_PREFIX}${encoded.slice(0, 6)}`), 'before ');
  assert.equal(parser.filter(`${encoded.slice(6)}${WORKSPACE_SYNC_OSC_END} after`), ' after');
  assert.deepEqual(frames, [encoded]);
  assert.equal(parser.flush(), '');
});

test('workspace-sync: decodes snapshot payloads', () => {
  const snapshot = decodeWorkspaceSyncPayload(payload([
    `D\t${b64('/workspace/src')}`,
    `F\t${b64('/workspace/src/main.rs')}\t${b64('hello\n')}`,
    `S\t${b64('/workspace/target/debug/hello')}\t12345`,
    `F\t${b64('/tmp/outside')}\t${b64('ignored\n')}`,
  ]));

  assert.deepEqual(snapshot.dirs, ['/workspace/src']);
  assert.deepEqual(snapshot.files.map((f) => [f.path, dec.decode(f.bytes)]), [
    ['/workspace/src/main.rs', 'hello\n'],
  ]);
  assert.deepEqual(snapshot.skippedFiles, [
    { path: '/workspace/target/debug/hello', size: 12345 },
  ]);
});

test('workspace-sync: applies creates, updates, and deletes from guest snapshots', async () => {
  const workspace = makeWorkspace({
    '/workspace/src/main.rs': 'old\n',
    '/workspace/deleted.txt': 'remove me\n',
  });
  const state = {
    knownPaths: new Set([
      '/workspace/src',
      '/workspace/src/main.rs',
      '/workspace/deleted.txt',
    ]),
  };
  const snapshot = decodeWorkspaceSyncPayload(payload([
    `D\t${b64('/workspace/src')}`,
    `D\t${b64('/workspace/newdir')}`,
    `F\t${b64('/workspace/src/main.rs')}\t${b64('new\n')}`,
    `F\t${b64('/workspace/newdir/created.txt')}\t${b64('created\n')}`,
  ]));

  await applyWorkspaceSyncSnapshot(workspace, snapshot, state);

  assert.equal(dec.decode(await workspace.readFile('/workspace/src/main.rs')), 'new\n');
  assert.equal(dec.decode(await workspace.readFile('/workspace/newdir/created.txt')), 'created\n');
  await assert.rejects(
    () => workspace.stat('/workspace/deleted.txt'),
    /ENOENT/,
  );
  assert.deepEqual([...state.knownPaths].sort(), [
    '/workspace/newdir',
    '/workspace/newdir/created.txt',
    '/workspace/src',
    '/workspace/src/main.rs',
  ]);
});

test('workspace-sync: keeps oversized guest files marked as skipped', async () => {
  const workspace = makeWorkspace({
    '/workspace/large.bin': 'existing\n',
  });
  const state = {
    knownPaths: new Set(['/workspace/large.bin']),
  };
  const snapshot = decodeWorkspaceSyncPayload(payload([
    `S\t${b64('/workspace/large.bin')}`,
  ]));

  await applyWorkspaceSyncSnapshot(workspace, snapshot, state);

  assert.equal(dec.decode(await workspace.readFile('/workspace/large.bin')), 'existing\n');
  assert.deepEqual([...state.knownPaths], ['/workspace/large.bin']);
});

test('workspace-sync: creates metadata entries for skipped target files', async () => {
  const workspace = makeWorkspace();
  const state = { knownPaths: new Set() };
  const snapshot = decodeWorkspaceSyncPayload(payload([
    `D\t${b64('/workspace/target')}`,
    `D\t${b64('/workspace/target/debug')}`,
    `S\t${b64('/workspace/target/debug/hello')}\t7352`,
  ]));

  await applyWorkspaceSyncSnapshot(workspace, snapshot, state);

  assert.deepEqual(workspace.entries.get('/workspace/target'), { type: 2 });
  assert.deepEqual(workspace.entries.get('/workspace/target/debug'), { type: 2 });
  assert.deepEqual(workspace.entries.get('/workspace/target/debug/hello'), {
    type: 1,
    metadataOnly: true,
    size: 7352,
  });
  assert.deepEqual([...state.knownPaths].sort(), [
    '/workspace/target',
    '/workspace/target/debug',
    '/workspace/target/debug/hello',
  ]);
});

test('workspace-sync: refreshes skipped target metadata without syncing contents', async () => {
  const workspace = makeWorkspace();
  workspace.entries.set('/workspace/target', { type: 2 });
  workspace.entries.set('/workspace/target/debug', { type: 2 });
  await workspace.writeMetadataFile('/workspace/target/debug/hello', { size: 7352 });
  const state = {
    knownPaths: new Set([
      '/workspace/target',
      '/workspace/target/debug',
      '/workspace/target/debug/hello',
    ]),
  };
  const snapshot = decodeWorkspaceSyncPayload(payload([
    `D\t${b64('/workspace/target')}`,
    `D\t${b64('/workspace/target/debug')}`,
    `S\t${b64('/workspace/target/debug/hello')}\t8128`,
  ]));

  await applyWorkspaceSyncSnapshot(workspace, snapshot, state);

  assert.deepEqual(workspace.entries.get('/workspace/target/debug/hello'), {
    type: 1,
    metadataOnly: true,
    size: 8128,
  });
});

test('workspace-sync: bash profile hook emits hidden sync frames after prompts', () => {
  const block = buildGuestSyncProfileBlock();
  assert.match(block, /__rwb_sync_from_guest/);
  assert.match(block, /PROMPT_COMMAND="__rwb_sync_from_guest/);
  assert.match(block, /rust-web-box-sync/);
  assert.match(block, /printf 'S\\t%s\\t%s\\n'/);
});

test('workspace-sync: target artifacts stay visible as skipped metadata', () => {
  const block = buildGuestSyncProfileBlock();
  assert.doesNotMatch(block, /\/workspace\/target -prune/);
  assert.match(block, /\/workspace\/target\/\*/);
  assert.match(block, /printf 'S\\t%s\\t%s\\n'/);
});
