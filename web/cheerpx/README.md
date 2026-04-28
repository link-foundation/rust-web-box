# cheerpx/

Vendored CheerpX engine. **Not vendored yet** — see issue #1 (open question 2)
for the vendored-vs-CDN decision.

When vendored, this directory contains the CheerpX WASM blobs and JS shim
that the boot script loads on demand. Vendoring keeps the shell reproducible
and makes the second-visit offline path possible; it costs us upstream
update velocity and increases the published Pages artifact.
