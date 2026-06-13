# Issue #41 — CI failure root cause: a shell-quoting bug in the lld guard

The PR #42 check **Build rust-alpine.ext2** went red at the *Smoke-test the
image* step (run `27467245451`, lines 917-920):

```
edited smoke output from disk image          # the in-VM rebuild worked
                                             # <-- blank: empty .comment
target/debug/hello not linked with lld — issue #41 fix regressed
##[error]Process completed with exit code 1.
```

The binary on the image **was** correctly lld-linked. The failure was a false
alarm produced by the regression guard itself.

## Root cause: an apostrophe closes the chroot's single-quoted string

The guard added in `b52fcd2` ran inside a single-quoted chroot:

```bash
sudo chroot "$MNT" /bin/bash -lc '
  ...
  # so assert that binary carries lld's signature: lld stamps   # <-- HERE
  comment=$(readelf -p .comment target/debug/hello 2>/dev/null || true)
  printf "%s" "$comment" | grep -qi 'LLD' \
    || (echo "target/debug/hello not linked with lld — issue #41 fix regressed" && exit 1)
'
```

The apostrophe in the comment word **`lld's`** terminates the `'...'` string
opened after `-lc`. Everything from `comment=$(...)` onward therefore runs in
the **outer GitHub Actions runner shell**, not in the chroot. There:

- `target/debug/hello` is a **relative** path. The runner's cwd is the repo
  root, which has no `target/debug/hello`.
- `readelf` reads nothing → `comment` is empty (the blank line in the log).
- `grep -qi LLD` finds nothing → the `|| (... exit 1)` branch fires → a false
  "regressed" and a failed step.

`bash` never reaches the step's later lines (the lone closing `'`) because the
explicit `exit 1` happens first — so the symptom is a *runtime* failure, not a
parse error.

This is purely a CI-guard bug. The shipped fix (link with `lld`, see
`linker.md`/`summary.md`) is unaffected: the image's binaries are lld-linked.

## The fix

1. **Remove the in-chroot guard** — deletes the apostrophe and the fragile
   in-chroot `readelf` call. The chroot body is now apostrophe-free, so the
   single-quoted string spans exactly the intended lines (and the in-chroot
   `cargo check` guard is restored).
2. **Add a host-side guard after the chroot**, while `$MNT` is still mounted,
   using the runner's **native** `readelf` (binutils, now installed
   explicitly) against absolute paths on the image. It checks both the
   release pre-bake (the lld config produces lld output) and the debug binary
   the chroot just recompiled (an in-VM edit→rebuild also links with lld).
3. **`export HOME=/root`** at the top of the chroot body so cargo discovers
   `/root/.cargo/config.toml` exactly as the in-browser CheerpX VM does.

Running the guard on the host is also more correct: the in-image `readelf` is
an i386 binary that would execute under the runner's QEMU emulation, whereas
inspecting an ELF's `.comment` needs no emulation at all.

## Verification (both scripts re-runnable; outputs captured alongside)

| script | proves | output |
|--------|--------|--------|
| `repro-quoting-bug.sh` | the **buggy** step (`b52fcd2`) exits 1 with a false "regressed" on an all-lld-linked image | `repro-bug.txt` |
| `verify-quoting.sh` | the **fixed** step passes: parses, apostrophe-free chroot body, host guard inspects both binaries, exits 0 on lld / 1 on a revert | `quoting.txt` |

`verify-quoting.sh` runs the *actual* extracted run block (real YAML parse) in
a sandbox with stubbed `sudo/mount/chroot/readelf`, then cross-checks the
guard's logic against real linker output:

- Host fixtures: `gcc` (GNU ld) `.comment` has **no** `LLD`; `gcc -fuse-ld=lld`
  `.comment` **has** `LLD`.
- Real i386 image binaries (from the measurement harness, when present):
  `release-prebake`, `debug-prebake`, `debug-recompiled` → lld; the
  `debug-noconfig` revert simulation → not lld (the guard catches it).

`readelf -p .comment` parses identically regardless of target arch, so the
host x86-64 fixtures validate the same check applied to the image's i386
binaries.
