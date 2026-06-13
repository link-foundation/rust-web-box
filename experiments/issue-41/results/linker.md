# Issue #41 — linker comparison (i386, native, emulation-invariant)

> **⚠️ Caveat (read first): this native syscall win did NOT hold in the
> real VM.** The −85 % filesystem-syscall result below is real and
> reproducible, but it was the **wrong proxy**: in the actual CheerpX VM,
> `lld` *regressed* the edited `cargo run` from ~58 s to a >180 s timeout,
> because CheerpX must x86→WASM-JIT the much larger LLVM linker. `lld` was
> therefore **reverted**. See [`in-vm-ab.md`](./in-vm-ab.md) for the
> decisive in-VM A/B.

Process-spawn and syscall counts for a one-line-edit `cargo build`
rebuild under two linker configurations. Lower file-syscall counts mean
less IndexedDB traffic in the browser — but, per the caveat above, that is
only *part* of the in-VM cost: it omits the cost of JIT-compiling the
linker binary itself, which is what sank `lld`.

lld version: LLD 17.0.6 (compatible with GNU linkers)

### default

- RUSTFLAGS: `<none>`
- **process spawns (execve): 12**
- distinct binaries cold-started: 12
- **total syscalls: 16882**
- **filesystem syscalls: 14736**

Binaries exec'd during the rebuild:
```
      1 /usr/sbin/rustc
      1 /usr/sbin/cc
      1 /usr/local/sbin/rustc
      1 /usr/local/sbin/cc
      1 /usr/local/bin/rustc
      1 /usr/local/bin/cc
      1 /usr/libexec/gcc/i586-alpine-linux-musl/13.2.1/collect2
      1 /usr/lib/rustlib/i586-alpine-linux-musl/bin/cc
      1 /usr/lib/gcc/i586-alpine-linux-musl/13.2.1/../../../../i586-alpine-linux-musl/bin/ld
      1 /usr/bin/rustc
      1 /usr/bin/cc
      1 /usr/bin/cargo
```

### fuse-ld-lld

- RUSTFLAGS: `-C link-arg=-fuse-ld=lld`
- **process spawns (execve): 12**
- distinct binaries cold-started: 12
- **total syscalls: 6862**
- **filesystem syscalls: 2157**

Binaries exec'd during the rebuild:
```
      1 /usr/sbin/rustc
      1 /usr/sbin/cc
      1 /usr/local/sbin/rustc
      1 /usr/local/sbin/cc
      1 /usr/local/bin/rustc
      1 /usr/local/bin/cc
      1 /usr/libexec/gcc/i586-alpine-linux-musl/13.2.1/collect2
      1 /usr/lib/rustlib/i586-alpine-linux-musl/bin/cc
      1 /usr/bin/rustc
      1 /usr/bin/ld.lld
      1 /usr/bin/cc
      1 /usr/bin/cargo
```

