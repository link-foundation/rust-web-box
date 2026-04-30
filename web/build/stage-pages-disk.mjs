#!/usr/bin/env node
// Stage the warm Rust disk image into the GitHub Pages artifact.
//
// Browser JavaScript cannot read GitHub Release assets directly because
// the download URL redirects to release-assets.githubusercontent.com
// without CORS headers. CI can download that same asset server-side,
// split it into the chunk layout CheerpX.GitHubDevice expects, and
// deploy the chunks under the Pages origin.

import { promises as fs } from 'node:fs';
import { createWriteStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const DISK_DIR = path.join(WEB_ROOT, 'disk');
const MANIFEST_PATH = path.join(DISK_DIR, 'manifest.json');
const DEFAULT_IMAGE_NAME = 'rust-alpine.ext2';
const DEFAULT_CHUNK_SIZE = 128 * 1024;
const MIN_EXPECTED_DISK_BYTES = 10 * 1024 * 1024;

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function removeStagedDisk(outDir, imageName, sourcePath) {
  await fs.mkdir(outDir, { recursive: true });
  const sourceAbs = sourcePath ? path.resolve(sourcePath) : null;
  for (const entry of await fs.readdir(outDir)) {
    const p = path.join(outDir, entry);
    if (sourceAbs && path.resolve(p) === sourceAbs) continue;
    if (
      entry === imageName ||
      entry === `${imageName}.meta` ||
      (entry.startsWith(`${imageName}.c`) && entry.endsWith('.txt'))
    ) {
      await fs.rm(p, { force: true });
    }
  }
}

export async function chunkDiskImage(sourcePath, {
  outDir = DISK_DIR,
  imageName = DEFAULT_IMAGE_NAME,
  chunkSize = DEFAULT_CHUNK_SIZE,
} = {}) {
  if (!sourcePath) throw new TypeError('chunkDiskImage requires a source path');
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new TypeError('chunkSize must be a positive integer');
  }

  await removeStagedDisk(outDir, imageName, sourcePath);

  const handle = await fs.open(sourcePath, 'r');
  const buffer = Buffer.allocUnsafe(chunkSize);
  let byteLength = 0;
  let chunkCount = 0;
  try {
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, null);
      if (bytesRead === 0) break;
      const suffix = chunkCount.toString(16).padStart(6, '0');
      await fs.writeFile(
        path.join(outDir, `${imageName}.c${suffix}.txt`),
        buffer.subarray(0, bytesRead),
      );
      byteLength += bytesRead;
      chunkCount += 1;
    }
  } finally {
    await handle.close();
  }

  await fs.writeFile(path.join(outDir, `${imageName}.meta`), `${byteLength}\n`, 'utf8');
  return { byteLength, chunkCount, imageName };
}

export function stageManifestForGitHubDevice(manifest, {
  imageName = DEFAULT_IMAGE_NAME,
  diskPath = `./disk/${imageName}`,
  sourceUrl,
  chunkSize = DEFAULT_CHUNK_SIZE,
} = {}) {
  const staged = JSON.parse(JSON.stringify(manifest || {}));
  staged.warm = staged.warm || {};
  const previousUrl = staged.warm.url;
  staged.warm.kind = 'github';
  staged.warm.url = diskPath;
  staged.warm.chunk_size = chunkSize;
  staged.warm.source_release_url =
    sourceUrl || staged.warm.source_release_url || previousUrl || null;
  staged.warm.notes =
    'Pages-hosted CheerpX GitHubDevice chunks generated from the rolling disk-latest release asset. ' +
    'The browser must not fetch the GitHub Release asset directly because its redirect target is not CORS-readable.';
  return staged;
}

async function downloadToFile(url, dest, { token, logger = console } = {}) {
  if (!url) throw new TypeError('downloadToFile requires a URL');
  const headers = {};
  if (token && /^https:\/\/github\.com\//.test(url)) {
    headers.Authorization = `Bearer ${token}`;
    headers.Accept = 'application/octet-stream';
  }
  logger.log(`[disk] downloading ${url}`);
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const stat = await fs.stat(dest);
  return stat.size;
}

async function main() {
  const logger = console;
  if (process.env.STAGE_WARM_DISK === '0') {
    logger.log('[disk] STAGE_WARM_DISK=0, skipping warm disk staging');
    return;
  }
  const required = process.env.STAGE_WARM_DISK_REQUIRED !== '0';

  const manifest = JSON.parse(await fs.readFile(MANIFEST_PATH, 'utf8'));
  const sourceUrl =
    process.env.WARM_DISK_SOURCE_URL ||
    manifest?.warm?.source_release_url ||
    (/^https:\/\/github\.com\//.test(manifest?.warm?.url || '') ? manifest.warm.url : null);

  if (!sourceUrl) {
    const msg = '[disk] no release source URL configured, leaving warm disk unstaged';
    if (required) {
      logger.error(`${msg}; set STAGE_WARM_DISK_REQUIRED=0 only for explicit local fallback testing`);
      throw new Error('warm disk staging is required but no source URL is configured');
    }
    logger.log(msg);
    return;
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'rust-web-box-disk-'));
  const tmpDisk = path.join(tmpDir, DEFAULT_IMAGE_NAME);
  try {
    const bytes = await downloadToFile(sourceUrl, tmpDisk, {
      token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
      logger,
    });
    if (bytes < MIN_EXPECTED_DISK_BYTES) {
      throw new Error(`downloaded disk is unexpectedly small (${bytes} bytes)`);
    }
    const result = await chunkDiskImage(tmpDisk, {
      outDir: DISK_DIR,
      imageName: DEFAULT_IMAGE_NAME,
      chunkSize: DEFAULT_CHUNK_SIZE,
    });
    const stagedManifest = stageManifestForGitHubDevice(manifest, {
      imageName: DEFAULT_IMAGE_NAME,
      sourceUrl,
      chunkSize: DEFAULT_CHUNK_SIZE,
    });
    await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(stagedManifest, null, 2)}\n`, 'utf8');
    logger.log(
      `[disk] staged ${result.byteLength} bytes as ${result.chunkCount} chunks under web/disk/`,
    );
  } catch (err) {
    logger.warn(`[disk] warm disk staging failed: ${err?.message ?? err}`);
    if (required) {
      logger.error('[disk] warm disk staging is required; failing this build so production never ships without cargo.');
    } else {
      logger.warn('[disk] Pages will deploy without the warm disk; runtime will fall back to the default disk.');
    }
    if (required) throw err;
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
    if (await exists(path.join(DISK_DIR, DEFAULT_IMAGE_NAME))) {
      await fs.rm(path.join(DISK_DIR, DEFAULT_IMAGE_NAME), { force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
