# Publishing rust-web-box

Only the root Cargo package `rust-web-box` is released. Its library import is
`rust_web_box` and its executable is `rust-web-box`. The two extension manifests
and the end-to-end test manifest are private; their internal names are stable.
No npm or VS Code Marketplace publication is part of the release workflow.

## Registry setup

The [crates.io documentation](https://crates.io/docs/trusted-publishing) currently
requires the crate to exist before configuring a trusted publisher. The initial
publication requires an API token. This is a one-time bootstrap constraint of
the registry, not a credential required for subsequent automated releases.

A crates.io account with ownership of the product crate must:

1. If the crate does not yet exist, publish the reviewed product crate once
   using a narrowly scoped, short-lived API token, then revoke that token.
   Do not add it as a repository or organization secret.
2. In the crate's settings, add a GitHub trusted publisher with:
   - Repository owner: `link-foundation`
   - Repository name: `rust-web-box`
   - Workflow filename: `release.yml`
   - Environment: leave empty (these release jobs do not declare an environment).
3. Run the release workflow on `main`. A changelog fragment triggers automatic
   versioning on merge; workflow dispatch with release mode `instant` supports
   a manual release. Both publishing jobs are restricted to `main`.
4. Confirm the workflow's Publish to Crates.io step succeeded, then verify:

   ```bash
   cargo search rust-web-box --limit 1
   cargo info rust-web-box
   npm view example-sum-package-name
   npm view rust-analyzer-web
   npm view webvm-host
   ```

   The npm names must not resolve to packages owned by link-foundation; an npm
   E404 meets that condition. No deletion of unrelated publishers' packages
   is needed. Verify the crate's repository and owners on crates.io as well.

No `CARGO_TOKEN` or `CARGO_REGISTRY_TOKEN` GitHub secret is read by the workflow.
The OIDC action exchanges the job's GitHub identity for a temporary crates.io
publish token, supplies it only to the publish step, and revokes it in its post
step. Only the two publishing jobs receive `id-token: write`. Pull requests run
package-policy checks and `cargo publish --dry-run` without registry credentials.
A failed authentication step prevents release version/tag changes and reports
this setup procedure. Missing credentials never count as a successful release.

## Initial verification for issue #46

On 2026-11-15 the npm registry returned HTTP 404 for all three unwanted names.
The crates.io API returned HTTP 404 for `rust-web-box`. Consequently the
acceptance criterion requiring a crate published by the workflow is still
unfinished until registry bootstrap, trusted publisher setup, and a successful
release from `main` have occurred. This coding session has no authenticated
crates.io account or registry configuration tool; GitHub access alone cannot
create the registry ownership or publisher configuration. The PR must remain
unmerged while this criterion is blocked, as requested for issue #46.

References: [crates.io setup](https://crates.io/docs/trusted-publishing),
[official OIDC action](https://github.com/rust-lang/crates-io-auth-action).
