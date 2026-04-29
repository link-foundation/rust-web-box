// Pure helpers for substituting placeholders in the workbench
// configuration. Extracted from boot.js so the same logic can be
// imported by Node tests (which can't load boot.js because it touches
// `document`/`location` at module-init time).
//
// Placeholders:
//   {ORIGIN_SCHEME}  → location.protocol without ":" (e.g. "https")
//   {ORIGIN_HOST}    → location.host (e.g. "link-foundation.github.io")
//   {BASE_PATH}      → directory the page is served from, no trailing slash
//                      (e.g. "/rust-web-box" on GitHub Pages, "" on a
//                      root-mounted dev server)
//
// {BASE_PATH} is the issue-#3 fix. Without it, additionalBuiltinExtensions
// resolved to /extensions/... and 404'd on Pages, breaking the whole
// workbench. See docs/case-studies/issue-3/analysis-extension-base-path.md.

export function applyWorkbenchPlaceholders(cfg, { scheme, host, basePath } = {}) {
  if (!cfg || typeof cfg !== 'object') return cfg;
  if (!Array.isArray(cfg.additionalBuiltinExtensions)) return cfg;
  for (const ext of cfg.additionalBuiltinExtensions) {
    if (!ext || typeof ext !== 'object') continue;
    if (ext.scheme === '{ORIGIN_SCHEME}') ext.scheme = scheme;
    if (ext.authority === '{ORIGIN_HOST}') ext.authority = host;
    if (typeof ext.path === 'string') {
      if (ext.path.startsWith('{BASE_PATH}')) {
        ext.path = (basePath ?? '') + ext.path.slice('{BASE_PATH}'.length);
      } else if (basePath && !ext.path.startsWith(basePath + '/') && ext.path.startsWith('/extensions/')) {
        // Belt-and-braces: even a stale build artifact (or a hand-edited
        // index.html) without the placeholder gets the deploy base
        // injected, so the issue-#3 regression cannot silently come back.
        ext.path = basePath + ext.path;
      }
    }
  }
  return cfg;
}
