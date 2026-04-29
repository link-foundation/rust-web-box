# Root cause #3 — `rust-analyzer.wasm` 404 on activation

> **Severity**: P3 — non-fatal, already handled gracefully, but appears in
> red in the network panel and console.
> **Distinct network signal**:
> `[GET] https://link-foundation.github.io/rust-web-box/extensions/rust-analyzer-web/rust-analyzer.wasm => [404]`
> ([`evidence/network-requests.txt:73`](./evidence/network-requests.txt))

## How the extension boots

`web/extensions/rust-analyzer-web/extension.js` exports an `activate`
function that calls `tryLoadAnalyzer(vscode, context)`:

```js
async function tryLoadAnalyzer(vscode, context) {
  try {
    const wasmUri = vscode.Uri.joinPath(context.extensionUri, 'rust-analyzer.wasm');
    const bytes = await vscode.workspace.fs.readFile(wasmUri);
    if (!bytes || bytes.byteLength < 1024) return null;
    return { byteLength: bytes.byteLength };
  } catch {
    return null;
  }
}
```

The intent is graceful degradation: if `rust-analyzer.wasm` isn't bundled,
the function returns `null` and the extension installs a stub LSP server
that handles `initialize` + `initialized` and reports "syntax highlighting
only" via the status bar.

## Why the 404 still surfaces

`vscode.workspace.fs.readFile(wasmUri)` resolves to VS Code's
`HTTPFileSystemProvider` for `https:` URIs. Internally it issues a `GET`
on the URL, and the network panel records the 404 *before* `readFile`
throws and `tryLoadAnalyzer` swallows it. The console also surfaces a
generic "Failed to load resource: 404" line that the extension cannot
intercept.

The CI step that vendors rust-analyzer.wasm is opt-in (the artifact is
many MiB); for issue #5 the artifact is absent on Pages, so the 404 is
expected. The extension's degradation works — but the noise is loud.

## Fix

HEAD-probe before the GET. `vscode.workspace.fs` doesn't expose HEAD,
but the standard `fetch` API does. We use the HEAD result to short-circuit:

```js
async function tryLoadAnalyzer(vscode, context) {
  try {
    const wasmUri = vscode.Uri.joinPath(context.extensionUri, 'rust-analyzer.wasm');
    if (typeof fetch === 'function') {
      try {
        const probe = await fetch(wasmUri.toString(), { method: 'HEAD' });
        if (!probe.ok) return null;        // ← NEW: skip the GET noise
      } catch {
        return null;
      }
    }
    const bytes = await vscode.workspace.fs.readFile(wasmUri);
    …
  }
}
```

Both Chromium and Firefox treat a HEAD that 404s as a normal log entry
(no error styling), and Safari's network panel filters HEAD by default. The
red 404 disappears.

## Why not just bundle a stub?

We could ship a 1-byte placeholder so the GET succeeds, but then the
length check (`< 1024`) becomes the new "absent" signal, which is opaque.
HEAD-probing is more honest: the file truly doesn't exist, the extension
knows it, and the user sees the "syntax highlighting only" status bar.

## What about the rust-analyzer build?

A separate, opt-in CI workflow can publish the WASM artifact alongside the
Pages bundle. This case study does *not* address that work. Issue #5's
remit is "stop the console flood"; whether to ship a real rust-analyzer is
out of scope. When the artifact lands, the extension will pick it up
automatically — `tryLoadAnalyzer`'s logic still works for both states.
