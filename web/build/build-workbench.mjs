#!/usr/bin/env node
// Build the workbench entry page for rust-web-box.
//
// What it does:
//   1. Vendors the upstream `vscode-web` npm package into `web/vscode-web/`.
//      The package ships the `out/`, `extensions/`, and supporting assets
//      that match an upstream `microsoft/vscode` web build.
//   2. Vendors the CheerpX runtime into `web/cheerpx/`. We pin a known
//      version and copy `cx.esm.js` plus its WASM/auxiliary files.
//   3. Renders `web/index.html` from `web/build/index.template.html`,
//      substituting workbench configuration that lists our two web
//      extensions as `additionalBuiltinExtensions`.
//
// Run via `node web/build/build-workbench.mjs` (no transitive deps —
// only Node stdlib). The pages workflow runs this after `npm ci` in
// `web/build/`.
//
// The script is idempotent: re-running it overwrites the vendored copies
// and the rendered index.

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
const VSCODE_WEB_VERSION = '1.91.1'; // pinned per issue #1 open question 1
const CHEERPX_VERSION = '1.2.8';

// ---------------------------------------------------------------------------

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
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
  } catch {
    // first run; fall through
  }

  console.log(`[vscode-web] vendoring vscode-web@${VSCODE_WEB_VERSION}`);
  await rmrf(target);
  await ensureDir(target);

  // Use `npm pack` from a fresh temp dir so we don't pull in a node_modules
  // tree into the published artifact.
  const tmp = path.join(WEB_ROOT, '.tmp-vscode-web');
  await rmrf(tmp);
  await ensureDir(tmp);
  execSync(
    `npm pack vscode-web@${VSCODE_WEB_VERSION} --silent`,
    { cwd: tmp, stdio: 'inherit' },
  );
  const tarballName = (await fs.readdir(tmp))
    .find((n) => n.endsWith('.tgz'));
  if (!tarballName) throw new Error('npm pack produced no tarball');
  // Extract: `tar -xzf … -C target --strip-components=1`
  execSync(
    `tar -xzf ${path.join(tmp, tarballName)} -C ${target} --strip-components=1`,
    { stdio: 'inherit' },
  );
  await rmrf(tmp);
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
  // Preserve any README that was already there, but remove any old binary
  // files left from a prior version.
  for (const entry of await fs.readdir(target)) {
    if (entry === 'README.md') continue;
    await rmrf(path.join(target, entry));
  }

  const files = [
    'cx.esm.js',
    'cx.js',
    'cx.wasm',
  ];
  // Best-effort: `cx.esm.js` is required; the rest are supplementary.
  // The CDN serves these as static assets.
  const baseUrl = `https://cxrtnc.leaningtech.com/${CHEERPX_VERSION}`;
  for (const f of files) {
    const url = `${baseUrl}/${f}`;
    const dest = path.join(target, f);
    process.stdout.write(`  fetch ${url} -> ${dest} ... `);
    const res = await fetch(url);
    if (!res.ok) {
      if (f === 'cx.esm.js') {
        throw new Error(`required CheerpX asset missing: ${url} -> ${res.status}`);
      }
      console.log(`skipped (HTTP ${res.status})`);
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

  // additionalBuiltinExtensions: pointers to our two extensions, served
  // from the same origin under `extensions/`.
  const ourExts = [
    {
      scheme: '{ORIGIN_SCHEME}',
      authority: '{ORIGIN_HOST}',
      path: '/extensions/webvm-host',
    },
    {
      scheme: '{ORIGIN_SCHEME}',
      authority: '{ORIGIN_HOST}',
      path: '/extensions/rust-analyzer-web',
    },
  ];

  const config = {
    productConfiguration: {
      nameShort: 'rust-web-box',
      nameLong: 'rust-web-box',
      applicationName: 'rust-web-box',
      enableTelemetry: false,
    },
    additionalBuiltinExtensions: ourExts,
    folderUri: { scheme: 'webvm', authority: '', path: '/workspace' },
  };

  const escaped = JSON.stringify(config).replace(/"/g, '&quot;');
  const rendered = tmpl
    .replaceAll('{{WORKBENCH_WEB_CONFIGURATION}}', escaped)
    .replaceAll('{{VSCODE_WEB_VERSION}}', VSCODE_WEB_VERSION)
    .replaceAll('{{CHEERPX_VERSION}}', CHEERPX_VERSION);

  await fs.writeFile(outPath, rendered, 'utf8');
  console.log(`[index] wrote ${outPath}`);
}

async function copyExtensionsToServeRoot() {
  // Even if VS Code Web isn't vendored yet, we still serve our extensions
  // at /extensions/<name>/ so the workbench can find them at runtime.
  const root = path.join(WEB_ROOT, 'extensions');
  for (const ext of ['webvm-host', 'rust-analyzer-web']) {
    const target = path.join(root, ext);
    // The source already lives here; nothing to do unless we're flattening.
    await fs.access(target).catch(() => {
      throw new Error(`extension ${ext} not found at ${target}`);
    });
  }
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

  await copyExtensionsToServeRoot();
  await renderIndex();
  console.log('[build] done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
