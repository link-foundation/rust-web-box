// In-browser workspace filesystem for rust-web-box.
//
// VS Code's Explorer needs files to *exist* the moment the workbench
// mounts. We can't gate that on a 30-second CheerpX boot — the user
// would see an empty workspace, exactly like the screenshot in
// https://github.com/link-foundation/rust-web-box/pull/2#issuecomment.
//
// So the workspace lives JS-side, persisted to IndexedDB. The
// FileSystemProvider in the webvm-host extension reads/writes here
// directly. When the VM finishes booting we mirror these files into
// `/workspace/` inside the guest so `cargo run` sees the same content.
// User edits in the editor are propagated both ways: editor -> JS store
// -> IDB (immediate) -> VM (best-effort, on next boot or via the
// `webvm.syncWorkspace` bus method).
//
// The store is intentionally tiny — text files and small blobs only.
// It is NOT a general-purpose POSIX FS; it is the workspace surface
// that VS Code's Explorer + editor talk to.

const DB_NAME = 'rust-web-box-workspace';
const DB_VERSION = 1;
const STORE = 'files';

// Default workspace seed: a minimal Cargo project rooted directly at
// `/workspace`, so the terminal starts in the same directory the user
// edits in VS Code and plain `cargo run` works without `cd hello`.
const SEED_FILES = {
  '/workspace/Cargo.toml':
    [
      '[package]',
      'name = "hello"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[[bin]]',
      'name = "hello"',
      'path = "src/main.rs"',
      '',
      '[dependencies]',
      '',
    ].join('\n'),
  '/workspace/src/main.rs':
    [
      '// Entry point built by `cargo run` from /workspace.',
      '// Edit and save; changes mirror into the VM on every save.',
      '',
      'fn main() {',
      '    println!("Hello from rust-web-box!");',
      '    println!("Compiled by Rust inside the browser via CheerpX.");',
      '}',
      '',
    ].join('\n'),
  '/workspace/README.md':
    [
      '# rust-web-box workspace',
      '',
      'This workspace lives inside your browser. Files persist in IndexedDB',
      'and are mirrored into the in-browser Linux VM at `/workspace/` so',
      '`cargo run` from the terminal sees the same content.',
      '',
      '## Try it',
      '',
      '* Open `src/main.rs` and run `cargo run` from the terminal',
      '  (or click the **Cargo Run** status-bar button).',
      '',
    ].join('\n'),
  // VS Code reads `.vscode/{settings,tasks,launch}.json` immediately on
  // workspace open. Without these the workbench logs three ENOENT errors
  // *per probe cycle* (issue #5). Seed empty-but-valid stubs so the
  // probes succeed. Users can edit them like normal files.
  '/workspace/.vscode/settings.json':
    [
      '{',
      '  // Workspace settings for rust-web-box.',
      '  // Edit freely — changes persist in your browser\'s IndexedDB.',
      '  "files.autoSave": "afterDelay",',
      '  "editor.formatOnSave": false,',
      '  "rust-analyzer.checkOnSave": false',
      '}',
      '',
    ].join('\n'),
  '/workspace/.vscode/tasks.json':
    [
      '{',
      '  "version": "2.0.0",',
      '  "tasks": [',
      '    {',
      '      "label": "cargo run",',
      '      "type": "shell",',
      '      "command": "cargo run",',
      '      "problemMatcher": ["$rustc"],',
      '      "group": { "kind": "build", "isDefault": true }',
      '    }',
      '  ]',
      '}',
      '',
    ].join('\n'),
  '/workspace/.vscode/launch.json':
    [
      '{',
      '  "version": "0.2.0",',
      '  "configurations": []',
      '}',
      '',
    ].join('\n'),
  '/workspace/.vscode/tasks.json':
    [
      '{',
      '  "version": "2.0.0",',
      '  "tasks": [',
      '    {',
      '      "label": "cargo run",',
      '      "type": "shell",',
      '      "command": "cd /workspace/hello && cargo run",',
      '      "problemMatcher": ["$rustc"],',
      '      "group": { "kind": "build", "isDefault": true }',
      '    }',
      '  ]',
      '}',
      '',
    ].join('\n'),
};

const LEGACY_SEED_FILES = {
  '/workspace/hello_world.rs':
    [
      '// hello_world.rs — the entry point for the rust-web-box sandbox.',
      '//',
      '// `cargo run` from /workspace/hello will compile and execute this',
      '// program inside the in-browser Linux VM. Edit freely; your changes',
      '// persist in IndexedDB and are mirrored into the VM on every save.',
      '',
      'fn main() {',
      '    println!("Hello from rust-web-box!");',
      '    println!("This binary was compiled inside CheerpX (WebVM).");',
      '}',
      '',
    ].join('\n'),
  '/workspace/hello/Cargo.toml':
    [
      '[package]',
      'name = "hello"',
      'version = "0.1.0"',
      'edition = "2021"',
      '',
      '[[bin]]',
      'name = "hello"',
      'path = "src/main.rs"',
      '',
      '[dependencies]',
      '',
    ].join('\n'),
  '/workspace/hello/src/main.rs':
    [
      '// Entry point built by `cargo run` from /workspace/hello.',
      '// Edit and save — changes mirror into the VM on every save.',
      '',
      'fn main() {',
      '    println!("Hello from rust-web-box!");',
      '    println!("Compiled by Rust inside the browser via CheerpX.");',
      '}',
      '',
    ].join('\n'),
  '/workspace/README.md':
    [
      '# rust-web-box workspace',
      '',
      'This workspace lives inside your browser. Files persist in IndexedDB',
      'and are mirrored into the in-browser Linux VM at `/workspace/` so',
      '`cargo run` from the terminal sees the same content.',
      '',
      '## Try it',
      '',
      '* Open `hello_world.rs` for a one-file demo.',
      '* Open `hello/src/main.rs` and run `cargo run` from the terminal',
      '  (or click the **Cargo Run** status-bar button).',
      '',
    ].join('\n'),
};

const TYPE_FILE = 1;
const TYPE_DIR = 2;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(db, mode, fn) {
  return await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const s = t.objectStore(STORE);
    Promise.resolve(fn(s)).then(resolve, reject);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Open (and seed if empty) the workspace store.
 *
 * Returns an object with:
 *   * stat(path) -> { type, size, ctime, mtime }
 *   * readDirectory(path) -> [[name, type], ...]
 *   * readFile(path) -> Uint8Array
 *   * writeFile(path, bytes) -> void
 *   * delete(path, opts?) -> void
 *   * rename(from, to) -> void
 *   * createDirectory(path) -> void
 *   * snapshot() -> { [path]: Uint8Array } for VM mirroring
 *   * onChange(cb) -> dispose
 */
export async function openWorkspaceFS({ seed = SEED_FILES } = {}) {
  const db = await openDB();
  const listeners = new Set();

  function notify(change) {
    for (const cb of listeners) {
      try { cb(change); } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[workspace-fs] listener threw:', err);
      }
    }
  }

  async function getEntry(path) {
    return await tx(db, 'readonly', (s) => reqToPromise(s.get(path)));
  }

  async function putEntry(entry) {
    return await tx(db, 'readwrite', (s) => reqToPromise(s.put(entry)));
  }

  async function deleteEntry(path) {
    return await tx(db, 'readwrite', (s) => reqToPromise(s.delete(path)));
  }

  async function listAll() {
    return await tx(db, 'readonly', (s) => reqToPromise(s.getAll()));
  }

  async function putSeedFile(path, content) {
    const bytes = new TextEncoder().encode(content);
    const dirs = collectDirs(path);
    for (const d of dirs) {
      if (!have.has(d)) {
        await putEntry({ path: d, type: TYPE_DIR, size: 0, mtime: Date.now() });
        have.add(d);
      }
    }
    await putEntry({
      path,
      type: TYPE_FILE,
      size: bytes.byteLength,
      mtime: Date.now(),
      data: bytes,
    });
    have.add(path);
  }

  function textOfEntry(entry) {
    const bytes = entry?.data instanceof Uint8Array
      ? entry.data
      : new Uint8Array(entry?.data ?? []);
    return new TextDecoder().decode(bytes);
  }

  async function replaceIfUnchanged(path, oldText, newText) {
    const entry = await getEntry(path);
    if (!entry || entry.type !== TYPE_FILE || textOfEntry(entry) !== oldText) return false;
    await putSeedFile(path, newText);
    return true;
  }

  async function deleteIfUnchanged(path, oldText) {
    const entry = await getEntry(path);
    if (!entry || entry.type !== TYPE_FILE || textOfEntry(entry) !== oldText) return false;
    await deleteEntry(path);
    have.delete(path);
    return true;
  }

  async function deleteDirIfEmpty(path) {
    const all = await listAll();
    const prefix = path + '/';
    if (all.some((e) => e.path.startsWith(prefix))) return false;
    const entry = await getEntry(path);
    if (entry?.type === TYPE_DIR) {
      await deleteEntry(path);
      have.delete(path);
      return true;
    }
    return false;
  }

  async function migrateLegacyWorkspace() {
    const legacy = have.has('/workspace/hello_world.rs') || have.has('/workspace/hello/Cargo.toml');
    if (!legacy) return;
    for (const path of ['/workspace/Cargo.toml', '/workspace/src/main.rs']) {
      if (!have.has(path) && seed[path]) await putSeedFile(path, seed[path]);
    }
    if (seed['/workspace/README.md']) {
      await replaceIfUnchanged(
        '/workspace/README.md',
        LEGACY_SEED_FILES['/workspace/README.md'],
        seed['/workspace/README.md'],
      );
    }
    if (seed['/workspace/.vscode/tasks.json']) {
      await replaceIfUnchanged(
        '/workspace/.vscode/tasks.json',
        LEGACY_SEED_FILES['/workspace/.vscode/tasks.json'],
        seed['/workspace/.vscode/tasks.json'],
      );
    }
    for (const path of [
      '/workspace/hello_world.rs',
      '/workspace/hello/Cargo.toml',
      '/workspace/hello/src/main.rs',
    ]) {
      await deleteIfUnchanged(path, LEGACY_SEED_FILES[path]);
    }
    await deleteDirIfEmpty('/workspace/hello/src');
    await deleteDirIfEmpty('/workspace/hello');
  }

  // Seed new stores, and migrate old default workspaces without
  // overwriting user-created root project files.
  const existing = await listAll();
  const have = new Set(existing.map((e) => e.path));
  if (existing.length === 0) {
    for (const [path, content] of Object.entries(seed)) {
      await putSeedFile(path, content);
    }
  } else {
    await migrateLegacyWorkspace();
  }

  async function ensureDirChain(path) {
    for (const d of collectDirs(path)) {
      const got = await getEntry(d);
      if (!got) {
        await putEntry({ path: d, type: TYPE_DIR, size: 0, mtime: Date.now() });
      }
    }
  }

  async function stat(path) {
    const norm = normalize(path);
    if (norm === '/') {
      return { type: TYPE_DIR, size: 0, ctime: 0, mtime: 0 };
    }
    if (norm === '/workspace') {
      const entry = await getEntry(norm);
      if (entry) return { type: TYPE_DIR, size: 0, ctime: 0, mtime: entry.mtime ?? 0 };
      // Always present even if seed put it after.
      return { type: TYPE_DIR, size: 0, ctime: 0, mtime: 0 };
    }
    const entry = await getEntry(norm);
    if (!entry) {
      const err = new Error(`ENOENT: ${norm}`);
      err.code = 'FileNotFound';
      throw err;
    }
    return {
      type: entry.type,
      size: entry.size ?? (entry.data?.byteLength ?? 0),
      ctime: entry.mtime ?? 0,
      mtime: entry.mtime ?? 0,
    };
  }

  async function readDirectory(path) {
    const dir = normalize(path);
    const all = await listAll();
    const prefix = dir === '/' ? '/' : dir + '/';
    const seen = new Map();
    for (const entry of all) {
      if (entry.path === dir) continue;
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      if (slash < 0) {
        seen.set(rest, entry.type);
      } else {
        const name = rest.slice(0, slash);
        if (!seen.has(name)) seen.set(name, TYPE_DIR);
      }
    }
    return Array.from(seen.entries());
  }

  async function readFile(path) {
    const norm = normalize(path);
    const entry = await getEntry(norm);
    if (!entry || entry.type !== TYPE_FILE) {
      const err = new Error(`ENOENT: ${norm}`);
      err.code = 'FileNotFound';
      throw err;
    }
    return entry.data instanceof Uint8Array
      ? entry.data
      : new Uint8Array(entry.data ?? []);
  }

  async function writeFile(path, bytes, { create = true, overwrite = true } = {}) {
    const norm = normalize(path);
    const existed = await getEntry(norm);
    if (existed && !overwrite) {
      const err = new Error(`EEXIST: ${norm}`);
      err.code = 'FileExists';
      throw err;
    }
    if (!existed && !create) {
      const err = new Error(`ENOENT: ${norm}`);
      err.code = 'FileNotFound';
      throw err;
    }
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    await ensureDirChain(norm);
    await putEntry({
      path: norm,
      type: TYPE_FILE,
      size: buf.byteLength,
      mtime: Date.now(),
      data: buf,
    });
    notify({ kind: existed ? 'change' : 'create', path: norm });
  }

  async function deletePath(path, { recursive = false } = {}) {
    const norm = normalize(path);
    const entry = await getEntry(norm);
    if (!entry) return;
    if (entry.type === TYPE_DIR) {
      const all = await listAll();
      const prefix = norm + '/';
      const children = all.filter((e) => e.path.startsWith(prefix));
      if (children.length > 0 && !recursive) {
        const err = new Error(`ENOTEMPTY: ${norm}`);
        err.code = 'NoPermissions';
        throw err;
      }
      for (const child of children) await deleteEntry(child.path);
    }
    await deleteEntry(norm);
    notify({ kind: 'delete', path: norm });
  }

  async function rename(from, to) {
    const a = normalize(from);
    const b = normalize(to);
    const entry = await getEntry(a);
    if (!entry) {
      const err = new Error(`ENOENT: ${a}`);
      err.code = 'FileNotFound';
      throw err;
    }
    if (entry.type === TYPE_FILE) {
      await ensureDirChain(b);
      await putEntry({ ...entry, path: b, mtime: Date.now() });
      await deleteEntry(a);
    } else {
      // Recursive rename: move every descendant.
      const all = await listAll();
      const prefix = a + '/';
      for (const e of all) {
        if (e.path === a) {
          await putEntry({ ...e, path: b });
          await deleteEntry(a);
          continue;
        }
        if (e.path.startsWith(prefix)) {
          const newPath = b + e.path.slice(a.length);
          await putEntry({ ...e, path: newPath });
          await deleteEntry(e.path);
        }
      }
    }
    notify({ kind: 'rename', from: a, to: b });
  }

  async function createDirectory(path) {
    const norm = normalize(path);
    await ensureDirChain(norm);
    const got = await getEntry(norm);
    if (!got) {
      await putEntry({ path: norm, type: TYPE_DIR, size: 0, mtime: Date.now() });
    }
    notify({ kind: 'create', path: norm });
  }

  /**
   * Snapshot every regular file in the workspace as `{ path: bytes }`.
   * The mirror layer uses this to seed the VM's `/workspace/` directory.
   */
  async function snapshot() {
    const all = await listAll();
    const out = {};
    for (const e of all) {
      if (e.type !== TYPE_FILE) continue;
      out[e.path] = e.data instanceof Uint8Array ? e.data : new Uint8Array(e.data ?? []);
    }
    return out;
  }

  function onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }

  return {
    stat,
    readDirectory,
    readFile,
    writeFile,
    delete: deletePath,
    rename,
    createDirectory,
    snapshot,
    onChange,
  };
}

export function normalize(p) {
  if (!p) return '/';
  let s = String(p);
  if (!s.startsWith('/')) s = '/' + s;
  // Drop trailing slash unless it's the root.
  while (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  // Collapse repeated slashes.
  s = s.replace(/\/{2,}/g, '/');
  return s;
}

function collectDirs(path) {
  const norm = normalize(path);
  const parts = norm.split('/').filter(Boolean);
  const out = [];
  let cur = '';
  for (let i = 0; i < parts.length - 1; i++) {
    cur += '/' + parts[i];
    out.push(cur);
  }
  return out;
}

export const FILE_TYPE_FILE = TYPE_FILE;
export const FILE_TYPE_DIRECTORY = TYPE_DIR;
export const DEFAULT_SEED = SEED_FILES;
