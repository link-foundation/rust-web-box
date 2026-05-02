## Environment

- Runtime: `cheerpx@1.3.0`
- Downstream app: https://github.com/link-foundation/rust-web-box
- Reported page: https://link-foundation.github.io/rust-web-box/
- Downstream issue: https://github.com/link-foundation/rust-web-box/issues/19

## Reproduction

1. Open `https://link-foundation.github.io/rust-web-box/`.
2. Wait for the WebVM bash terminal to reach the `/workspace` prompt.
3. Run `cargo build` or `cargo run` in the terminal.
4. Open the browser developer console.

## Observed

The console repeatedly prints messages like:

```text
[26:26] TODO: Advisory locking is only stubbed
[28:28] TODO: Advisory locking is only stubbed
```

The messages are emitted by the CheerpX runtime while the guest is otherwise able to run Cargo successfully.

## Expected

Release builds of the runtime should not print internal `TODO` diagnostics to the browser console by default. Ideally advisory locking is implemented or documented as unsupported; if the diagnostic remains useful, it should be behind an opt-in debug flag.

## Impact

Downstream applications use the browser console to detect real startup failures. Repeated internal runtime diagnostics make it harder to notice actionable warnings/errors.

## Workaround

Downstream pages can filter the exact console message, but that only hides the symptom and cannot change the advisory-locking behavior inside the guest runtime.
