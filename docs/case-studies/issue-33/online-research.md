# Online research — issue #33

Question driving the research: *is the in-browser `cargo run` real, and where do
the "Compiled by Rust inside the browser via CheerpX." / "This binary was compiled
inside CheerpX." lines come from?*

## 1. What `cargo new` actually generates

The canonical "real deal" the issue asks us to behave 1-to-1 with is a stock Cargo
binary project. The official Cargo book documents the exact generated `src/main.rs`:

```rust
fn main() {
    println!("Hello, world!");
}
```

There is **no branding, no comment header, and a single `println!`**. Any extra
`println!` lines about CheerpX/rust-web-box are project-specific additions, not part
of a real `cargo new` project.

Source: [The Cargo Book — Creating a New Package](https://doc.rust-lang.org/cargo/guide/creating-a-new-project.html)

## 2. Is the build genuinely real? (CheerpX runs unmodified x86 binaries)

The sandbox runs on CheerpX (the engine behind leaningtech/webvm). CheerpX is a
WebAssembly-based virtual machine with an **x86-to-WebAssembly JIT compiler, a
block-based virtual filesystem, and a Linux syscall emulator**. It runs *unmodified*
x86 Linux binaries — including toolchains — in the browser, with no preprocessing.
That means the Alpine + `rustc`/`cargo` toolchain baked into our ext2 disk executes
for real; `cargo run` is a genuine `rustc` invocation, not a canned string.

CheerpX's documented performance envelope (≈2x–10x slower than native depending on
the workload) also explains the reporter's wildly varying build times — 32.81s for
the prebuilt reuse, **8m 19s** for the first real cold rebuild, then ~2s for warm
incremental rebuilds. A faked terminal would not exhibit real `rustc` wall-clock
variance, nor would it reflect the reporter's own source edits (`! 2`, `! 3`, `! 5`).

Sources:
- [WebVM README — leaningtech/webvm](https://github.com/leaningtech/webvm/blob/main/README.md)
- [CheerpX 1.0: High performance x86 virtualization in the browser via WebAssembly](https://labs.leaningtech.com/blog/cx-10)
- [CheerpX: Using WebAssembly to run any programming language in the browser](https://medium.com/leaningtech/cheerpx-using-webassembly-to-run-any-programming-language-in-the-browser-3306e1b68f06)

## 3. Why the first run differs from later runs

Cargo decides whether to rebuild using its freshness/fingerprint model (mtimes +
content hashes of inputs and profile settings). The disk image pre-bakes a debug and
release artifact (issue #17 mitigation), so the **first** `cargo run` reuses the
prebuilt binary and prints whatever *that binary* was compiled from. After an edit,
Cargo recompiles from the mirrored workspace source and prints whatever the *source*
says. If the prebuilt binary's source text and the editor seed text differ, the first
run and later runs print different things — exactly the symptom in the screenshot.

Source: [The Cargo Book — Build cache / fingerprints](https://doc.rust-lang.org/cargo/guide/build-cache.html)

## 4. Conclusion for the fix

No upstream (CheerpX/webvm) bug is involved here — the build is real and the runtime
behaves correctly. The defect is entirely in *our* content: two different branded
`println!` lines (one in `web/disk/Dockerfile.disk`, one in `web/glue/workspace-fs.js`)
that (a) look injected and (b) disagree with each other. The fix is to drop the
branding and make both sources byte-for-byte the canonical `cargo new` program, so the
first run and every later run match and the box behaves like a real terminal with a
real Linux distribution.
