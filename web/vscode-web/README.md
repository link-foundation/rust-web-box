# vscode-web/

Static build output of `microsoft/vscode` at the `web` target — i.e. the
same bundle that powers `vscode.dev`.

**Not built yet.** When wired up, the CI pipeline:

1. Clones `microsoft/vscode` at a pinned tag (open question 1 in issue #1).
2. Runs `yarn` and `yarn gulp vscode-web-min`.
3. Copies the build output here.
4. Patches `product.json` to preinstall the `webvm-host` and
   `rust-analyzer-web` web extensions.

The bundle is large (~30 MB shipped JS); the service worker caches it so
second-visit load stays under the 10 s acceptance criterion.
