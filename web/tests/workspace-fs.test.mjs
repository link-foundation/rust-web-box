// Unit tests for the JS-side workspace store helpers.
//
// IndexedDB is not available in plain Node, so the IDB integration is
// covered by the Playwright smoke test (`playwright-smoke.mjs`). Here
// we cover the pure helpers and assert the seed file set is what the
// extension expects.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalize,
  DEFAULT_SEED,
  FILE_TYPE_FILE,
  FILE_TYPE_DIRECTORY,
} from '../glue/workspace-fs.js';

test('workspace-fs: normalize() canonicalises paths', () => {
  assert.equal(normalize('/'), '/');
  assert.equal(normalize(''), '/');
  assert.equal(normalize('workspace'), '/workspace');
  assert.equal(normalize('/workspace/'), '/workspace');
  assert.equal(normalize('/workspace//hello'), '/workspace/hello');
  assert.equal(normalize('/a/b/c/'), '/a/b/c');
});

test('workspace-fs: seed includes src/main.rs at /workspace level', () => {
  assert.ok(
    DEFAULT_SEED['/workspace/src/main.rs'],
    'expected /workspace/src/main.rs in default seed',
  );
  assert.match(
    DEFAULT_SEED['/workspace/src/main.rs'],
    /Hello from rust-web-box/,
  );
  assert.match(DEFAULT_SEED['/workspace/src/main.rs'], /fn main/);
});

test('workspace-fs: seed contains a buildable Cargo project at /workspace root', () => {
  assert.ok(DEFAULT_SEED['/workspace/Cargo.toml']);
  assert.ok(DEFAULT_SEED['/workspace/src/main.rs']);
  assert.match(DEFAULT_SEED['/workspace/Cargo.toml'], /name = "hello"/);
  assert.match(DEFAULT_SEED['/workspace/Cargo.toml'], /edition = "2021"/);
  assert.match(DEFAULT_SEED['/workspace/src/main.rs'], /fn main/);
  assert.equal(DEFAULT_SEED['/workspace/hello_world.rs'], undefined);
  assert.equal(DEFAULT_SEED['/workspace/hello/Cargo.toml'], undefined);
});

test('workspace-fs: file/dir type constants are stable', () => {
  assert.equal(FILE_TYPE_FILE, 1);
  assert.equal(FILE_TYPE_DIRECTORY, 2);
});

test('workspace-fs: seed paths all begin with /workspace', () => {
  for (const path of Object.keys(DEFAULT_SEED)) {
    assert.ok(
      path.startsWith('/workspace'),
      `seed path ${path} should start with /workspace`,
    );
  }
});

test('workspace-fs: seed includes .vscode/{settings,tasks,launch}.json (issue #5)', () => {
  // VS Code probes these files on workspace open. Without seeds the
  // workbench logs a flood of ENOENT errors per probe cycle. Pin them
  // here so a refactor of SEED_FILES can't accidentally drop them.
  for (const name of ['settings.json', 'tasks.json', 'launch.json']) {
    const p = `/workspace/.vscode/${name}`;
    assert.ok(DEFAULT_SEED[p], `expected ${p} in default seed`);
    // Each must be parseable JSON (with comments stripped for settings).
    const stripped = DEFAULT_SEED[p].replace(/\/\/.*$/gm, '');
    assert.doesNotThrow(
      () => JSON.parse(stripped),
      `${p} should be valid JSON (comments allowed for settings.json)`,
    );
  }
});
