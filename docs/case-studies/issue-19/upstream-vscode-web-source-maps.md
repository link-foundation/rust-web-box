## Environment

- Package: `vscode-web@1.91.1`
- Package repository: https://github.com/Felx-B/vscode-web
- Downstream app: https://github.com/link-foundation/rust-web-box
- Downstream issue: https://github.com/link-foundation/rust-web-box/issues/19

## Reproduction

```sh
tmp="$(mktemp -d)"
cd "$tmp"
npm pack vscode-web@1.91.1 --silent
tar -xzf vscode-web-1.91.1.tgz
find package -name '*.map' | wc -l
grep -R "sourceMappingURL=.*\\.map" package/dist/out package/dist/node_modules
```

Then serve the package from a static site and open browser developer tools.

## Observed

The npm tarball contains JavaScript bundles with `sourceMappingURL` comments, but the referenced source-map files are not shipped in the package. Browsers report source-map loading errors such as:

```text
main.js.map
addon-unicode11.js.map
addon-clipboard.js.map
addon-webgl.js.map
xterm.js.map
workbench.js.map
layout.contribution.darwin.js.map
```

## Expected

The package should either include the referenced source maps or strip/rewrite source-map comments during packaging so static downstream sites do not produce 404s in developer tools.

## Impact

Source-map 404s mask real application warnings/errors during browser-console triage.

## Workaround

`rust-web-box` now generates local empty source-map stubs for missing relative source-map references during its static build, but each downstream package consumer would otherwise need to add a similar workaround.
