import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  chunkDiskImage,
  stageManifestForGitHubDevice,
} from '../build/stage-pages-disk.mjs';

test('stage-pages-disk: writes WebVM GitHubDevice chunks plus .meta', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rust-web-box-disk-'));
  try {
    const source = path.join(dir, 'source.ext2');
    const outDir = path.join(dir, 'out');
    await fs.writeFile(source, Buffer.from('abcdefghij'));

    const result = await chunkDiskImage(source, {
      outDir,
      imageName: 'rust-alpine.ext2',
      chunkSize: 4,
    });

    assert.deepEqual(result, {
      byteLength: 10,
      chunkCount: 3,
      imageName: 'rust-alpine.ext2',
    });
    assert.equal(
      await fs.readFile(path.join(outDir, 'rust-alpine.ext2.meta'), 'utf8'),
      '10\n',
    );
    assert.equal(
      await fs.readFile(path.join(outDir, 'rust-alpine.ext2.c000000.txt'), 'utf8'),
      'abcd',
    );
    assert.equal(
      await fs.readFile(path.join(outDir, 'rust-alpine.ext2.c000001.txt'), 'utf8'),
      'efgh',
    );
    assert.equal(
      await fs.readFile(path.join(outDir, 'rust-alpine.ext2.c000002.txt'), 'utf8'),
      'ij',
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('stage-pages-disk: removes stale chunks before writing a new image', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rust-web-box-disk-'));
  try {
    const source = path.join(dir, 'source.ext2');
    const outDir = path.join(dir, 'out');
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(outDir, 'rust-alpine.ext2.c999999.txt'), 'stale');
    await fs.writeFile(path.join(outDir, 'rust-alpine.ext2.meta'), '999\n');
    await fs.writeFile(source, Buffer.from('xy'));

    await chunkDiskImage(source, {
      outDir,
      imageName: 'rust-alpine.ext2',
      chunkSize: 4,
    });

    const files = await fs.readdir(outDir);
    assert.deepEqual(files.sort(), [
      'rust-alpine.ext2.c000000.txt',
      'rust-alpine.ext2.meta',
    ]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('stage-pages-disk: manifest warm entry is converted to same-origin GitHubDevice layout', () => {
  const staged = stageManifestForGitHubDevice({
    default: { kind: 'cloud', url: 'wss://disks.webvm.io/fallback.ext2' },
    warm: {
      kind: 'release-asset',
      url: 'https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2',
      release_tag: 'disk-latest',
      rust: true,
      alpine: true,
    },
  });

  assert.equal(staged.warm.kind, 'github');
  assert.equal(staged.warm.url, './disk/rust-alpine.ext2');
  assert.equal(
    staged.warm.source_release_url,
    'https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2',
  );
});
