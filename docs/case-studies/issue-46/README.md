# Issue #46: publish only rust-web-box

Issue: https://github.com/link-foundation/rust-web-box/issues/46
PR: https://github.com/link-foundation/rust-web-box/pull/47

## Cause and reproduction

The root manifest, imports, CLI name, and README still described the upstream
sum-package template. Both bundled extension manifests omitted `private`, and
the existing release workflow supplied long-lived registry secrets. Its
publish helper skipped the template name, so a green template CI run did not
mean that the product crate was published.

Run `node --test web/tests/package-policy.test.mjs` against the original
manifests and workflow: both tests fail (wrong crate name and secret-based
authentication). They pass after the changes. The Rust integration test
`test_cli_product_identity` exercises the actual executable's help and version,
while the existing CLI arithmetic tests preserve previous behavior.

## Requirement inventory

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Publishable root crate, binary, and metadata named rust-web-box | Cargo manifest and lockfile, CLI command, imports, README, examples | Package-policy test; real CLI help/version integration test; CI publish dry run |
| Keep rust-analyzer-web and webvm-host internal | Both manifests set `private: true`; extension identifiers remain stable | Package-policy test; existing extension/web tests in Pages CI |
| Leave end-to-end tests private | Existing `web/tests/package.json` remains private | Package-policy test |
| OIDC release workflow | Both release jobs use `crates-io-auth-action`, scoped `id-token: write`, temporary publish-step token, main-only publishing | Package-policy test; workflow review; actual registry publication remains blocked |
| CLI and documentation use product name | README, contributing guide, package metadata, CLI help/version and imports | Real CLI integration test and documentation review |
| Unwanted npm names not owned by link-foundation | No npm publication path; private integration packages | All three `npm view` checks return E404; see registry log |
| No long-lived token for later releases | Workflow no longer reads either Cargo token secret | Policy test rejects registry secret references; registry setup documented |
| cargo search finds crate published by workflow | **Blocked and unfinished** | crates.io API returned 404 and cargo search did not find the product crate on 2026-11-15 |

A minor changelog fragment is the existing pipeline's release/version trigger;
manual version edits are prohibited by repository CI. The lockfile's stale
root version is synchronized to the existing manifest version, with dependency
versions preserved. The crate archive explicitly includes the Rust sources,
tests, example, and required test helper, excluding browser bundles and case
study assets.

## External blocker

The [registry's current documentation](https://crates.io/docs/trusted-publishing)
requires an initial API-token publication before a crate can configure a
trusted publisher. `rust-web-box` does not exist yet. Repository secrets are
empty, no Cargo token is present in the process, and no Cargo credentials file
exists. This session has no authenticated crates.io configuration interface.
GitHub repository access does not provide registry ownership. There are no
required sub-issues or issue/PR comments at the initial audit.

[Setup instructions](../../ci-cd/trusted-publishing.md) specify the exact
bootstrap and publisher fields. Authentication now precedes release mutations;
missing setup fails the main release with an explicit diagnostic. PR dry runs
exercise packaging without credentials. Successful PR CI cannot establish the
actual publication criterion. Keep the PR unmerged and that criterion open
until an authorized registry owner completes setup and a release from main is
verified. No unrelated registry package is removed.

## CI runner compatibility

Current-commit Pages run [43775616495](https://github.com/link-foundation/rust-web-box/actions/runs/43775616495)
failed before the browser test started. Downloaded log
`ci-logs/pages-43775616495.log`, line 12122, reports
`Playwright does not support chromium on ubuntu26.04-x64`. The runner's
`ubuntu-latest` image had moved beyond the OS supported by locked Playwright
1.59.1. The corresponding dependency-install warning appears at lines
12117–12118. The full log is preserved locally; a focused excerpt is committed.

Pin the Pages local and post-deploy browser jobs to Ubuntu 24.04, which is
supported by [Playwright 1.59.1's registry](https://github.com/microsoft/playwright/blob/v1.59.1/packages/playwright-core/src/server/registry/index.ts).
The existing browser integration check reproduces the failure and verifies
the correction in CI; no browser assertions or timeouts are relaxed.

## Lockfile normalization

[Package build 43777011540](https://github.com/link-foundation/rust-web-box/actions/runs/43777011540)
passed release compilation and both package-policy tests, then failed its
publish dry-run because the checkout contained a modified `Cargo.lock`
(downloaded log lines 4718–4722). The package rename had left the root entry
at the old template name's alphabetical position. An unlocked Cargo invocation
reordered it, without changing dependency versions; local locked tests had
not written that normalization.

`cargo metadata --offline --format-version 1 --filter-platform x86_64-unknown-linux-gnu`
reproduced the reorder without compiling. Commit Cargo's canonical ordering
and use `cargo build --release --locked --verbose` in CI. The existing
`cargo publish --dry-run --locked -p rust-web-box` check verifies that the
build leaves a clean, publishable checkout.
