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
 * Probe a URL to see if CheerpX's XHR-based loader can actually read it.
 *
 * Why this matters (issue #3, root cause #2): the warm Alpine+Rust image
 * is published as a GitHub Releases asset. The asset itself is reachable,
 * but the redirect target (`release-assets.githubusercontent.com`) does
 * not advertise `Access-Control-Allow-Origin`, so XHR (which has no
 * `no-cors` mode) is blocked by the browser. The previous implementation
 * used `mode: 'no-cors'` and treated an opaque response as success — that
 * told us "the URL is fetchable" but NOT "the URL is JS-readable", so we
 * happily passed CORS-blocked URLs to `CloudDevice.create()` and only
 * found out at mount time.
 *
 * The new probe issues a real `cors`-mode request: if the browser exposes
 * a readable response (`type === 'basic'` or `'cors'`), XHR will succeed
 * too. If CORS is blocked, fetch throws and we return `{ ok: false,
 * reason: 'cors' }` so the caller can log a structured diagnostic.
 *
 * Returns `{ ok, reason }` rather than a bare boolean so callers can
 * distinguish "missing" (404) from "CORS-blocked" (the issue-#3 case)
 * when surfacing diagnostics.
 */
export async function probeUrl(url, fetchImpl) {
  if (!url || typeof fetchImpl !== 'function') {
    return { ok: false, reason: 'invalid-input' };
  }
  // Non-HTTP(S) URLs (wss://, ws://) can't be probed with fetch — assume
  // usable; the CloudDevice will surface its own error if not.
  if (!/^https?:/i.test(url)) {
    return { ok: true, reason: 'non-http' };
  }
  let ctrl = null;
  let timer = null;
  try {
    ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    timer = ctrl && setTimeout(() => ctrl.abort(), 6000);
    // GET with Range: bytes=0-0 — one-byte payload, supported by the
    // GitHub Releases redirect target. `mode: 'cors'` (the default) is
    // deliberate: if the browser refuses to expose the response, fetch
    // throws and we know XHR will fail too. That's the whole point.
    const res = await fetchImpl(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      mode: 'cors',
      redirect: 'follow',
      signal: ctrl?.signal,
    });
    if (timer) clearTimeout(timer);
    if (res.type === 'opaque' || res.type === 'opaqueredirect') {
      // Shouldn't happen under mode:'cors', but guard anyway — opaque
      // means JS can't read the bytes, which is exactly what XHR needs.
      return { ok: false, reason: 'opaque' };
    }
    if (res.status === 404) return { ok: false, reason: 'not-found' };
    if (res.ok || res.status === 206 || res.status === 405) {
      return { ok: true, reason: 'reachable' };
    }
    return { ok: false, reason: `http-${res.status}` };
  } catch (err) {
    if (timer) clearTimeout(timer);
    // A `TypeError` from fetch under `mode: 'cors'` typically means the
    // response was blocked by CORS — same outcome we'd get from XHR.
    const reason =
      err?.name === 'AbortError' ? 'timeout' :
      err?.name === 'TypeError' ? 'cors-or-network' :
      'fetch-error';
    return { ok: false, reason };
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
  logger = console,
} = {}) {
  if (typeof fetchImpl !== 'function') return FALLBACK_DISK_URL;
  try {
    const res = await fetchImpl(manifestUrl, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    const m = await res.json();
    if (m?.warm?.url) {
      const result = await probe(m.warm.url, fetchImpl);
      // Tolerate legacy probes that returned a bare boolean.
      const ok = typeof result === 'object' ? result.ok : !!result;
      if (ok) return m.warm.url;
      const reason = typeof result === 'object' ? result.reason : 'unknown';
      // Structured diagnostic: distinguish "asset not built yet" from
      // "asset is built but CORS-blocked" (issue #3, root cause #2).
      // Hosting outside disks.webvm.io requires CORS; surfacing this
      // explicitly saves future maintainers a 30-minute debugging trip.
      if (reason === 'cors-or-network' || reason === 'opaque') {
        logger?.warn?.(
          `[rust-web-box] warm disk ${m.warm.url} is reachable but CORS-blocked ` +
          `(reason: ${reason}); falling back to default disk. ` +
          `Custom disks must be served with Access-Control-Allow-Origin — see ` +
          `docs/case-studies/issue-3/analysis-disk-cors.md`,
        );
      } else {
        logger?.info?.(
          `[rust-web-box] warm disk ${m.warm.url} unavailable ` +
          `(reason: ${reason}); falling back to default disk`,
        );
      }
    }
    if (m?.default?.url) return m.default.url;
  } catch (err) {
    logger?.warn?.('[rust-web-box] disk manifest unavailable, using fallback:', err);
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
