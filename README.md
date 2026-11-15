# rust-web-box

Rust Web Box is a browser-based Rust development environment built with VS Code Web and a CheerpX Linux VM. Open the [workbench](https://link-foundation.github.io/rust-web-box/) or see the [web development guide](web/README.md) to run it locally.

[![CI/CD Pipeline](https://github.com/link-foundation/rust-web-box/workflows/CI%2FCD%20Pipeline/badge.svg)](https://github.com/link-foundation/rust-web-box/actions/workflows/release.yml)
[![Crates.io](https://img.shields.io/crates/v/rust-web-box)](https://crates.io/crates/rust-web-box)
[![Docs.rs](https://docs.rs/rust-web-box/badge.svg)](https://docs.rs/rust-web-box)
[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](LICENSE)

## Packages

`rust-web-box` is the only publishable package in this repository. The Rust crate retains the example `sum` library function and CLI inherited from the development pipeline template. The browser workbench is deployed separately by the Pages workflow; installing the crate provides the example CLI.

The `web/extensions/rust-analyzer-web` and `web/extensions/webvm-host` folders contain private integration packages bundled into the workbench. Their names and VS Code extension identifiers remain stable so existing workbench integrations keep working. The `web/tests` end-to-end test package is also private. None of these packages is published to npm or the VS Code Marketplace by the release pipeline.

## CLI and library

```bash
cargo install rust-web-box
rust-web-box --help
rust-web-box --a 3 --b 7
# 10
```

```rust
use rust_web_box::sum;

assert_eq!(sum(2, 3), 5);
```

## Development

```bash
git clone https://github.com/link-foundation/rust-web-box.git
cd rust-web-box
cargo build
cargo run -- --a 3 --b 7
cargo run --example basic_usage
cargo test
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
node --test web/tests/package-policy.test.mjs
```

The Rust tests cover the library, CLI, and release helpers. Web tests use Node's built-in test runner; see [web/README.md](web/README.md) for browser and workbench build instructions. CI runs Rust tests on Linux, macOS, and Windows, formatting, Clippy, coverage, package verification, and the package policy checks.

## Releases

Add a [changelog fragment](changelog.d/README.md) for user-facing changes. The release workflow chooses the version bump, updates the changelog, and publishes `rust-web-box` after changes reach `main`. Manual instant releases also run from `main`. Versions are managed by the pipeline; a fragment is the release trigger.

Both release paths use crates.io OIDC trusted publishing through `rust-lang/crates-io-auth-action`. No long-lived registry secret is used for later releases. See [trusted publishing setup](docs/ci-cd/trusted-publishing.md) for the required initial publication and registry configuration, and [troubleshooting](docs/ci-cd/troubleshooting.md) for failures.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines and [web/README.md](web/README.md) for the browser environment's architecture.

The development pipeline originated from [rust-ai-driven-development-pipeline-template](https://github.com/link-foundation/rust-ai-driven-development-pipeline-template). CLI arguments use [lino-arguments](https://github.com/link-foundation/lino-arguments).

## License

[Unlicense](LICENSE) — public domain.
