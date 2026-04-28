# cheerpx/

CheerpX runtime vendor directory. CI populates this with
`cx.esm.js` (the CheerpX entry point) and any auxiliary assets pulled
from `https://cxrtnc.leaningtech.com/<version>/`.

Pinned version: `1.2.8` (see `web/build/build-workbench.mjs`).

The `.version` file in this directory is the build-step stamp; updating
it triggers a re-vendor on the next CI run.

If the vendored copy is missing at runtime, `glue/cheerpx-bridge.js`
falls back to loading directly from the LT CDN. Vendoring is preferred
because (a) it keeps the artifact reproducible and (b) the service
worker can cache it for offline use.
