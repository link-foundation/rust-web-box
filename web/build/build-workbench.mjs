#!/usr/bin/env node
// Build the workbench entry page for rust-web-box.
//
// What it does:
//   1. Vendors the upstream `vscode-web` npm package (a community
//      repackage of microsoft/vscode's web build) into `web/vscode-web/`.
//      The package layout is `dist/out/...` plus `dist/extensions/...`
//      and `dist/node_modules/...`. We flatten `dist/` to the top level
//      so the resulting URL paths under GitHub Pages mirror what
//      vscode.dev serves.
//   2. Vendors the CheerpX runtime into `web/cheerpx/`. We pin a known
//      version and copy `cx.esm.js` plus its WASM/auxiliary files.
//   3. Copies our two web extensions next to the bundle and renders
//      `web/index.html` from `web/build/index.template.html`. The
//      template uses the upstream AMD-loader bootstrap (which is what
//      `vscode-web` ships and `microsoft/vscode`'s `workbench.html`
//      uses verbatim) so the workbench mounts identically to vscode.dev.
//   4. Writes a `product.json` next to the workbench so the AMD loader
//      can pull `additionalBuiltinExtensions`/`folderUri`/etc. from a
//      file (which is what `vscode-web`'s default workbench.js does).
//
// Run via `node web/build/build-workbench.mjs` (no transitive deps —
// only Node stdlib).
//
// Skip flags:
//   SKIP_VSCODE_WEB=1  — leave vendored copy alone (or absent).
//   SKIP_CHEERPX=1     — leave CheerpX alone (or absent).

import { promises as fs } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(WEB_ROOT, '..');
const VSCODE_WEB_VERSION = '1.91.1';
const CHEERPX_VERSION = '1.2.11';

// ---------------------------------------------------------------------------

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function moveContents(from, to) {
  // Move every entry inside `from` up one level into `to`. Used to
  // flatten `dist/` -> `vscode-web/` so URLs match the upstream layout.
  await ensureDir(to);
  for (const entry of await fs.readdir(from)) {
    const src = path.join(from, entry);
    const dst = path.join(to, entry);
    await rmrf(dst);
    await fs.rename(src, dst);
  }
  await rmrf(from);
}

async function vendorVSCodeWeb() {
  const target = path.join(WEB_ROOT, 'vscode-web');
  const stamp = path.join(target, '.version');
  try {
    const existing = await fs.readFile(stamp, 'utf8');
    if (existing.trim() === VSCODE_WEB_VERSION) {
      console.log(`[vscode-web] already at ${VSCODE_WEB_VERSION}, skipping`);
      return target;
    }
  } catch {}

  console.log(`[vscode-web] vendoring vscode-web@${VSCODE_WEB_VERSION}`);

  // Preserve files that are committed to the repo (just the local
  // README) — the npm tarball ships its own README/LICENSE/package.json
  // that we don't want overwriting our docs.
  let preservedReadme;
  try {
    preservedReadme = await fs.readFile(path.join(target, 'README.md'), 'utf8');
  } catch {}

  await rmrf(target);
  await ensureDir(target);

  const tmp = path.join(WEB_ROOT, '.tmp-vscode-web');
  await rmrf(tmp);
  await ensureDir(tmp);
  execSync(`npm pack vscode-web@${VSCODE_WEB_VERSION} --silent`, {
    cwd: tmp,
    stdio: 'inherit',
  });
  const tarballName = (await fs.readdir(tmp)).find((n) => n.endsWith('.tgz'));
  if (!tarballName) throw new Error('npm pack produced no tarball');
  execSync(
    `tar -xzf ${path.join(tmp, tarballName)} -C ${target} --strip-components=1`,
    { stdio: 'inherit' },
  );
  await rmrf(tmp);

  if (preservedReadme) {
    await fs.writeFile(path.join(target, 'README.md'), preservedReadme, 'utf8');
  }

  // The `vscode-web` npm package keeps the runtime under `dist/`
  // (dist/out, dist/extensions, dist/node_modules, dist/manifest.json,
  // dist/favicon.ico, …). We flatten that one level so URLs at runtime
  // are `/vscode-web/out/...` (matching microsoft/vscode's workbench.html).
  const distDir = path.join(target, 'dist');
  if (await exists(distDir)) {
    await moveContents(distDir, target);
  }
  await fs.writeFile(stamp, `${VSCODE_WEB_VERSION}\n`, 'utf8');
  return target;
}

async function vendorCheerpX() {
  const target = path.join(WEB_ROOT, 'cheerpx');
  const stamp = path.join(target, '.version');
  try {
    const existing = await fs.readFile(stamp, 'utf8');
    if (existing.trim() === CHEERPX_VERSION) {
      console.log(`[cheerpx] already at ${CHEERPX_VERSION}, skipping`);
      return target;
    }
  } catch {}

  console.log(`[cheerpx] vendoring cheerpx@${CHEERPX_VERSION} from CDN`);
  await ensureDir(target);
  for (const entry of await fs.readdir(target)) {
    if (entry === 'README.md' || entry === '.version') continue;
    await rmrf(path.join(target, entry));
  }

  // cx_esm.js is the actual ESM payload; cx.esm.js is a thin re-export
  // wrapper. cx.js is the script-tag entrypoint. cheerpOS.js is the
  // helper the engine `import()`s at runtime to drive the guest
  // syscalls (resolved relative to the engine's URL — vendored alongside
  // it). cx.wasm is the engine (sometimes missing on the CDN — fall
  // back to the runtime fetch).
  // CheerpX 1.2.x ships its runtime as a constellation of assets that
  // the engine `import()`s at runtime relative to its own URL. We
  // mirror the full set so the page never has to fall back to the CDN
  // mid-boot — this keeps GitHub Pages self-sufficient and aligned with
  // the issue's "fully anonymous, zero-signup, zero-backend" goal.
  //
  // The list was derived by `grep -oE '"[a-zA-Z_/.-]+\.(js|wasm|json)"' cx.js`
  // and verified against the LT CDN; assets that 204 here ship inline
  // inside the corresponding .js (the engine knows how to find them).
  const files = [
    'cx_esm.js',
    'cx.esm.js',
    'cx.js',
    'cxcore.js',
    'cxcore-no-return-call.js',
    'cxcore.wasm',
    // Loaded when the browser lacks WebAssembly tail-call support
    // (Safari, older Chromium). Omitting it makes cxcore-no-return-call.js
    // 404 on its sibling .wasm and CheerpX init crashes with
    // `expected magic word 00 61 73 6d, found 3c 21 44 4f` (the 4 bytes
    // are `<!DO`, GitHub Pages' SPA-404 HTML).
    'cxcore-no-return-call.wasm',
    'cxbridge.js',
    'cxbridge.wasm',
    'cheerpOS.js',
    'cheerpOS.wasm',
    'cx.wasm',
    'fail.wasm',
    'workerclock.js',
    'tun/direct.js',
    'tun/tailscale_tun_auto.js',
    'tun/tailscale_tun.js',
    'tun/tailscale_tun.wasm',
    'tun/wasm_exec.js',
    'tun/ipstack.js',
    'tun/ipstack.wasm',
  ];
  const baseUrl = `https://cxrtnc.leaningtech.com/${CHEERPX_VERSION}`;
  for (const f of files) {
    const url = `${baseUrl}/${f}`;
    const dest = path.join(target, f);
    await ensureDir(path.dirname(dest));
    process.stdout.write(`  fetch ${url} -> ${dest} ... `);
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      if (f === 'cx.esm.js' || f === 'cx_esm.js') {
        throw new Error(
          `required CheerpX asset missing: ${url} -> ${res.status}`,
        );
      }
      console.log(`skipped (HTTP ${res.status}, body=${!!res.body})`);
      continue;
    }
    const out = createWriteStream(dest);
    await pipeline(Readable.fromWeb(res.body), out);
    console.log('ok');
  }
  await fs.writeFile(stamp, `${CHEERPX_VERSION}\n`, 'utf8');
  return target;
}

async function copyExtension(srcRel, destRel, name) {
  const src = path.join(WEB_ROOT, 'extensions', srcRel);
  // Copy alongside the workbench's own extensions so the AMD loader
  // serves them from the same origin tree.
  const dest = path.join(WEB_ROOT, 'vscode-web', 'extensions', destRel);
  await rmrf(dest);
  await ensureDir(dest);
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    if (entry.name === 'README.md') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      execSync(`cp -R ${from} ${to}`);
    } else {
      await fs.copyFile(from, to);
    }
  }
  console.log(`[ext] vendored ${name} -> ${dest}`);
  return dest;
}

function buildExtensionPointers() {
  // additionalBuiltinExtensions: pointers to our two extensions, both
  // served from the same origin under `<base>/extensions/<name>`.
  // {ORIGIN_*} substitute the live scheme + host; {BASE_PATH} substitutes
  // the directory the page is served from (e.g. `/rust-web-box` on
  // GitHub Pages, empty on a root-mounted dev server) — without this,
  // VS Code Web requests `/extensions/...` and 404s on Pages, which
  // is the root cause of issue #3.
  return [
    {
      scheme: '{ORIGIN_SCHEME}',
      authority: '{ORIGIN_HOST}',
      path: '{BASE_PATH}/extensions/webvm-host',
    },
    {
      scheme: '{ORIGIN_SCHEME}',
      authority: '{ORIGIN_HOST}',
      path: '{BASE_PATH}/extensions/rust-analyzer-web',
    },
  ];
}

async function writeProductJson() {
  // The AMD bootstrap (`workbench.js` shipped by vscode-web) reads
  // `product.json` next to the page when no `window.product` is set.
  const product = {
    nameShort: 'rust-web-box',
    nameLong: 'rust-web-box',
    applicationName: 'rust-web-box',
    enableTelemetry: false,
    additionalBuiltinExtensions: buildExtensionPointers(),
    folderUri: { scheme: 'webvm', authority: '', path: '/workspace' },
    defaultLayout: {
      panel: { visible: true },
      views: [{ id: 'workbench.view.explorer', visible: true }],
    },
  };
  const out = path.join(WEB_ROOT, 'product.json');
  await fs.writeFile(out, JSON.stringify(product, null, 2), 'utf8');
  console.log(`[product] wrote ${out}`);
}

async function renderIndex() {
  const tmplPath = path.join(__dirname, 'index.template.html');
  const outPath = path.join(WEB_ROOT, 'index.html');
  let tmpl;
  try {
    tmpl = await fs.readFile(tmplPath, 'utf8');
  } catch {
    console.log('[index] template not found, leaving existing index.html in place');
    return;
  }

  const ourExts = buildExtensionPointers();
  const config = {
    productConfiguration: {
      nameShort: 'rust-web-box',
      nameLong: 'rust-web-box',
      applicationName: 'rust-web-box',
      enableTelemetry: false,
    },
    additionalBuiltinExtensions: ourExts,
    folderUri: { scheme: 'webvm', authority: '', path: '/workspace' },
    defaultLayout: {
      panel: { visible: true },
      views: [{ id: 'workbench.view.explorer', visible: true }],
    },
  };

  const escaped = JSON.stringify(config).replace(/"/g, '&quot;');
  const rendered = tmpl
    .replaceAll('{{WORKBENCH_WEB_CONFIGURATION}}', escaped)
    .replaceAll('{{VSCODE_WEB_VERSION}}', VSCODE_WEB_VERSION)
    .replaceAll('{{CHEERPX_VERSION}}', CHEERPX_VERSION);

  await fs.writeFile(outPath, rendered, 'utf8');
  console.log(`[index] wrote ${outPath}`);
}

async function main() {
  await ensureDir(WEB_ROOT);
  console.log('repo root:', REPO_ROOT);
  console.log('web root:', WEB_ROOT);

  const skipVscode = process.env.SKIP_VSCODE_WEB === '1';
  const skipCheerpX = process.env.SKIP_CHEERPX === '1';

  if (!skipVscode) {
    try {
      await vendorVSCodeWeb();
      await copyExtension('webvm-host', 'webvm-host', 'webvm-host');
      await copyExtension('rust-analyzer-web', 'rust-analyzer-web', 'rust-analyzer-web');
    } catch (err) {
      console.warn(`[vscode-web] vendoring failed: ${err.message}`);
      console.warn('[vscode-web] continuing — page will fall back to boot shell');
    }
  } else {
    console.log('[vscode-web] SKIP_VSCODE_WEB=1, skipping');
  }

  if (!skipCheerpX) {
    try {
      await vendorCheerpX();
    } catch (err) {
      console.warn(`[cheerpx] vendoring failed: ${err.message}`);
      console.warn('[cheerpx] continuing — page will fall back to CDN at runtime');
    }
  } else {
    console.log('[cheerpx] SKIP_CHEERPX=1, skipping');
  }

  await writeProductJson();
  await renderIndex();
  console.log('[build] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
