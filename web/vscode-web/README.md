# vscode-web/

VS Code Web bundle vendored from the `vscode-web` npm package
(community fork that publishes upstream `microsoft/vscode` `web` builds).

CI populates this directory on every Pages build via
`web/build/build-workbench.mjs`. The pinned version lives in that
script's `VSCODE_WEB_VERSION` constant.

Contents after a build:

- `out/` — the workbench JS, CSS, and NLS messages.
- `extensions/` — extensions vendored alongside the bundle. The build
  step also copies `web/extensions/webvm-host` and
  `web/extensions/rust-analyzer-web` here so they're served at the same
  origin.
- `.version` — stamp file the build script uses to detect cache hits.

Bumping the version: edit `VSCODE_WEB_VERSION` in
`web/build/build-workbench.mjs` and re-run the build script (or push to
trigger CI).
