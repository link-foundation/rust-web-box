# Case Study: Issue #5 — Workbench Loads, but the Linux VM Never Boots

> **Issue**: [link-foundation/rust-web-box#5](https://github.com/link-foundation/rust-web-box/issues/5) — *"We need keep fixing https://link-foundation.github.io/rust-web-box, it must work as promised in PR #2"*
> **Pull request**: [#6](https://github.com/link-foundation/rust-web-box/pull/6)
> **Branch**: `issue-5-b02960440524`
> **Reporter**: @konard
> **Filed**: 2026‑04‑29
> **Severity**: P0 — the in‑browser Linux VM never boots; terminal is stuck on "Booting Linux VM…"

## TL;DR

Issue #3's pull request (#4) fixed the *empty workbench* — extensions, COOP/COEP,
and the disk‑CORS fallback all landed. Pages now serves a populated VS Code Web
shell with files in the Explorer. **But the terminal still does not work.** The
boot indicator paints "Booting Linux VM…", advances through "loading CheerpX
runtime", and then silently freezes. The rendered console reveals one decisive
error:

```
CheerpX initialization failed: CompileError: WebAssembly.instantiate():
expected magic word 00 61 73 6d, found 3c 21 44 4f
```

The bytes `3c 21 44 4f` are ASCII `<!DO` — the first four characters of GitHub
Pages' SPA‑404 HTML page. CheerpX's loader fetched a `.wasm` URL, got HTML
back, and tried to compile it as a WebAssembly module.

After Pages‑level diagnosis the bug is one missing line in `web/build/build-workbench.mjs`:
**`cxcore-no-return-call.wasm` is not in the vendor list.** CheerpX 1.2.x ships
its engine as paired `.js`/`.wasm` siblings (`cxcore.js`+`cxcore.wasm` for
browsers with WebAssembly tail‑call support, `cxcore-no-return-call.js`+`cxcore-no-return-call.wasm`
for everyone else). The build script vendored only the first pair. On Chromium
≥114 and Firefox ≥120, which support tail calls, the page works. On Safari and
older Chromium it 404s and the VM never starts.

Two secondary problems made the console louder than necessary:

1. **`.vscode/{settings,tasks,launch}.json` ENOENT noise.** VS Code probes
   these files immediately on workspace open. Our `workspace-fs.js` seed
   never created them, so the workbench logged three errors per probe cycle
   (≈18 lines on first load). The files have *never* existed inside our
   in‑browser FS.
2. **`rust-analyzer.wasm` 404.** The extension already degrades gracefully
   when the WASM artifact is absent, but it issued a GET first, which
   surfaced as a bright‑red 404 in the console and in screenshots.

The first cause alone explains why the terminal is unusable. The other two are
benign noise that obscures real signal during debugging.

## Folder layout

| File                                        | What it is                                                            |
| ------------------------------------------- | --------------------------------------------------------------------- |
| `README.md`                                 | This document — timeline, requirements, root causes, plan.            |
| `analysis-cheerpx-wasm.md`                  | Deep dive into root cause #1 (the missing `cxcore-no-return-call.wasm`). |
| `analysis-vscode-config-noise.md`           | Deep dive into root cause #2 (`.vscode/*.json` ENOENT).               |
| `analysis-rust-analyzer-wasm.md`            | Deep dive into root cause #3 (`rust-analyzer.wasm` HEAD probe).       |
| `online-research.md`                        | Citations: CheerpX docs, leaningtech/cheerpx releases, browser tail-call support. |
| `evidence/console-first-load.log`           | Browser console log captured against the live site (Playwright).      |
| `evidence/dom-snapshot-15s.yml`             | DOM snapshot at t≈15 s — workbench rendered, terminal stuck.          |
| `evidence/network-requests.txt`             | Full network trace — line 78 is the smoking gun (`cxcore-no-return-call.wasm => 404`). |
| `screenshots/repro-first-load.png`          | Our independent reproduction of the terminal stall.                   |

## Timeline of events

| When                   | What                                                                                                      | Reference                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 2026‑04‑27 → 04‑29     | Issues #1 and #2 land the workbench shell + workspace seed. The dev server (`/`) shows a working terminal in PR #2 screenshots. | `b9ce1ed`, `bd08545`, `a49e7c0` |
| 2026‑04‑29 16:00 UTC   | Pages publishes the bundle. Issue #3 is filed: empty workbench at `/rust-web-box/`.                       | issue #3 body                          |
| 2026‑04‑29 17:18 UTC   | PR #4 merges the issue #3 fix (extension paths, disk CORS, COOP/COEP). Workbench renders.                 | `1e50810`                              |
| 2026‑04‑29 17:30 UTC   | Reporter re‑opens the live site. Workbench paints, but the terminal hangs on "Booting Linux VM…". Issue #5 filed. | issue body                             |
| 2026‑04‑29 18:05 UTC   | Solver reproduces with Playwright; `evidence/console-first-load.log:52` shows the WASM compile error.     | `evidence/console-first-load.log:52`   |
| 2026‑04‑29 18:08 UTC   | `evidence/network-requests.txt:78` confirms `cxcore-no-return-call.wasm => 404`.                           | `evidence/network-requests.txt:78`     |
| 2026‑04‑29 18:09 UTC   | CDN check: both `cxcore.wasm` and `cxcore-no-return-call.wasm` return 200 from `cxrtnc.leaningtech.com/1.2.11/`. | `analysis-cheerpx-wasm.md` |

### Why the regression escaped CI

The issue #3 fix added `pages-parity.test.mjs`, which exercises the deploy
topology and asserts extensions are reachable under the sub‑path. It does not
fetch the CheerpX runtime files — that work happens entirely client‑side at
runtime. The build‑time vendoring step (`vendorCheerpX()`) silently *skipped*
any 404 from the CDN with a `console.log('skipped')`, so a missing entry in
the vendor list manifested as "no `.wasm` in `web/cheerpx/`" rather than a
build failure. The Playwright smoke test runs against `dev-server` and never
inspected the cheerpx folder for paired wasm/js siblings.

The new `cheerpx-vendor-list.test.mjs` makes the assertion explicit at the
unit level: every `cxcore*.js` listed in the vendor array must have a sibling
`*.wasm` in the same array.

The reporter's stale console paste in the issue body still references the
*old* issue #3 symptoms (`extensions/webvm-host/package.json` 404s), because
issue #5 was filed against the same screenshot session. The live site at the
time of investigation no longer has those errors — see
`evidence/console-first-load.log` for the current state.

## Requirements (verbatim from the issue, enumerated)

| #   | Requirement                                                                                                                                        | Where addressed                                |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| R1  | "We need keep fixing https://link-foundation.github.io/rust-web-box, it must work as promised in PR #2."                                            | Root cause #1 fix lands in `build-workbench.mjs`. |
| R2  | "Download all logs and data related about the issue to this repository, make sure we compile that data to `./docs/case-studies/issue-{id}` folder." | This case study folder + `evidence/`.          |
| R3  | "Use it to do deep case study analysis."                                                                                                           | This README + `analysis-*.md`.                 |
| R4  | "Reconstruct timeline/sequence of events."                                                                                                          | Timeline section above.                        |
| R5  | "List of each and all requirements from the issue."                                                                                                | This table.                                    |
| R6  | "Find root causes of each problem."                                                                                                                 | Root causes section + analysis docs.           |
| R7  | "Propose possible solutions and solution plans for each requirement."                                                                              | Per‑root‑cause analysis docs.                  |
| R8  | "Check known existing components/libraries that solve similar problem."                                                                            | `online-research.md`.                          |
| R9  | "Search online for additional facts and data."                                                                                                      | `online-research.md` (CheerpX release notes, browser tail-call timeline). |
| R10 | "If issue related to any other repository/project, where we can report issues on GitHub, please do so."                                            | None warranted — see "Upstream reports below". |
| R11 | "Use playwright MCP on real GitHub Pages url to debug."                                                                                            | `evidence/console-first-load.log`, `evidence/network-requests.txt`. |
| R12 | "Plan and execute everything in a single pull request."                                                                                            | PR #6.                                         |

## Root causes, ranked

### #1 (P0) — `cxcore-no-return-call.wasm` not vendored

`web/build/build-workbench.mjs` line 168 lists
`cxcore-no-return-call.js` but its sibling `cxcore-no-return-call.wasm` is
absent from the `files` array. CheerpX's tail‑call detection runs at startup,
and on browsers without tail‑call support the engine `import()`s the
`-no-return-call` variant relative to its URL, then issues `WebAssembly.instantiate(fetch(.wasm))`.
GitHub Pages serves an SPA‑404 HTML for missing files, which fails to compile
as WASM with the magic‑byte error.

**Fix**: add `'cxcore-no-return-call.wasm'` to the `files` array. Both wasm
variants are confirmed to return 200 from the LeaningTech CDN at version
`1.2.11`. Long-form discussion in [`analysis-cheerpx-wasm.md`](./analysis-cheerpx-wasm.md).

### #2 (P3) — `.vscode/{settings,tasks,launch}.json` ENOENT noise

VS Code Web reads these three files immediately on workspace open
(configuration manager → tasks contributor → debug contributor). Our
`workspace-fs.js` `SEED_FILES` never seeded them, so each probe surfaced as
an `ENOENT` in the console (`F: Unable to read file 'webvm:/workspace/.vscode/settings.json'`).
The workbench retries the probes a few times, producing 12–18 lines of red
text on first load. The errors are non‑fatal — VS Code just falls back to
defaults — but they buried the *real* CheerpX error.

**Fix**: seed empty‑but‑valid stubs for all three. Long-form discussion in
[`analysis-vscode-config-noise.md`](./analysis-vscode-config-noise.md).

### #3 (P3) — `rust-analyzer.wasm` 404

`rust-analyzer-web/extension.js` calls `vscode.workspace.fs.readFile` on the
HTTP-served extension URI, which always issues a GET and surfaces a 404 when
the artifact isn't bundled. The extension already handles missing‑wasm
gracefully (it falls back to a stub LSP server), but the error console line
remained.

**Fix**: HEAD-probe via `fetch` first; only call `readFile` when the artifact
is present. Long-form discussion in
[`analysis-rust-analyzer-wasm.md`](./analysis-rust-analyzer-wasm.md).

## Solution plan

The fix is small and contained:

1. `web/build/build-workbench.mjs` — add `cxcore-no-return-call.wasm` to the
   CheerpX vendor list with a comment documenting why.
2. `web/glue/workspace-fs.js` — seed `.vscode/{settings,tasks,launch}.json`
   with empty‑but‑valid stubs.
3. `web/extensions/rust-analyzer-web/extension.js` — HEAD-probe before the
   readFile call.
4. `web/tests/cheerpx-vendor-list.test.mjs` (new) — assert every `cxcore*.js`
   in the vendor list has a sibling `*.wasm`.
5. `web/tests/workspace-fs.test.mjs` — assert the new seed entries are
   present and parse as JSON.
6. `changelog.d/<datestamp>_issue_5_cheerpx_vm_boot.md` — patch‑bump fragment.

No production behaviour changes for browsers that *did* work before
(Chromium with tail-call support); they continue using `cxcore.wasm`. Safari,
older Chromium, and Firefox without tail-call support — which were silently
broken — now boot the VM.

## Online research

See [`online-research.md`](./online-research.md). Highlights:

- CheerpX 1.2.x release notes mention the `-no-return-call` variant and the
  runtime fallback. The CDN ships both variants for every published version.
- Chrome 112 (April 2023) shipped WebAssembly tail calls; Firefox 121
  (December 2023); Safari did not as of writing — confirming the diagnosis
  that *some* browsers worked and others didn't.
- VS Code Web's `IFileService` always probes `.vscode/settings.json` on
  workspace open even when no extension consumes the result; this is hard
  to disable from extension code, so seeding the file is the simplest path.

## Upstream reports

None warranted at this time.

- **CheerpX**: the 404 is our build's fault, not the engine's. The CDN ships
  both variants; the engine correctly tries to load the right one. No issue
  to file.
- **VS Code Web**: the workspace‑folder probe behaviour is documented and
  by-design.
- **GitHub Pages**: serving a 404 page with `<!DOCTYPE html>` is also
  by-design; we cannot rely on Pages returning a `Content-Type` that would
  reject early in `WebAssembly.instantiate`. The lesson is: never let a
  paired asset 404 reach the engine.
