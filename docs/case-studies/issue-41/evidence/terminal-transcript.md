# Reconstructed terminal transcript (from the issue screenshot)

Source: [`issue-screenshot.jpg`](./issue-screenshot.jpg) — the deployed app at
`https://link-foundation.github.io/rust-web-box/`, VS Code Web with the
`WebVM bash` integrated terminal.

The screenshot shows the `webvm-host` boot banner followed by **two**
consecutive `cargo run` invocations. Transcribed verbatim:

```text
Powered by CheerpX (leaningtech/webvm) and VS Code Web.

[rust-web-box] Booting Linux VM… ........
[rust-web-box] Linux VM ready ✓
[rust-web-box] disk: ./disk/rust-alpine.ext2
[rust-web-box] Workspace mirrored to /workspace — try `cargo run`.

root@rust-web-box:/workspace# cargo run
    Finished `dev` profile [unoptimized] target(s) in 23.96s
     Running `target/debug/hello`
Hello, world!
root@rust-web-box:/workspace# cargo run
   Compiling hello v0.1.0 (/workspace)
    Finished `dev` profile [unoptimized] target(s) in 6m 04s
     Running `target/debug/hello`
Hello, rust world!
root@rust-web-box:/workspace#
```

## What the two runs prove

| Run | Cargo phase observed | Wall-clock | Interpretation |
|-----|----------------------|-----------|----------------|
| 1st `cargo run` | `Finished` only — **no** `Compiling` line | **23.96 s** | Warm pre-baked artifact. Cargo's freshness check decided nothing changed and only the **final invocation / freshness pass** ran. 24 s for a *no-op* build is itself a signature of slow in-VM execution. |
| 2nd `cargo run` | `Compiling hello v0.1.0` → `Finished` | **6 min 04 s** | The user edited `src/main.rs` (`"Hello, world!"` → `"Hello, rust world!"`, visible in the editor pane at line 2), so this is a **real** debug rebuild of a one-line, zero-dependency crate: invoke `rustc` once, run LLVM codegen, link one binary. |

The output `Hello, rust world!` matches the edited source in the editor —
i.e. a freshly compiled binary actually ran. This is the strongest
single piece of evidence that the VM is **not** faked (see
[`../README.md` → "Is the VM real?"](../README.md#is-the-vm-real-anti-fake-verification)).

## The headline numbers

- **6 min 04 s** to rebuild a **single-file, zero-dependency** `hello`
  crate after a one-line edit.
- **23.96 s** for a *no-op* `cargo run` that compiled nothing.

For comparison, the same edit-and-rebuild on a native host completes in
well under one second. The ~360× slowdown is the subject of this case
study.
