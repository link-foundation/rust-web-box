# Case study — Issue #23: "Looks like our CI/CD is broken"

> Source issue: <https://github.com/link-foundation/rust-web-box/issues/23>
> Pull request: <https://github.com/link-foundation/rust-web-box/pull/24>
> Branch: `issue-23-b8eb00ab0dba`

This case study reconstructs the timeline of the failures observed on the
push to `main` at commit `2659881` (the merge of PR #22 into `main`),
identifies each independent root cause, and documents the fixes applied
in this PR. Raw logs are preserved in [`logs/`](./logs).

---

## 1. Reported symptom

> "<https://github.com/link-foundation/rust-web-box/actions/runs/25261258721>
> — not fully executed for some reason, like deploy and e2e tests."

That run is the **Deploy GitHub Pages** run triggered by the merge of
PR #22 to `main`. Its `Local e2e (built artifact)`, `Deploy to GitHub
Pages` and `Post-deploy e2e (live Pages site)` jobs were all reported as
failing.

The user also asked to double-check **all other false positives, false
negatives, and potential issues and bugs** across the CI/CD surface, and
to fix the same class of problems in the upstream pipeline templates
where applicable.

## 2. Timeline of the failing run (commit `2659881`)

All times UTC, captured directly from the GitHub Actions API.

| Time     | Event                                                                  | Run ID         | Outcome                            |
| -------- | ---------------------------------------------------------------------- | -------------- | ---------------------------------- |
| 20:34:25 | `push` to `main` triggers **CI/CD Pipeline** (`release.yml`)           | 25261258719    | **failure** (Auto Release step)    |
| 20:34:26 | `push` to `main` triggers **Deploy GitHub Pages** (`pages.yml`)        | **25261258721**| **cancelled** mid-`local-e2e`      |
| 20:34:26 | `push` to `main` triggers **Build disk image** (`disk-image.yml`)      | 25261258726    | success                            |
| 20:37:07 | `disk-image.yml` `gh workflow run pages.yml --ref main` step fires     | 25261313682    | success (deploy + live e2e ran)    |
| 20:37:14 | The original `pages.yml` run (25261258721) is cancelled                | 25261258721    | "Canceling since a higher priority waiting request for `pages-refs/heads/main` exists" |

Two **independent** failure modes are visible:

1. The **CI/CD Pipeline** run (`release.yml`, run 25261258719) failed in
   the `Auto Release / Check if version already released or no
   fragments` step. The remaining release steps were skipped.
2. The **Deploy GitHub Pages** run (`pages.yml`, run 25261258721) was
   **cancelled by GitHub Actions concurrency** before its `deploy` and
   `e2e` jobs could start. The cancel was triggered by the
   `disk-image.yml` workflow (which had just succeeded) when its
   "Redeploy Pages with fresh disk chunks" step queued a *second*
   `pages.yml` run on the same `refs/heads/main`, with `cancel-in-progress: true`.

The fact that the second Pages run (25261313682) ran to completion and
deployed the site is what hid the severity of (2): the live site was
fine, but the push-triggered run looks red on the run history.

## 3. Root causes

### 3.1. `RUSTFLAGS=-Dwarnings` + `rust-script`'s `#[path]` import → dead-code errors

`scripts/check-release-needed.rs` pulls path helpers in via:

```rust
#[path = "rust-paths.rs"]
mod rust_paths;
```

`rust-paths.rs` exposes a generic toolbox of helpers (`get_cargo_lock_path`,
`get_changelog_dir`, `needs_cd`, `parse_rust_root_from_args`, …). The
caller only consumes a handful of them, so the rest are dead code from
the compiler's point of view.

The CI/CD workflow sets workflow-wide:

```yaml
env:
  RUSTFLAGS: -Dwarnings
```

`rust-script` invokes `cargo` to compile each script as its own crate,
inherits this env var, and `-Dwarnings` promotes the dead-code warning
to a hard error:

```
error: function `get_cargo_lock_path` is never used
…
error: function `main` is never used
error: could not compile `check-release-needed_…` due to 7 previous errors
```

Additionally `check-release-needed.rs` has its own dead `get_arg`
helper that is never called (left over after a refactor).

The upstream **`rust-ai-driven-development-pipeline-template`** already
has these two fixes applied at the head of `rust-paths.rs`:

```rust
#![allow(dead_code)]
```

…and the unused `get_arg` is not present in
`scripts/check-release-needed.rs`. The pipeline template was therefore
healthy; this repository had drifted.

#### Why this matters for *all* `rust-script` callers

The same shape (`#[path] mod rust_paths;`) is used by many other
scripts in `scripts/`. Any of them that doesn't happen to call every
function in `rust-paths.rs` is a latent landmine that would surface the
moment its caller path is exercised.

Sweeping all `scripts/*.rs` with `RUSTFLAGS=-Dwarnings` (the same env CI
uses) before this PR exposed one further latent bug not caught by §3.1
alone:

```text
error[E0433]: failed to resolve: use of unresolved module or unlinked crate `env`
  --> scripts/get-version.rs:28:24
   |
28 |     if let Ok(output_file) = env::var("GITHUB_OUTPUT") {
```

`scripts/get-version.rs` calls `env::var(...)` in `set_output()` but
forgets `use std::env;`. This script is invoked from
`release.yml` → `Auto Release / Get current version`, gated behind
`steps.check.outputs.should_release == 'true'`. With the §3.1 fix
applied, the next time a release fires for an already-published
version, this would trip. Fixed in this PR (one-line `use std::env;`
added).

### 3.2. `pages.yml` concurrency racing with the disk-image redeploy

`pages.yml` declares:

```yaml
concurrency:
  group: pages-${{ github.ref }}
  cancel-in-progress: true
```

`disk-image.yml`, after publishing a fresh disk image to the rolling
`disk-latest` release, runs:

```bash
gh workflow run pages.yml --ref main
```

…which queues a *second* `pages.yml` run on `main`. With
`cancel-in-progress: true`, the *new* request cancels the *currently
running* one. Result: the original push-triggered Pages run dies
mid-`local-e2e`, and the dispatched run gets to deploy.

This contradicts GitHub's own [`actions/starter-workflows`
recommendation for Pages
deployments](https://github.com/actions/starter-workflows/blob/main/pages/static.yml):

```yaml
concurrency:
  group: "pages"
  # Allow only one concurrent deployment, skipping runs queued between
  # the run in-progress and latest queued. However, do NOT cancel
  # in-progress runs as we want to allow these production deployments
  # to complete.
  cancel-in-progress: false
```

A third effect of the existing `pages-${{ github.ref }}` group is that
two unrelated `pages.yml` runs on different refs (e.g. one on `main`,
one on a PR) wouldn't serialize against each other, even though they
both end up calling the same `actions/deploy-pages` deployment slot.
The flat `pages` group is closer to what `deploy-pages` actually needs.

### 3.3. `deploy-docs` is wired to a different deployment mechanism than `pages.yml`

`pages.yml` deploys via `actions/deploy-pages@v5` (artifact-based;
the repo's Pages source is `build_type: workflow` per
`gh api repos/.../pages`). `release.yml`'s `deploy-docs` job uses
`peaceiris/actions-gh-pages@v4`, which pushes to a `gh-pages` branch.
With the repo configured for workflow-artifact deployment, anything
pushed to `gh-pages` is **never served**. The two mechanisms are
mutually exclusive (changing the Pages source is a manual repo-settings
flip).

This pre-dates the issue but matters for how the `deploy-docs` `needs`
and `if` are wired: as long as the docs job is a no-op for the live
site, it should not be on the critical path of a release. The template
already takes this view — its `deploy-docs` is gated on `[build]`, not
on `[auto-release, manual-release]`, so the docs-branch artifact
refreshes whenever the build succeeds, independent of whether
crates.io publication runs. We adopt the same wiring here.

### 3.4. Other latent issues found while looking

These do not directly cause #23, but the issue body asked to "double
check all other false positives, false negatives, and potential issues
and bugs". They are documented here for completeness; some are fixed in
this PR, the rest are tracked as follow-ups.

* **`release.yml` `concurrency.cancel-in-progress: true`**. On `main`
  this is appropriate (a fresh push obsoletes the in-progress build);
  on PRs it is also fine. The pipeline template has converged on
  `cancel-in-progress: ${{ github.ref == 'refs/heads/main' }}` so that
  long-running release jobs on `main` are not killed by an unrelated
  re-trigger. Fixed in this PR to match the template.
* **`actions/checkout`, `actions/setup-node`, `actions/upload-artifact`
  on `pages.yml` and `disk-image.yml`** are pinned at `@v4`, which
  GitHub annotated as "Node.js 20 deprecated, will be forced to Node 24
  by June 2nd, 2026". `actions/checkout@v5` (and friends) ship Node 24
  compatibility. Bumped in this PR.
* **Codecov upload step** logs `Token required - not valid tokenless
  upload` for `push` events on `main`. Codecov tokenless upload only
  works for PRs from forks; pushes need a token. The step has
  `fail_ci_if_error: false`, so this is a false negative in practice
  (CI looks green even though coverage upload is blocked). Tracked as
  follow-up: a `CODECOV_TOKEN` repo secret should be added; we do not
  ship a workaround here because the failure is *informational*.

## 4. Requirements (from the issue body) and how we addressed them

| #  | Requirement                                                                    | Status                                                                |
| -- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 1  | Investigate `actions/runs/25261258721` and explain why deploy/e2e didn't run   | Done; root cause = concurrency race with disk-image redeploy (§3.2).  |
| 2  | Double-check other false positives, false negatives, and potential bugs        | Done; listed in §3.3 and §3.4.                                        |
| 3  | Use best practices from `js-…-template` and `rust-…-template`; report upstream | Done; this repo had drifted from `rust-…-template`. Fixes mirrored in this PR; no upstream issue needed because the rust template already had `#![allow(dead_code)]` on `rust-paths.rs`. The relevant template improvements are reused here. |
| 4  | Compile data into `docs/case-studies/issue-{id}` for deep analysis             | This file + `logs/`.                                                  |
| 5  | Search online for additional facts and data                                    | Linked GitHub Pages starter workflow recommendation in §3.2.          |
| 6  | Reconstruct timeline / requirements / root causes / solutions                  | §2, §4, §3, §5 respectively.                                          |
| 7  | If not enough data → add debug/verbose mode for next iteration                 | Done — `pages.yml` and `release.yml` `Auto Release` steps now print   |
|    |                                                                                | the `RUSTFLAGS`, `rust-script`/cargo versions and concurrency context |
|    |                                                                                | as the first thing they do, so the next failing run is self-explaining. |
| 8  | If issue is in another repo, file an issue with reproducible example           | The fix lives entirely in this repo (the template was already fixed). |
| 9  | Plan and execute everything in one PR                                          | This PR (#24).                                                        |

## 5. Solution plan & implementation

The fix lives in PR #24 and is split into the smallest commits that
each stand on their own.

### 5.1. `scripts/rust-paths.rs` — silence dead-code

Add `#![allow(dead_code)]` at the crate root. This is the same fix the
upstream pipeline template carries, and is the exact change that
`#[path]` imports require: a script that only consumes a subset of the
toolbox should not have to opt out warning-by-warning.

### 5.2. `scripts/check-release-needed.rs` — drop the unused `get_arg`

Remove the dead `get_arg` helper. It was a copy/paste artefact from a
previous iteration; the live code path uses `rust_paths::get_rust_root`
directly.

### 5.2b. `scripts/get-version.rs` — add the missing `use std::env;`

Without this import the script fails to compile (E0433) the moment it
is exercised under `RUSTFLAGS=-Dwarnings`, blocking the
`Auto Release / Get current version` step. One-line fix.

### 5.3. `.github/workflows/pages.yml` — match the official Pages
recommendation

Switch the concurrency block to:

```yaml
concurrency:
  group: pages
  cancel-in-progress: false
```

This matches the [GitHub starter
workflow](https://github.com/actions/starter-workflows/blob/main/pages/static.yml)
verbatim, which is the de-facto reference for `actions/deploy-pages`
users. The disk-image redeploy now **queues** behind any in-progress
push-triggered Pages run instead of cancelling it.

### 5.4. `.github/workflows/release.yml` — adopt template improvements

* `concurrency.cancel-in-progress` → `${{ github.ref == 'refs/heads/main' }}`
  (template parity; long-running `main` jobs aren't killed by unrelated retriggers).
* `deploy-docs.needs` → `[build]` (template parity; docs ship even when
  Crates.io publication is blocked, decoupled from release path).

### 5.5. `actions/*` version bumps

Bump `actions/checkout@v4` → `@v5`, `actions/setup-node@v4` → `@v6`,
`actions/upload-artifact@v4` → `@v5`, `actions/download-artifact@v4` → `@v6`,
`actions/upload-pages-artifact@v3` → `@v4` and
`actions/deploy-pages@v4` → `@v5` across `pages.yml` and `disk-image.yml`,
silencing the Node-20 deprecation warning ahead of the June 2026 forced
upgrade.

### 5.6. Verbose / debug visibility (issue requirement #7)

Both `pages.yml`'s build job and `release.yml`'s `Auto Release` job now
emit a small "Pipeline context" block on entry: `RUSTFLAGS`,
`rust-script` and `cargo` versions, the resolved `rust_paths::get_rust_root`,
and the active concurrency group. If a future run fails the same way, the
log will name the cause directly instead of requiring forensic reconstruction.

## 6. Reproducible examples

* The `Auto Release` failure can be reproduced locally by running, from
  the repo root, with the same env CI uses:

  ```bash
  RUSTFLAGS=-Dwarnings rust-script scripts/check-release-needed.rs
  ```

  Pre-fix this exits non-zero with `error: function ‘get_cargo_lock_path‘ is
  never used` (and friends). Post-fix it succeeds.

* The Pages cancellation race is harder to reproduce ad-hoc but the
  log excerpt (`Canceling since a higher priority waiting request for
  pages-refs/heads/main exists`) at `logs/pages-25261258721.log:10427`
  is direct evidence.

## 7. Logs

| File                                          | Run                            | Why we kept it                  |
| --------------------------------------------- | ------------------------------ | ------------------------------- |
| `logs/pages-25261258721.log`                  | the cancelled push-triggered Pages run | primary subject of the issue |
| `logs/cicd-25261258719.log`                   | the failed CI/CD Pipeline run on the same commit | reveals root cause §3.1 |
| `logs/pages-success-25261313682.log`          | the workflow_dispatch Pages run that succeeded | shows what the cancelled run *should* have done |
| `logs/cicd-25247728281.log`                   | the *prior* CI/CD failure (commit `7a0961b`) | confirms §3.1 is not a one-off |

