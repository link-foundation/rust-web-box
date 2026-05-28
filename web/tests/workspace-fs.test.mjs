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
  // Issue #33: the seed is the canonical `cargo new` program — plain
  // "Hello, world!", no branding lines on every run.
  assert.match(
    DEFAULT_SEED['/workspace/src/main.rs'],
    /Hello, world!/,
  );
  assert.match(DEFAULT_SEED['/workspace/src/main.rs'], /fn main/);
});

test('workspace-fs: seed main.rs carries no CheerpX/rust-web-box branding (issue #33)', () => {
  const src = DEFAULT_SEED['/workspace/src/main.rs'];
  assert.doesNotMatch(src, /rust-web-box/);
  assert.doesNotMatch(src, /CheerpX/);
  assert.doesNotMatch(src, /Compiled by Rust/);
  // It is byte-for-byte the standard cargo new template so the first
  // (prebuilt) run matches every post-edit recompile.
  assert.equal(src, 'fn main() {\n    println!("Hello, world!");\n}\n');
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

test('workspace-fs: default cargo task runs from /workspace root', () => {
  const raw = DEFAULT_SEED['/workspace/.vscode/tasks.json'];
  const tasks = JSON.parse(raw);
  assert.equal(tasks.tasks[0].command, 'cargo run');
  assert.doesNotMatch(raw, /\/workspace\/hello/);
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

test('workspace-fs: default settings keep manual save dirty indicators visible', () => {
  const raw = DEFAULT_SEED['/workspace/.vscode/settings.json'];
  const settings = JSON.parse(raw.replace(/\/\/.*$/gm, ''));
  assert.equal(settings['files.autoSave'], 'off');
});
