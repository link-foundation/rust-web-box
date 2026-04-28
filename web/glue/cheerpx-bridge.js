// CheerpX runtime bridge.
//
// Loads the CheerpX engine (vendored under web/cheerpx/cx.esm.js, falling back
// to the LT CDN), boots a Linux VM against an ext2 disk with an IndexedDB
// overlay for persistence, and exposes the resulting handle for the rest of
// the page. The visible terminal in VS Code Web is wired through this bridge
// via the WebVM bus (see webvm-server.js).
//
// Networking caveat: CheerpX's only internet path is Tailscale (browsers
// cannot open raw TCP). The page-level network-shim mediates fetch for
// crate downloads from inside the page itself, but cargo running inside
// the VM still requires either Tailscale or a warm crate cache baked into
// the disk image to resolve dependencies. The MVP ships an Alpine + Rust
// image with the Rust toolchain pre-installed and a hello-world project
// that compiles offline.

// Resolved relative to this module — the static layout is
// `web/glue/cheerpx-bridge.js` and `web/cheerpx/cx.esm.js`, so we walk
// up one level to reach the vendored copy. (Using a page-relative URL
// like `./cheerpx/...` would break when this module is imported from
// `glue/boot.js`, which is itself loaded from `web/index.html` —
// browsers resolve dynamic `import()` against the *importing module's*
// URL, not the page.)
const VENDORED_CHEERPX_ESM = new URL('../cheerpx/cx.esm.js', import.meta.url).href;
const CHEERPX_VERSION = '1.2.11';
const CDN_CHEERPX_ESM = `https://cxrtnc.leaningtech.com/${CHEERPX_VERSION}/cx.esm.js`;

// Default: minimal Alpine + Rust disk image, hosted as a Release asset on
// this repo. The boot shell falls back to the public WebVM Debian image if
// the manifest doesn't list a Release asset yet (fresh repos before the
// disk-image release pipeline has run). This way the workbench and
// terminal still come up against a real userspace.
const FALLBACK_DISK_URL =
  'wss://disks.webvm.io/debian_large_20230522_5044875331_2.ext2';
const PERSIST_KEY = 'rust-web-box-overlay-v1';

/**
 * Load the CheerpX module, preferring a vendored copy under web/cheerpx/.
 * The vendored copy is what CI publishes; the CDN is a hard fallback for
 * local dev where the CI step hasn't run.
 */
export async function loadCheerpX({
  vendoredUrl = VENDORED_CHEERPX_ESM,
  cdnUrl = CDN_CHEERPX_ESM,
  importer = (u) => import(/* @vite-ignore */ u),
} = {}) {
  try {
    return await importer(vendoredUrl);
  } catch (vendoredErr) {
    try {
      const mod = await importer(cdnUrl);
      // eslint-disable-next-line no-console
      console.warn(
        '[rust-web-box] CheerpX served from CDN; vendored copy not found:',
        vendoredErr,
      );
      return mod;
    } catch (cdnErr) {
      const err = new Error(
        `Failed to load CheerpX from vendored (${vendoredUrl}) or CDN (${cdnUrl})`,
      );
      err.vendoredErr = vendoredErr;
      err.cdnErr = cdnErr;
      throw err;
    }
  }
}

/**
 * Resolve the disk URL from web/disk/manifest.json.
 *
 * Preference order:
 *   1. `warm` entry (our pre-baked Alpine + Rust ext2 release asset),
 *      when its `url` is set.
 *   2. `default` entry (the public WebVM image — keeps the boot path
 *      working even before the disk-image release pipeline has run).
 *   3. The hard-coded fallback above.
 */
export async function resolveDiskUrl({
  manifestUrl = './disk/manifest.json',
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  if (typeof fetchImpl !== 'function') return FALLBACK_DISK_URL;
  try {
    const res = await fetchImpl(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const m = await res.json();
    if (m?.warm?.url) return m.warm.url;
    if (m?.default?.url) return m.default.url;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[rust-web-box] disk manifest unavailable, using fallback:', err);
  }
  return FALLBACK_DISK_URL;
}

/**
 * Boot a CheerpX Linux VM. Returns the handle plus the device stack.
 *
 * The VM uses a CloudDevice-backed root + an IDBDevice overlay so user
 * edits survive reloads (issue #1 acceptance criterion 9). The mount
 * topology mirrors leaningtech/webvm's reference WebVM.svelte exactly so
 * the supported callbacks (cpuActivity, processCreated, ...) keep working.
 */
export async function bootLinux({
  CheerpX,
  diskUrl,
  persistKey = PERSIST_KEY,
  onProgress,
} = {}) {
  if (!CheerpX) throw new TypeError('bootLinux requires the CheerpX module');
  if (!diskUrl) diskUrl = await resolveDiskUrl();

  onProgress?.('attaching cloud disk');
  const cloud = await CheerpX.CloudDevice.create(diskUrl);

  onProgress?.('attaching IndexedDB overlay');
  const overlay = await CheerpX.IDBDevice.create(persistKey);
  const root = await CheerpX.OverlayDevice.create(cloud, overlay);

  onProgress?.('attaching helper devices');
  const webDevice = await CheerpX.WebDevice.create('');
  const dataDevice = await CheerpX.DataDevice.create();

  onProgress?.('starting Linux');
  const cx = await CheerpX.Linux.create({
    mounts: [
      { type: 'ext2', dev: root, path: '/' },
      { type: 'dir', dev: webDevice, path: '/web' },
      { type: 'dir', dev: dataDevice, path: '/data' },
      { type: 'devs', path: '/dev' },
      { type: 'devpts', path: '/dev/pts' },
      { type: 'proc', path: '/proc' },
      { type: 'sys', path: '/sys' },
    ],
  });

  return {
    cx,
    cloud,
    overlay,
    root,
    webDevice,
    dataDevice,
    diskUrl,
    persistKey,
  };
}

/**
 * Wire xterm-style I/O to the Linux VM.
 *
 * `setCustomConsole(writeFn, cols, rows)` is the CheerpX API documented at
 * https://cheerpx.io/docs and used by leaningtech/webvm. It returns a
 * `cxReadFunc(charCode)` that you call once per byte of stdin. We expose:
 *
 *   * `write(buf)`: enqueue bytes → CheerpX stdin (a Uint8Array or string).
 *   * `resize(cols, rows)`: TIOCSWINSZ-equivalent.
 *   * `onData(cb)`: subscribe to bytes coming out of the VM.
 *   * `dispose()`: detach.
 *
 * All output is delivered as raw `Uint8Array` chunks so xterm.js (or our
 * VS Code Pseudoterminal) can render them verbatim.
 */
export function attachConsole(cx, { cols = 80, rows = 24 } = {}) {
  if (!cx) throw new TypeError('attachConsole requires a CheerpX Linux handle');
  const listeners = new Set();
  const writer = (buf, vt) => {
    // CheerpX delivers ArrayBuffer (or compatible). We forward as a
    // Uint8Array snapshot. `vt` is the virtual terminal id (1 = console);
    // we accept all of them so secondary ttys still appear.
    if (vt !== undefined && vt !== 1) return;
    let view;
    if (buf instanceof Uint8Array) view = buf;
    else if (buf instanceof ArrayBuffer) view = new Uint8Array(buf);
    else if (Array.isArray(buf)) view = new Uint8Array(buf);
    else return;
    for (const cb of listeners) cb(view);
  };
  let cxReadFunc;
  if (typeof cx.setCustomConsole === 'function') {
    cxReadFunc = cx.setCustomConsole(writer, cols, rows);
  } else {
    throw new Error('CheerpX build is missing setCustomConsole (need >= 1.2)');
  }
  return {
    write(input) {
      if (typeof input === 'string') {
        for (let i = 0; i < input.length; i++) cxReadFunc(input.charCodeAt(i));
      } else if (input instanceof Uint8Array) {
        for (let i = 0; i < input.length; i++) cxReadFunc(input[i]);
      } else if (Array.isArray(input)) {
        for (const ch of input) cxReadFunc(typeof ch === 'string' ? ch.charCodeAt(0) : ch);
      }
    },
    resize(c, r) {
      if (typeof cx.setConsoleSize === 'function') cx.setConsoleSize(c, r);
    },
    onData(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    dispose() {
      listeners.clear();
    },
  };
}
