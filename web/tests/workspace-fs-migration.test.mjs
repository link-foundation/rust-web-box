// Migration tests for the JS-side workspace store (issue #33).
//
// `openWorkspaceFS()` needs IndexedDB, which plain Node lacks. Rather
// than pull in a dependency (the unit-test CI job runs `node --test`
// with no `npm install`), we install a tiny in-memory IndexedDB shim
// that covers exactly the surface workspace-fs.js touches: open +
// onupgradeneeded, createObjectStore({keyPath}), and a store with
// get/put/delete/getAll requests whose onsuccess fires asynchronously.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openWorkspaceFS, DEFAULT_SEED } from '../glue/workspace-fs.js';

// --- minimal fake IndexedDB ------------------------------------------------

const databases = new Map(); // name -> { version, stores: Map(name -> {keyPath, data}) }

function fireAsync(fn) {
  setTimeout(fn, 0);
}

function makeStore(rec) {
  function request(resultFn) {
    const req = {};
    fireAsync(() => {
      try {
        req.result = resultFn();
        if (req.onsuccess) req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        if (req.onerror) req.onerror({ target: req });
      }
    });
    return req;
  }
  return {
    get: (key) => request(() => rec.data.get(key)),
    put: (val) => request(() => {
      rec.data.set(val[rec.keyPath], val);
      return undefined;
    }),
    delete: (key) => request(() => {
      rec.data.delete(key);
      return undefined;
    }),
    getAll: () => request(() => Array.from(rec.data.values())),
  };
}

function makeDB(raw) {
  return {
    objectStoreNames: { contains: (n) => raw.stores.has(n) },
    createObjectStore(name, opts) {
      const rec = { keyPath: opts.keyPath, data: new Map() };
      raw.stores.set(name, rec);
      return makeStore(rec);
    },
    transaction(storeName) {
      const t = {};
      const store = makeStore(raw.stores.get(storeName));
      t.objectStore = () => store;
      return t;
    },
  };
}

function installFakeIndexedDB() {
  globalThis.indexedDB = {
    open(name, version) {
      const req = {};
      fireAsync(() => {
        let db = databases.get(name);
        if (!db) {
          db = { version: 0, stores: new Map() };
          databases.set(name, db);
        }
        const needsUpgrade = version > db.version;
        req.result = makeDB(db);
        if (needsUpgrade) {
          db.version = version;
          if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        }
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
}

function seedRaw(dbName, storeName, keyPath, entries) {
  let db = databases.get(dbName);
  if (!db) {
    db = { version: 1, stores: new Map() };
    databases.set(dbName, db);
  }
  let rec = db.stores.get(storeName);
  if (!rec) {
    rec = { keyPath, data: new Map() };
    db.stores.set(storeName, rec);
  }
  for (const e of entries) rec.data.set(e[keyPath], e);
}

const DB_NAME = 'rust-web-box-workspace';
const STORE = 'files';
const enc = (s) => new TextEncoder().encode(s);

// The exact bytes of the pre-issue-#33 branded entry point.
const BRANDED_MAIN_RS = [
  '// Entry point built by `cargo run` from /workspace.',
  '// Edit and save; changes mirror into the VM on every save.',
  '',
  'fn main() {',
  '    println!("Hello from rust-web-box!");',
  '    println!("Compiled by Rust inside the browser via CheerpX.");',
  '}',
  '',
].join('\n');

function resetDB() {
  databases.delete(DB_NAME);
}

async function readText(fs, path) {
  const bytes = await fs.readFile(path);
  return new TextDecoder().decode(bytes);
}

installFakeIndexedDB();

test('migration: untouched branded main.rs becomes plain cargo new (issue #33)', async () => {
  resetDB();
  seedRaw(DB_NAME, STORE, 'path', [
    { path: '/workspace', type: 2, size: 0, mtime: 1 },
    { path: '/workspace/src', type: 2, size: 0, mtime: 1 },
    {
      path: '/workspace/src/main.rs',
      type: 1,
      size: enc(BRANDED_MAIN_RS).byteLength,
      mtime: 1,
      data: enc(BRANDED_MAIN_RS),
    },
  ]);

  const fs = await openWorkspaceFS();
  const migrated = await readText(fs, '/workspace/src/main.rs');
  assert.equal(migrated, DEFAULT_SEED['/workspace/src/main.rs']);
  assert.doesNotMatch(migrated, /Compiled by Rust/);
  assert.doesNotMatch(migrated, /CheerpX/);
});

test('migration: user-edited main.rs is left untouched (issue #33)', async () => {
  resetDB();
  const edited = 'fn main() {\n    println!("my own program");\n}\n';
  seedRaw(DB_NAME, STORE, 'path', [
    { path: '/workspace', type: 2, size: 0, mtime: 1 },
    { path: '/workspace/src', type: 2, size: 0, mtime: 1 },
    {
      path: '/workspace/src/main.rs',
      type: 1,
      size: enc(edited).byteLength,
      mtime: 1,
      data: enc(edited),
    },
  ]);

  const fs = await openWorkspaceFS();
  const after = await readText(fs, '/workspace/src/main.rs');
  assert.equal(after, edited);
});

test('migration: a fresh (empty) store gets the plain seed (issue #33)', async () => {
  resetDB();
  const fs = await openWorkspaceFS();
  const seeded = await readText(fs, '/workspace/src/main.rs');
  assert.equal(seeded, DEFAULT_SEED['/workspace/src/main.rs']);
  assert.equal(seeded, 'fn main() {\n    println!("Hello, world!");\n}\n');
});
