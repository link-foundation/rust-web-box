# Root cause #1 — `additionalBuiltinExtensions` lose the deploy base path

## What the user sees

The screenshot in [issue #3](https://github.com/link-foundation/rust-web-box/issues/3)
shows a VS Code Web workbench with:

* The Welcome page, no editor tab for `hello_world.rs`.
* The Explorer side bar with a `webvm` folder and the message **"An error
  occurred while loading the workspace folder contents."** plus a
  **"Retry"** button.
* The status bar shows "0" / no extensions.
* The terminal panel is closed.

## Direct evidence

Captured by Playwright against <https://link-foundation.github.io/rust-web-box/>
on 2026‑04‑29 at 16:46 UTC. Saved as
`evidence/console-first-load.log`.

```
[ 1786 ms] [ERROR] Failed to load resource: status 404
    @ https://link-foundation.github.io/extensions/webvm-host/package.json
[ 1786 ms] [INFO] Request to '.../extensions/webvm-host/package.json' failed with status code 404
[ 1786 ms] [INFO] Error while fetching the additional builtin extension
    https://link-foundation.github.io/extensions/webvm-host. ...
[ 1788 ms] [ERROR] Failed to load resource: status 404
    @ https://link-foundation.github.io/extensions/rust-analyzer-web/package.json
... (same pattern repeats 13 times for each extension; VS Code retries)
[ 1493 ms] [WARN] Ignoring the error while validating workspace folder
    webvm:/workspace - ENOPRO: No file system provider found for resource 'webvm:/workspace'
[ 2522 ms] [ERROR] ENOPRO: No file system provider found for resource 'webvm:/workspace': CodeExpectedError
```

Independent verification with `curl`:

```sh
$ curl -sI https://link-foundation.github.io/extensions/webvm-host/package.json | head -2
HTTP/2 404
server: GitHub.com

$ curl -sI https://link-foundation.github.io/rust-web-box/extensions/webvm-host/package.json | head -2
HTTP/2 200
content-type: application/json; charset=utf-8
```

The extension **is** deployed correctly under `/rust-web-box/extensions/...`
but the workbench requests it from `/extensions/...`.

## Why

The workbench config carries an `additionalBuiltinExtensions` list of
`UriComponents`:

```jsonc
// web/index.html:23 (decoded)
"additionalBuiltinExtensions": [
  { "scheme": "{ORIGIN_SCHEME}", "authority": "{ORIGIN_HOST}",
    "path": "/extensions/webvm-host" },
  { "scheme": "{ORIGIN_SCHEME}", "authority": "{ORIGIN_HOST}",
    "path": "/extensions/rust-analyzer-web" }
]
```

At runtime two pieces of code substitute placeholders:

* `web/index.html:86–93` (inline `<script>` — runs synchronously before the
  AMD loader's `workbench.js` reads `window.product`).
* `web/glue/boot.js:55–75` (`patchWorkbenchConfig()` — defensive copy that
  runs as the page module).

Both substitute **`scheme` and `authority` only**. `path` is left as
`/extensions/webvm-host` — an *absolute* path on the host, which under
GitHub Pages resolves to `https://link-foundation.github.io/extensions/...`
and 404s.

`UriComponents.path` is **host‑absolute** (this matches WHATWG URL
semantics: a leading `/` makes the path relative to the host root, not to
the current document). The placeholder needs to include the deploy base.

## Why CI didn't catch it

`web/tests/boot-shell.test.mjs:36–38` greps the rendered HTML for the
*literal* string `"/extensions/webvm-host"` and confirms it's there:

```js
assert.match(html, /\/extensions\/webvm-host/);
```

That's a useful presence check but it never simulates the runtime
substitution against a non‑root URL. The Playwright smoke test
(`web/tests/playwright-smoke.mjs`) runs against a Node static server
mounted at `/`, where `/extensions/...` happens to resolve correctly. The
deployment topology — page lives at `/rust-web-box/`, extensions live at
`/rust-web-box/extensions/` — is never exercised in CI.

## Fix

### A. Inline bootstrap in `web/index.html`

```diff
 cfg.additionalBuiltinExtensions.forEach(function (e) {
   if (e && e.scheme === '{ORIGIN_SCHEME}') e.scheme = scheme;
   if (e && e.authority === '{ORIGIN_HOST}') e.authority = host;
+  // The page may live under a sub-path (GitHub Pages → /rust-web-box/).
+  // `e.path` is host-absolute, so we prepend the directory in which
+  // *this* document was served. Without this the URL becomes
+  // https://host/extensions/... and 404s on Pages.
+  if (e && typeof e.path === 'string' && e.path.startsWith('/extensions/')) {
+    var base = new URL('./', location.href).pathname.replace(/\/$/, '');
+    e.path = base + e.path;
+  }
 });
```

### B. `patchWorkbenchConfig()` in `web/glue/boot.js`

Same change. Keep the two copies in sync; the boot.js copy is the
"defensive" one in case the inline script is missing (e.g. a custom
`index.html` is shipped).

### C. (Optional) emit a `{BASE_PATH}` placeholder in the build

`web/build/build-workbench.mjs:240` returns the extension pointers. If we
introduce a `{BASE_PATH}` placeholder, the substituting code can do an
exact string replace rather than a heuristic check on `startsWith
'/extensions/'`. That's slightly more robust for future extension
additions.

## Verification

A regression test in `web/tests/extension-paths.test.mjs` (new) will run
the substitution code against three synthetic `location.href` values:

| `location.href`                                       | Expected resolved extension URL                                       |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| `https://localhost:8080/`                             | `https://localhost:8080/extensions/webvm-host`                        |
| `https://link-foundation.github.io/rust-web-box/`     | `https://link-foundation.github.io/rust-web-box/extensions/webvm-host` |
| `https://example.com/foo/bar/`                        | `https://example.com/foo/bar/extensions/webvm-host`                   |

Plus a Playwright assertion that boots the page on a sub‑path
(`/rust-web-box/`) via a Node static server with a path prefix and
confirms the workbench shows `hello_world.rs` in the Explorer within 5 s.

## Upstream report

A documentation issue should be filed against `microsoft/vscode-web`
asking the README to clarify that `additionalBuiltinExtensions[].path` is
host‑absolute, not page‑relative. This is one line of doc but would have
prevented the bug.
