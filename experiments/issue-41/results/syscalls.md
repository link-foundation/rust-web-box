# Issue #41 — syscall & process-spawn census (i386, native, emulation-invariant)

CheerpX cost scales with process spawns (cold-start JIT) and syscalls
(WASM/JS boundary + IndexedDB overlay), NOT with native wall-clock. These
counts are the same whether run natively or under CheerpX — only their
per-unit cost changes. They explain the in-browser slowdown.

### rebuild-build — `cargo build`

- **process spawns (execve): 12**
- **total syscalls: 16812**
- **filesystem syscalls: 14736** (these hit the IndexedDB overlay in-browser)

Top syscalls by call count (strace -c):
```
% time     seconds  usecs/call     calls    errors syscall
------ ----------- ----------- --------- --------- ------------------
  1.90    0.040531           6      5937         1 _llseek
  1.79    0.038131           8      4646           readv
  0.65    0.013921           8      1548           writev
  0.26    0.005605           6       878       866 readlink
  0.39    0.008311          10       814           mmap2
  0.43    0.009246          17       533         2 read
  0.71    0.015225          31       488           munmap
  0.23    0.004823          11       414       148 statx
  0.26    0.005637          22       250        69 open
  0.13    0.002747          13       211           fcntl64
  0.09    0.001875           9       190           close
  0.11    0.002334          16       145           madvise
  0.07    0.001479          15        96           rt_sigprocmask
 43.77    0.933737       10610        88        10 futex
  0.17    0.003523          51        68           mprotect
```

### rebuild-check — `cargo check`

- **process spawns (execve): 5**
- **total syscalls: 1645**
- **filesystem syscalls: 1029** (these hit the IndexedDB overlay in-browser)

Top syscalls by call count (strace -c):
```
% time     seconds  usecs/call     calls    errors syscall
------ ----------- ----------- --------- --------- ------------------
  0.35    0.000556           1       293         2 read
  1.20    0.001899          10       185           mmap2
  0.69    0.001095           6       175       169 readlink
  0.62    0.000987           5       173        56 statx
  1.10    0.001747          15       116        29 open
  0.28    0.000449           4       109           fcntl64
  0.42    0.000659           6        98           close
  0.28    0.000438           5        80           madvise
  0.31    0.000497          10        49           rt_sigprocmask
 39.65    0.062796        1427        44         6 futex
  1.82    0.002876          68        42           munmap
  0.31    0.000485          11        41           mprotect
  0.23    0.000364          16        22           getdents64
  0.13    0.000212          10        21           sigaltstack
  0.05    0.000080           4        18           flock
```

## Process trees (binaries CheerpX must cold-start)

Each distinct binary begins execution in CheerpX's slow interpreter.
`cargo build` spawns the whole GNU link toolchain (`cc`→`collect2`→`ld`)
that `cargo check` never touches. Repeated paths below are PATH-search
misses — themselves wasted `execve` syscalls across the WASM/JS boundary.

### process tree — `cargo build`
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

### process tree — `cargo check`
```
      1 /usr/sbin/rustc
      1 /usr/local/sbin/rustc
      1 /usr/local/bin/rustc
      1 /usr/bin/rustc
      1 /usr/bin/cargo
```

## Takeaway

The delta in **execve** between `cargo build` and `cargo check` is the
set of link-stage child processes (`cc`, `collect2`, `ld`/`ld.lld`) that
check skips. Under CheerpX each of those is a fresh cold-start. The delta
in **file syscalls** is the codegen + link I/O against the IndexedDB
overlay. Both deltas are what a faster linker (fewer/cheaper link procs)
and an off-overlay `target/` (cheaper file syscalls) directly reduce.

