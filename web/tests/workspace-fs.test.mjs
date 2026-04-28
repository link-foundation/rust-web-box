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

test('workspace-fs: seed includes hello_world.rs at /workspace level', () => {
  assert.ok(
    DEFAULT_SEED['/workspace/hello_world.rs'],
    'expected /workspace/hello_world.rs in default seed',
  );
  assert.match(
    DEFAULT_SEED['/workspace/hello_world.rs'],
    /Hello from rust-web-box/,
  );
  assert.match(DEFAULT_SEED['/workspace/hello_world.rs'], /fn main/);
});

test('workspace-fs: seed contains a buildable Cargo project at /workspace/hello', () => {
  assert.ok(DEFAULT_SEED['/workspace/hello/Cargo.toml']);
  assert.ok(DEFAULT_SEED['/workspace/hello/src/main.rs']);
  assert.match(DEFAULT_SEED['/workspace/hello/Cargo.toml'], /name = "hello"/);
  assert.match(DEFAULT_SEED['/workspace/hello/Cargo.toml'], /edition = "2021"/);
  assert.match(DEFAULT_SEED['/workspace/hello/src/main.rs'], /fn main/);
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
