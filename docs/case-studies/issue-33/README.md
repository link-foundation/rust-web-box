# Case Study: Issue #33 — "Double check the solution is not fake"

Issue: https://github.com/link-foundation/rust-web-box/issues/33

PR: https://github.com/link-foundation/rust-web-box/pull/34

## Summary

The reporter ran `cargo run` several times on the live site and saw two
branded lines — `This binary was compiled inside CheerpX.` and
`Compiled by Rust inside the browser via CheerpX.` — that "look like
something we added in our code." They asked us to confirm the build is
not faked, remove the per-command branding, and make the box behave 1-to-1
with a real terminal running a real Linux distribution.

**Finding: the build is genuinely real.** `cargo run` is a real `rustc`
invocation inside the CheerpX x86 Linux VM. The evidence is in the
reporter's own transcript: every post-edit run prints `Compiling hello
v0.1.0 (/workspace)`, the wall-clock times vary realistically (32.81s →
8m 19s → 2.07s → 2.02s), and the reporter's edits (`! 2`, `! 3`, `! 5`)
appear in stdout — none of which a mocked terminal could produce.

**The real defect** is that the greeting was branded *and inconsistent*.
The prebuilt binary baked by `web/disk/Dockerfile.disk` printed
`This binary was compiled inside CheerpX.`, while the editable workspace
seed in `web/glue/workspace-fs.js` printed `Compiled by Rust inside the
browser via CheerpX.`. So the **first** run (prebuilt) and **subsequent**
runs (recompiled from the seed) printed *different* second lines. That
divergence is what made the output look injected.

**The fix** deletes the branding and makes both the prebuilt binary's
source and the editable seed byte-for-byte identical to the canonical
`cargo new` program:

```rust
fn main() {
    println!("Hello, world!");
}
```

Now the first run equals every later run, and the box behaves exactly like
a freshly created Cargo project — "1 to 1 to real deal." Existing browser
workspaces that still hold the old branded seed are migrated to the plain
program on next open (untouched copies only; user edits are preserved).

## Evidence

| File | Purpose |
| --- | --- |
| `screenshots/issue-terminal.png` | Reporter's screenshot: VS Code with the branded `src/main.rs` open and the terminal showing four `cargo run` invocations with two different branding lines. |
| `evidence/issue-terminal-transcript.txt` | The transcript from the issue body, annotated to show which line comes from the prebuilt binary vs. the JS seed, and why the varying compile times prove the build is real. |
| `evidence/issue-33.json` | Issue metadata + full body. |
| `evidence/issue-33-comments.json` | Issue comments (empty at time of writing). |
| `evidence/pr-34.json` | PR #34 metadata and commits. |
| `evidence/disk-latest-release.json` | The published `disk-latest` warm-disk release (asset last updated 2026-05-10), i.e. the branded disk the live site was serving when the issue was filed. |
| `online-research.md` | Cargo + CheerpX references: what `cargo new` generates, that CheerpX runs unmodified x86 binaries for real, and why first vs. later runs diverge. |
| `verification/web-all-tests.log` | Full `node --test web/tests/` run (197 pass, 4 e2e skipped without a browser). |
| `verification/web-workspace-fs-tests.log` | Seed + migration unit tests. |
| `verification/web-boot-shell-tests.log` | Workflow/Dockerfile structural assertions. |
| `verification/cargo-fmt.log`, `cargo-clippy.log`, `cargo-test.log`, `check-file-size.log` | Rust gate checks (all green; no Rust source changed). |

## Timeline / sequence of events

1. **Disk baked & published** — `web/disk/Dockerfile.disk` wrote a `src/main.rs`
   with two branded `println!` lines and pre-built debug + release artifacts.
   The resulting ext2 was published as the `disk-latest` release (asset last
   updated 2026-05-10).
2. **Page seed diverged** — `web/glue/workspace-fs.js` seeded the editable
   workspace with a *different* branded `src/main.rs` (comment header +
   `Hello from rust-web-box!` + `Compiled by Rust inside the browser via
   CheerpX.`). The first `println!` matched the disk binary; the second did not.
3. **Reporter runs `cargo run`** (2026-05-27):
   - Run 1 reused the prebuilt binary → `…Finished in 32.81s` → `This binary
     was compiled inside CheerpX.`
   - Reporter edits `main.rs` (`! 2`) → Run 2 is a real cold rebuild → `8m 19s`
     → `Compiled by Rust inside the browser via CheerpX.`
   - Runs 3–4 (`! 3`, `! 5`) are warm incremental rebuilds (~2s).
4. **Report filed** — issue #33: the branding "looks like something we added,"
   asks us to prove the build is real, drop the branding, and behave like a
   real terminal.
5. **This PR** — confirms the build is real (no faking anywhere in the glue),
   unifies both sources to the plain `cargo new` program, migrates existing
   workspaces, makes the e2e assertions version-independent, and records this
   case study.

## Requirements (extracted from the issue)

1. **Confirm the build is not faked** — verify real `cargo run` actually executes
   in the browser VM.
2. **Remove the per-command branding output** — "we don't need such output to each
   command, but just use real bash command."
3. **Delete any fake solutions; keep only the simplest real solution** that behaves
   "1 to 1 to real deal" like a real terminal with a real Linux distribution.
4. **Fix it in all places** the problem appears (entire codebase).
5. **Compile issue data into `docs/case-studies/issue-33/`** and do a deep case
   study (timeline, requirements, root causes, solution options, online research).
6. **Add debug output / verbose mode** if there is not enough data to find the root
   cause.
7. **Report upstream issues** in related repos if the problem belongs there.
8. **Do everything in PR #34.**

## Root cause

There are two findings, only one of which is a defect:

- **Not a bug (verified):** the build is real. `runShellLoop` in
  `web/glue/webvm-server.js` spawns `/bin/bash --login` via `cx.run`,
  `cx.setCustomConsole` wires real stdin/stdout, and `proc.stdout` bytes are
  streamed verbatim to xterm. `web/glue/console-filter.js` only suppresses
  *browser-console* noise; it never touches terminal output. Verbose tracing
  already exists (`web/glue/debug.js`, opt-in via `?debug=1`). CheerpX runs the
  unmodified Alpine `rustc`/`cargo` toolchain, so `cargo run` is a genuine
  compile-and-execute. (See `online-research.md`.)

- **The defect:** the greeting was branded and *inconsistent across sources*.
  `web/disk/Dockerfile.disk` baked `println!("This binary was compiled inside
  CheerpX.")` into the prebuilt binary, while `web/glue/workspace-fs.js` seeded
  `println!("Compiled by Rust inside the browser via CheerpX.")` into the editable
  workspace. Because the first `cargo run` reuses the prebuilt binary and later
  runs recompile from the seed, the first run and later runs printed different
  second lines. Branding that (a) reads like injected marketing and (b)
  contradicts itself between runs is exactly what made a real build "look fake."

## Solution options considered

1. **Keep one branding line, make both sources match.** Rejected: still adds
   non-standard output to every program; the issue explicitly says "we don't need
   such output to each command."
2. **Strip branding only from the seed.** Rejected: leaves the prebuilt binary
   (first run) still branded → first run ≠ later runs, the exact inconsistency
   reported.
3. **Adopt the canonical `cargo new` program in both the disk and the seed
   (chosen).** Simplest, removes all branding, and guarantees first run == later
   runs because the two sources are byte-for-byte identical.

## Fix

- **`web/glue/workspace-fs.js`** — `SEED_FILES['/workspace/src/main.rs']` is now the
  plain `cargo new` program (no comment header, single `Hello, world!`). The old
  branded text is pinned in `PREVIOUS_SEED_FILES`, and `migrateDefaultSettings()`
  calls `replaceIfUnchanged()` so existing workspaces that still hold the untouched
  branded seed are migrated to the plain program. User-edited files are left alone.
- **`web/disk/Dockerfile.disk`** — the prebuilt binary's `src/main.rs` now uses the
  same `printf 'fn main() {\n    println!("Hello, world!");\n}\n'`, byte-for-byte
  identical to the seed, so the first (prebuilt) run matches every later run. The
  dual debug + release pre-bake (issue #17 mitigation) is preserved.
- **`.github/workflows/disk-image.yml`** — the mounted-image smoke test now asserts
  `Hello, world!` and no longer asserts the removed CheerpX branding line.
- **`web/tests/workspace-fs.test.mjs`** — asserts the seed is the canonical program
  and carries no `rust-web-box`/`CheerpX`/`Compiled by Rust` branding.
- **`web/tests/workspace-fs-migration.test.mjs`** (new) — a tiny in-memory
  IndexedDB shim drives `openWorkspaceFS()` to prove: an untouched branded seed is
  migrated to the plain program, a user-edited `main.rs` is left untouched, and a
  fresh store is seeded with the plain program.
- **`web/tests/boot-shell.test.mjs`** — the disk-image workflow assertion now matches
  `Hello, world!` and asserts the branding strings are *absent*.
- **`web/tests/helpers/cheerpx-page-harness.mjs`** — adds `firstSourceGreeting(page)`,
  which reads `/workspace/src/main.rs` and extracts the first `println!` literal.
- **`web/tests/e2e/local-pages-e2e.test.mjs` and `live-pages-e2e.test.mjs`** — Stage
  C/D no longer hardcode the branded greeting (which would break against the still
  branded published disk during the version-skew window). They assert the binary and
  `cargo run` print *a* hello line, and — only on a disk whose prebuilt binary is
  already the plain program — assert that the printed greeting is exactly the literal
  in the source on disk (`Hello, world!`) with no branding. The discriminator is the
  **prebuilt binary's own output** (`/workspace/target/release/hello`), which is baked
  into the disk and is unaffected by the boot-time workspace prime or CheerpX's guest
  clock — so it reliably distinguishes the issue #33 plain-seed disk from the older
  published disk, which still carries the lean dev profile from issue #31 and would
  otherwise be misdetected. This is a stronger anti-fake proof: the output must match
  the real source, not a constant.

No upstream issue was filed: the CheerpX/webvm runtime behaves correctly here; the
defect was entirely in this repository's seed/disk content.

## Verification

- `node --test web/tests/` → 197 pass, 4 e2e skipped (no browser locally).
- `node --test web/tests/workspace-fs.test.mjs web/tests/workspace-fs-migration.test.mjs`
- `node --test web/tests/boot-shell.test.mjs`
- `cargo fmt --check`
- `cargo clippy --all-targets --all-features`
- `cargo test`
- `rust-script scripts/check-file-size.rs`

The full end-to-end proof against a freshly built disk runs in
`.github/workflows/disk-image.yml` (mounted-image smoke test + browser e2e), because
the regular PR Pages workflow still stages the currently published `disk-latest`
image.
