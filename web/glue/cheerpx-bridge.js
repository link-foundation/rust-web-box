// CheerpX runtime bridge.
//
// Loads the CheerpX engine (vendored under web/cheerpx/cx.esm.js, falling
// back to the LT CDN), boots a Linux VM against an ext2 disk with an
// IndexedDB overlay for persistence, and exposes the resulting handle
// for the rest of the page. The visible terminal in VS Code Web is
// wired through this bridge via the WebVM bus (see webvm-server.js).
//
// Disk selection priority:
//   1. `warm` URL from web/disk/manifest.json — our pre-baked Alpine +
//      Rust image hosted as a `disk-latest` release asset.
//   2. `default` URL — the public WebVM Debian image, used as a hard
//      fallback so the page comes up even before the disk-image
//      workflow has run.
//
// We probe the warm URL with a HEAD request before mounting; if it
// 404s (no release built yet) we silently fall back to default.
//
// Networking caveat: CheerpX's only internet path is Tailscale (browsers
// cannot open raw TCP). The page-level network-shim mediates fetch for
// crate downloads from inside the page itself, but cargo running inside
// the VM still requires either Tailscale or a warm crate cache baked
// into the disk image.

// Resolved relative to this module — the static layout is
// `web/glue/cheerpx-bridge.js` and `web/cheerpx/cx.esm.js`.
const VENDORED_CHEERPX_ESM = new URL('../cheerpx/cx.esm.js', import.meta.url).href;
const CHEERPX_VERSION = '1.2.11';
const CDN_CHEERPX_ESM = `https://cxrtnc.leaningtech.com/${CHEERPX_VERSION}/cx.esm.js`;

// Hard fallback if the manifest is missing entirely.
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
 * Probe a URL to see if it resolves (200 / non-404).
 *
 * The warm Alpine+Rust image is published as a release asset on this
 * repo, which may or may not exist (depending on whether the disk-image
 * workflow has run yet). We use `mode: 'no-cors'` so a missing asset
 * doesn't surface as a noisy CORS error in the devtools console; the
 * tradeoff is the response is opaque, so we use a tiny range request
 * and treat any non-throwing fetch as "asset reachable".
 */
async function probeUrl(url, fetchImpl) {
  if (!url || typeof fetchImpl !== 'function') return false;
  try {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl && setTimeout(() => ctrl.abort(), 6000);
    // GET with Range: bytes=0-0 — minimal payload, supported by the
    // GitHub Releases redirect target. `mode: 'no-cors'` swallows the
    // CORS preflight error that would otherwise show in the console
    // when the asset is missing on a release that hasn't been built
    // yet; we only need to know "does this fetch resolve at all".
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      mode: 'no-cors',
      redirect: 'follow',
      signal: ctrl?.signal,
    });
    if (timer) clearTimeout(timer);
    // For opaque responses (no-cors) we can't read .ok or .status, so
    // a successful fetch with a non-zero `type` is the best we can do.
    if (res.type === 'opaque' || res.type === 'opaqueredirect') return true;
    return res.ok || res.status === 405;
  } catch {
    return false;
  }
}

/**
 * Resolve the disk URL from web/disk/manifest.json.
 *
 * Preference order:
 *   1. `warm` entry (our pre-baked Alpine + Rust ext2 release asset),
 *      when its `url` is set AND the URL probe succeeds.
 *   2. `default` entry (the public WebVM image).
 *   3. The hard-coded fallback above.
 */
export async function resolveDiskUrl({
  manifestUrl = './disk/manifest.json',
  fetchImpl = globalThis.fetch?.bind(globalThis),
  probe = probeUrl,
} = {}) {
  if (typeof fetchImpl !== 'function') return FALLBACK_DISK_URL;
  try {
    const res = await fetchImpl(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const m = await res.json();
    if (m?.warm?.url) {
      const ok = await probe(m.warm.url, fetchImpl);
      if (ok) return m.warm.url;
      // eslint-disable-next-line no-console
      console.info(
        '[rust-web-box] warm disk not yet published, falling back to default disk',
      );
    }
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
 *
 * If the configured `diskUrl` (typically the warm Alpine+Rust image
 * from `web/disk/manifest.json`) fails to mount — usually because the
 * disk-image release pipeline hasn't published it yet — we fall back
 * to the public WebVM Debian image so the workbench still comes up.
 */
export async function bootLinux({
  CheerpX,
  diskUrl,
  persistKey = PERSIST_KEY,
  onProgress,
  fallbackDiskUrl = FALLBACK_DISK_URL,
} = {}) {
  if (!CheerpX) throw new TypeError('bootLinux requires the CheerpX module');
  if (!diskUrl) diskUrl = await resolveDiskUrl();

  let cloud;
  let usedUrl = diskUrl;
  onProgress?.('attaching cloud disk');
  try {
    cloud = await CheerpX.CloudDevice.create(diskUrl);
  } catch (err) {
    if (fallbackDiskUrl && fallbackDiskUrl !== diskUrl) {
      // eslint-disable-next-line no-console
      console.warn(
        `[rust-web-box] disk ${diskUrl} unreachable (${err?.message ?? err}); falling back to ${fallbackDiskUrl}`,
      );
      usedUrl = fallbackDiskUrl;
      cloud = await CheerpX.CloudDevice.create(fallbackDiskUrl);
    } else {
      throw err;
    }
  }

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
    diskUrl: usedUrl,
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
