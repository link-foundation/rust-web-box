import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  localSourceMapPath,
  parseSourceMapUrls,
  writeMissingSourceMapStubs,
} from '../build/source-map-stubs.mjs';

test('source-map-stubs: parses line and block sourceMappingURL comments', () => {
  assert.deepEqual(
    parseSourceMapUrls([
      'console.log("one");',
      '//# sourceMappingURL=main.js.map',
      '/*# sourceMappingURL=style.css.map */',
    ].join('\n')),
    ['main.js.map', 'style.css.map'],
  );
});

test('source-map-stubs: only resolves local .map URLs', () => {
  const file = path.join(os.tmpdir(), 'rust-web-box-test', 'main.js');
  assert.equal(localSourceMapPath(file, 'main.js.map'), path.join(path.dirname(file), 'main.js.map'));
  assert.equal(localSourceMapPath(file, 'maps/main.js.map?v=1'), path.join(path.dirname(file), 'maps/main.js.map'));
  assert.equal(localSourceMapPath(file, 'https://example.test/main.js.map'), null);
  assert.equal(localSourceMapPath(file, 'data:application/json;base64,e30='), null);
  assert.equal(localSourceMapPath(file, '/absolute/main.js.map'), null);
});

test('source-map-stubs: writes valid JSON stubs for missing local maps', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rust-web-box-sourcemaps-'));
  const app = path.join(root, 'app.js');
  const worker = path.join(root, 'nested', 'worker.js');
  const remote = path.join(root, 'remote.js');
  await fs.mkdir(path.dirname(worker), { recursive: true });
  await fs.writeFile(app, 'console.log("app");\n//# sourceMappingURL=app.js.map\n', 'utf8');
  await fs.writeFile(worker, 'console.log("worker");\n//# sourceMappingURL=maps/worker.js.map\n', 'utf8');
  await fs.writeFile(remote, 'console.log("remote");\n//# sourceMappingURL=https://cdn.example.test/remote.js.map\n', 'utf8');

  const logs = [];
  const count = await writeMissingSourceMapStubs({
    roots: [root],
    logger: { log: (msg) => logs.push(msg) },
  });

  assert.equal(count, 2);
  assert.ok(logs.some((line) => line.includes('app.js.map')));
  const appMap = JSON.parse(await fs.readFile(path.join(root, 'app.js.map'), 'utf8'));
  const workerMap = JSON.parse(await fs.readFile(path.join(root, 'nested', 'maps', 'worker.js.map'), 'utf8'));
  assert.equal(appMap.version, 3);
  assert.equal(appMap.file, 'app.js');
  assert.equal(workerMap.version, 3);
  assert.equal(workerMap.file, 'worker.js');
  await assert.rejects(() => fs.access(path.join(root, 'remote.js.map')));
});
