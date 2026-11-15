# CI/CD Troubleshooting Guide

This guide covers common CI/CD issues and their solutions for Rust projects in rust-web-box.

## Table of Contents

1. [Release Jobs Skipped](#release-jobs-skipped)
2. [Version Already Released (False Positive)](#version-already-released-false-positive)
3. [Crates.io Publishing Fails](#cratesio-publishing-fails)
4. [Secret Configuration Issues](#secret-configuration-issues)
5. [Multi-Language Repository Issues](#multi-language-repository-issues)

---

## Release Jobs Skipped

### Symptom
Release jobs (auto-release or manual-release) are skipped even though you expected them to run.

### Common Causes

#### 1. Upstream job was skipped
When a job like `detect-changes` is skipped (e.g., on `workflow_dispatch`), all dependent jobs are also skipped by default.

**Solution:** Ensure dependent jobs use `always() && !cancelled()` in their conditions:
```yaml
if: |
  always() && !cancelled() && (
    github.event_name == 'push' ||
    github.event_name == 'workflow_dispatch' ||
    needs.detect-changes.outputs.rs-changed == 'true'
  )
```

#### 2. Build or test failed
Release jobs depend on `build` which depends on `lint` and `test`. If any of these fail, release jobs won't run.

**Solution:** Check the logs for lint, test, and build jobs. Fix any failures before releasing.

#### 3. Wrong trigger condition
The job condition may not match your trigger event.

**Solution:** Verify the job's `if` condition matches your trigger:
- `github.event_name == 'push'` for automatic releases on merge
- `github.event_name == 'workflow_dispatch'` for manual triggers

### Reference
- [GitHub Actions Runner Issue #491](https://github.com/actions/runner/issues/491)

---

## Version Already Released (False Positive)

### Symptom
The release workflow says "version already released" but the package is not actually on crates.io.

### Root Cause
The workflow was checking git tags instead of crates.io. Git tags can exist without the package being published (e.g., from previous GitHub-only releases).

### Solution
The release pipeline now checks crates.io directly using the API:
```javascript
const response = await fetch(
  `https://crates.io/api/v1/crates/${crateName}/${version}`
);
const isPublished = response.ok && (await response.json()).version;
```

### Verification
Check if your package exists on crates.io:
```bash
curl -s "https://crates.io/api/v1/crates/YOUR_CRATE_NAME" | jq
```

### Reference
- [browser-commander Issue #29](https://github.com/link-foundation/browser-commander/issues/29)

---

## Crates.io Publishing Fails

### Symptom
The "Publish to Crates.io" step fails with an error.

### Authentication and registry setup

Both release jobs authenticate using OIDC. Check the preceding **Authenticate to
crates.io with OIDC** step, `id-token: write` permission, and the crate's trusted
publisher settings: owner `link-foundation`, repository `rust-web-box`, workflow
`release.yml`, no environment. See [the setup guide](trusted-publishing.md) for
the one-time initial publication constraint. Later releases do not require a
long-lived registry token or GitHub registry secret.

An authentication failure must fail the release. Do not bypass it or silently
skip publishing. Manual publishing jobs only run from `main`.

### Version already uploaded

The publish helper reports `already_exists` and fails if the version is already
published. Check version bumping and registry state before retrying; creating a
GitHub release alone does not verify a crates.io publication.

## Secret Configuration Issues

`GITHUB_TOKEN` is provided automatically for release commits, tags, and GitHub
releases. Registry authentication comes from the OIDC action's temporary token,
passed as `CARGO_REGISTRY_TOKEN` only to the publish step. No registry secret
needs to be configured in GitHub. Do not print tokens while debugging.

---

## Multi-Language Repository Issues

### Symptom
Scripts fail to find `Cargo.toml` or run in the wrong directory.

### Solution
The release pipeline auto-detects the repository structure:
- **Single-language:** `Cargo.toml` in repository root
- **Multi-language:** `Cargo.toml` in `rust/` subfolder

If auto-detection fails, you can explicitly configure the Rust root:
```bash
# Via environment variable
RUST_ROOT=rust rust-script scripts/publish-crate.rs

# Via CLI argument
rust-script scripts/publish-crate.rs --rust-root rust
```

### Workflow Configuration
For multi-language repos, ensure your workflow has the correct `working-directory`:
```yaml
defaults:
  run:
    working-directory: rust

steps:
  - name: Publish to Crates.io
    working-directory: .  # Override for scripts that handle paths themselves
    run: rust-script rust/scripts/publish-crate.rs
```

### Reference
- [browser-commander Issue #31](https://github.com/link-foundation/browser-commander/issues/31)

---

## General Debugging Tips

### 1. Check Job Dependencies
View the workflow graph in GitHub Actions to see which jobs depend on which.

### 2. Download Full Logs
```bash
gh run view <run-id> --repo owner/repo --log > ci-logs.txt
```

### 3. Enable Debug Logging
Add this secret to enable debug logging:
- Name: `ACTIONS_STEP_DEBUG`
- Value: `true`

### 4. Check crates.io Status
Sometimes crates.io has issues. Check: https://status.crates.io/

### 5. Verify Package Locally
Before pushing, verify your package builds and passes checks:
```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-features
cargo package --list
```
