# Issue #41 — real compile-work measurement (i386 Alpine, native)

## Environment

```
uname -m : x86_64   (host kernel arch; the userspace is i386)
nproc    : 6
rustc    : rustc 1.78.0 (9b00956e5 2024-04-29) (Alpine Linux 1.78.0-r1)
cargo    : cargo 1.78.0
musl/gcc : gcc (Alpine 13.2.1_git20240309) 13.2.1 20240309
lld      : LLD 17.0.6 (compatible with GNU linkers)
```

## One-line-edit rebuild cost by profile configuration

All times are wall-clock for the SAME single-file zero-dependency crate
the in-browser disk ships. `rebuild` is the issue's 6m04s case (edit one
line, `cargo build`). Native i386 here; CheerpX emulation is NOT included.

| scenario               | cold   | no-op  | rebuild  | check   |
|------------------------|--------|--------|----------|---------|
| stock-default          |   0.27s |   0.02s |     0.14s |    0.08s |
| shipped-slowknobs      |   0.25s |   0.03s |     0.14s |    0.08s |
| incremental-on         |   0.26s |   0.03s |     0.15s |    0.08s |
| incremental-lld        |   0.25s |   0.03s |     0.15s |    0.08s |
| shipped-1job           |   0.25s |   0.02s |     0.14s |    0.08s |
| incremental-1job       |   0.25s |   0.03s |     0.15s |    0.07s |

## Front-end / codegen / link split (rustc -Z time-passes)

Captured for the shipped knobs and the incremental fix. See the
`passes-*.log` files for the full pass list; the phases that matter:
`*_module_codegen` / `LLVM_passes` (codegen) and `link_binary*` (link).

### shipped
```
time:   0.002; rss:   96MB ->  108MB (  +11MB)	type_check_crate
time:   0.001; rss:  122MB ->  129MB (   +6MB)	codegen_to_LLVM_IR
time:   0.004; rss:  116MB ->  129MB (  +13MB)	codegen_crate
time:   0.005; rss:  129MB ->  117MB (  -12MB)	LLVM_passes
time:   0.003; rss:  116MB ->  117MB (   +1MB)	finish_ongoing_codegen
time:   0.049; rss:  117MB ->  118MB (   +1MB)	link_binary
time:   0.072; rss:   47MB ->  118MB (  +70MB)	total
```

### incremental
```
time:   0.002; rss:   98MB ->  110MB (  +12MB)	type_check_crate
time:   0.002; rss:  125MB ->  138MB (  +13MB)	codegen_to_LLVM_IR
time:   0.007; rss:  118MB ->  138MB (  +19MB)	codegen_crate
time:   0.006; rss:  132MB ->  119MB (  -13MB)	LLVM_passes
time:   0.001; rss:  119MB ->  119MB (   +0MB)	finish_ongoing_codegen
time:   0.052; rss:  119MB ->  120MB (   +1MB)	link_binary
time:   0.084; rss:   48MB ->  119MB (  +72MB)	total
```

The link step is `0.049s` of `0.072s` total (**68%**), so the linker is the
single largest compile phase — and it is dominated by filesystem I/O, not CPU.

## Linker: the one native knob that changes the syscall count (the real lever)

Wall-clock above is emulation-invariant noise (everything is <0.3s natively).
What is NOT invariant is the *number of filesystem syscalls* the link step
issues, because under CheerpX every one crosses the WASM/JS boundary into the
IndexedDB OverlayDevice. `measure-linker.sh` strace-counts the SAME one-line
rebuild with GNU `ld` vs. `lld` (full detail in `linker.md`):

| linker                    | execve | total syscalls | filesystem syscalls |
|---------------------------|--------|----------------|---------------------|
| GNU `ld` (shipped default)|     12 |        ~16,880 |          **14,736** |
| `lld` (`-fuse-ld=lld`)    |     12 |         ~6,860 |           **2,157** |

**−85% filesystem syscalls, −59% total syscalls**, reproducible across runs and
deterministic on the file-syscall count. GNU `ld` walks the libc archive with
thousands of `_llseek`/`readv` calls; `lld` mmaps it instead. The process count
is unchanged (12 either way), so this is purely an I/O win — which is exactly
the cost CheerpX multiplies. `ld.lld` is confirmed in the process tree and the
output binary's `.comment` reads `Linker: LLD 17.0.6`.

Caveat: the `direct-lld` config (`-C linker=ld.lld`, bypassing the gcc driver)
fails to link on musl — it cannot find `Scrt1.o`/`crti.o`. The practical config
is `-C link-arg=-fuse-ld=lld`: keep the gcc driver, just swap the linker. This
is what the disk now ships.

