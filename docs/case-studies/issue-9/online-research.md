# Issue 9 Online Research

Date: 2026-04-30

## Sources

- GitHub Docs, "About large files on GitHub": <https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github>
  - Relevant finding: regular Git repository files above 100 MiB are blocked; GitHub recommends Releases for distributing large binaries.
- GitHub Docs, "GitHub Pages limits": <https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>
  - Relevant finding: published Pages sites have a 1 GB size limit, so staging the disk must keep the deployed artifact bounded.
- MDN, `Cross-Origin-Embedder-Policy`: <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy>
  - Relevant finding: `COOP: same-origin` plus `COEP: require-corp` or `credentialless` enables cross-origin isolation, but CORS-mode fetches still require the target server to allow CORS.
- CheerpX Docs, `HttpBytesDevice.create`: <https://cheerpx.io/docs/reference/CheerpX.httpBytesDevice/create>
  - Relevant finding: CheerpX can mount a remote ext2 image through `HttpBytesDevice`.
- CheerpX Docs, files and filesystems: <https://cheerpx.io/docs/guides/File-System-support>
  - Relevant finding: CheerpX filesystem backends include ext2 block devices, IndexedDB overlays, WebDevice, and DataDevice.
- CheerpX quickstart: <https://cheerpx.io/docs/getting-started>
  - Relevant finding: the hosted WebVM disk uses `CloudDevice` with a `wss://disks.webvm.io/...ext2` URL.
- LeaningTech WebVM source, `WebVM.svelte`: <https://github.com/leaningtech/webvm/blob/0cee788fda3a69517ca02a30fde49398e5212eca/src/lib/WebVM.svelte>
  - Relevant finding: upstream WebVM selects `CloudDevice`, `HttpBytesDevice`, or `GitHubDevice` based on `diskImageType`.
- LeaningTech WebVM deployment workflow, saved locally at `docs/case-studies/issue-9/evidence/webvm-deploy.yml`.
  - Relevant finding: upstream WebVM splits ext2 images into 128 KiB `.cNNNNNN.txt` chunks and writes a `.meta` file with the image size for GitHubDevice mode.

## Conclusion

The release asset is the right storage location for the full `.ext2`
binary, but it is the wrong browser fetch URL. The stable browser path
is to download the release asset in CI, split it into Pages-hosted
chunks, and mount it with `CheerpX.GitHubDevice.create("./disk/rust-alpine.ext2")`.

Once the disk lives on the Pages origin, the page can use
`Cross-Origin-Embedder-Policy: require-corp` instead of depending on
`credentialless` to tolerate cross-origin subresources. This keeps
`crossOriginIsolated` available for CheerpX while avoiding the CORS
failure reported in issue 9.
