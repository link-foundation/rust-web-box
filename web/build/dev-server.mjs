#!/usr/bin/env node
// Tiny COOP/COEP-aware static server for local development.
//
// `python3 -m http.server` doesn't set the Cross-Origin-Opener-Policy /
// Cross-Origin-Embedder-Policy headers CheerpX needs for
// `SharedArrayBuffer`, which means the Linux boot stalls when serving
// the page locally without our service worker (the SW takes over after
// the first load, but the first load in a fresh tab is uncached). This
// script serves `web/` with the right headers so local dev mirrors the
// Pages deployment from cycle one.
//
// Usage: `node web/build/dev-server.mjs [port]`

import http from 'node:http';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

async function serve(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  const fsPath = path.join(WEB_ROOT, urlPath);
  if (!fsPath.startsWith(WEB_ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  let stat;
  try {
    stat = await fs.stat(fsPath);
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  if (stat.isDirectory()) {
    res.writeHead(302, { Location: `${urlPath}/` });
    res.end();
    return;
  }
  const ext = path.extname(fsPath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cross-Origin-Opener-Policy': 'same-origin',
    // `credentialless` lets CheerpX stream the cross-origin Alpine
    // disk image from GitHub Releases without requiring CORP headers
    // on the upstream. Still gives us crossOriginIsolated===true
    // (SharedArrayBuffer + WASM threading) on this origin.
    'Cross-Origin-Embedder-Policy': 'credentialless',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  const fileHandle = await fs.open(fsPath);
  fileHandle.createReadStream().pipe(res);
}

const server = http.createServer((req, res) => {
  serve(req, res).catch((err) => {
    res.writeHead(500).end(String(err));
  });
});

server.listen(PORT, () => {
  console.log(`rust-web-box dev server: http://localhost:${PORT}/`);
  console.log(`(serving ${WEB_ROOT} with COOP/COEP headers)`);
});
