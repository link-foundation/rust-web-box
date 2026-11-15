---
bump: minor
---

### Changed
- Rename the publishable crate, library, binary, CLI help, and package metadata to rust-web-box while preserving the example sum API and CLI behavior.
- Mark the bundled rust-analyzer-web and webvm-host extension packages private; keep the end-to-end tests private.
- Publish the product crate through crates.io OIDC trusted publishing on main, with no long-lived registry secret for subsequent releases.
- Verify package identity, privacy, CLI branding, and publishability in CI; document the registry's initial publication prerequisite.
