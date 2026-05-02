import { promises as fs } from 'node:fs';
import path from 'node:path';

const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.css']);
const SOURCE_MAP_RE =
  /(?:\/\/[#@]\s*sourceMappingURL=([^\s]+)|\/\*[#@]\s*sourceMappingURL=([^*]+)\*\/)/g;

export function parseSourceMapUrls(text) {
  const urls = [];
  for (const match of text.matchAll(SOURCE_MAP_RE)) {
    const raw = (match[1] ?? match[2] ?? '').trim();
    if (raw) urls.push(raw);
  }
  return urls;
}

export function localSourceMapPath(sourceFile, rawUrl) {
  const withoutFragment = rawUrl.split('#', 1)[0];
  const withoutQuery = withoutFragment.split('?', 1)[0];
  if (!withoutQuery || withoutQuery.startsWith('/')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(withoutQuery)) return null;
  if (!withoutQuery.endsWith('.map')) return null;
  try {
    return path.resolve(path.dirname(sourceFile), decodeURIComponent(withoutQuery));
  } catch {
    return null;
  }
}

export async function writeMissingSourceMapStubs({ roots, logger = console } = {}) {
  const files = [];
  for (const root of roots ?? []) {
    if (!(await exists(root))) continue;
    await collectTextFiles(root, files);
  }

  let written = 0;
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    for (const rawUrl of parseSourceMapUrls(source)) {
      const mapPath = localSourceMapPath(file, rawUrl);
      if (!mapPath || (await exists(mapPath))) continue;
      await fs.mkdir(path.dirname(mapPath), { recursive: true });
      const stub = {
        version: 3,
        file: path.basename(file),
        sources: [path.basename(file)],
        names: [],
        mappings: '',
      };
      await fs.writeFile(mapPath, `${JSON.stringify(stub)}\n`, 'utf8');
      written += 1;
      logger?.log?.(`[sourcemap] wrote stub ${mapPath}`);
    }
  }
  if (written === 0) logger?.log?.('[sourcemap] no missing local source maps found');
  return written;
}

async function collectTextFiles(root, out) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const p = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await collectTextFiles(p, out);
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(p);
    }
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
