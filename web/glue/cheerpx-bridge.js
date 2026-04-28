// CheerpX runtime bridge.
//
// Loads the CheerpX engine (vendored under web/cheerpx/cx.esm.js, falling back
// to the LT CDN), boots a Linux VM against the public WebVM Debian image with
// an IndexedDB overlay for persistence, and exposes the resulting handle on
// `globalThis.__rustWebBox.cheerpx`.
//
// The VS Code Web extension layer talks to this bridge via a `MessageChannel`
// established at boot — see `web/glue/webvm-bus.js`.
//
// Networking caveat: CheerpX's only internet path is Tailscale (browsers
// cannot open raw TCP). The page-level `network-shim.js` mediates `fetch`
// for crate downloads from inside the page itself, but cargo running inside
// the VM still requires either Tailscale or the warm crate cache baked into
// the disk image to resolve dependencies. The MVP ships the warm-cache path
// as the default; Tailscale opt-in is a separate follow-up (see issue #1).

const VENDORED_CHEERPX_ESM = './cheerpx/cx.esm.js';
const CDN_CHEERPX_ESM = 'https://cxrtnc.leaningtech.com/1.2.8/cx.esm.js';

const DEFAULT_DISK_URL =
  'wss://disks.webvm.io/debian_large_20230522_5044875331.ext2';
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
 * Boot a CheerpX Linux VM. Returns the handle plus convenience helpers.
 *
 * The VM uses a CloudDevice-backed root + an IDBDevice overlay so user
 * edits survive reloads (the persistence the issue calls for).
 */
export async function bootLinux({
  CheerpX,
  diskUrl = DEFAULT_DISK_URL,
  persistKey = PERSIST_KEY,
  onProgress,
} = {}) {
  if (!CheerpX) throw new TypeError('bootLinux requires the CheerpX module');

  onProgress?.('attaching cloud disk');
  const cloud = await CheerpX.CloudDevice.create(diskUrl);

  onProgress?.('attaching IndexedDB overlay');
  const overlay = await CheerpX.IDBDevice.create(persistKey);
  const root = await CheerpX.OverlayDevice.create(cloud, overlay);

  onProgress?.('starting Linux');
  const cx = await CheerpX.Linux.create({
    mounts: [
      { type: 'ext2', path: '/', dev: root },
      { type: 'devs', path: '/dev' },
      { type: 'proc', path: '/proc' },
    ],
  });

  return {
    cx,
    cloud,
    overlay,
    root,
    diskUrl,
    persistKey,
  };
}

/**
 * Wire a hidden CheerpX console buffer that the pseudoterminal can drain.
 * CheerpX's `setConsole(element)` writes ANSI bytes to the element's
 * textContent; we hand it a sink whose mutations push to listeners.
 */
export function createConsoleSink() {
  const listeners = new Set();
  const buffer = [];
  const sink = {
    set textContent(value) {
      const delta = value.slice(buffer.join('').length);
      if (delta) {
        buffer.push(delta);
        for (const l of listeners) l(delta);
      }
    },
    get textContent() {
      return buffer.join('');
    },
    appendChild() {},
    removeChild() {},
    addEventListener() {},
    removeEventListener() {},
  };
  return {
    sink,
    onWrite(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      buffer.length = 0;
    },
  };
}
