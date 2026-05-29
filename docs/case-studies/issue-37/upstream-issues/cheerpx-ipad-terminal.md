# Upstream report — CheerpX OverlayDevice `'a1'` wedge (iPad/Safari terminal trigger)

**This is the SAME upstream bug as issues #15 (root cause #6) and #17.**
The iPad-Safari "terminal does not work" symptom in #37 is a *third*
trigger of the CheerpX `OverlayDevice` fresh-inode-allocation wedge, not a
new defect. Per the precedent set in
[`../../issue-15/upstream-issues/README.md`](../../issue-15/upstream-issues/README.md)
and [`../../issue-17/upstream-issues/README.md`](../../issue-17/upstream-issues/README.md),
we keep **one canonical upstream filing** rather than one per trigger, to
avoid wasting maintainer time on duplicates.

- **Canonical upstream issue:** filed on
  [`leaningtech/webvm`](https://github.com/leaningtech/webvm/issues) —
  see `FILED_UPSTREAM.md` in this directory for the URL once posted.
  (CheerpX itself has no public issue tracker; `leaningtech/webvm` is the
  canonical home and has issues enabled.)
- **Minimal reproducer:** `experiments/cx-130-alpine-narrow5.mjs` (from
  issue #15) — boots the rust-alpine ext2 + IDBDevice OverlayDevice and
  shows that allocating a *fresh* inode (`mkdir`/`touch`/`>` a new path)
  non-deterministically wedges, while overwriting an *existing* inode is
  reliable.

---

## Root cause (confirmed)

The terminal pipeline (`cx.run('/bin/bash', ['--login'])` → `console.onData`
→ sync-frame filter → `proc.stdout` → xterm.js) is sound and works on
desktop Chromium/Firefox/Safari. The iPad failure is the CheerpX
`OverlayDevice` `'a1'` bug:

> After Linux is up, a `cx.run` that allocates a brand-new inode on the
> writable overlay (rust-alpine ext2 base + IDBDevice writable layer
> combined via `OverlayDevice`) non-deterministically throws
> `TypeError: Cannot read properties of undefined (reading 'a1')` and
> `CheerpException: Program exited with code 71`. The exception surfaces
> via `pageerror`, **but the JS-level `cx.run` promise never settles** —
> the whole runtime wedges and every subsequent `cx.run` fails with
> `function signature mismatch`. The repro is racy and biased toward
> fresh-inode allocation; overwriting an existing inode is reliable.

## Why it presents as "terminal broken on iPad"

`/bin/bash --login` on first interactive start allocates a fresh
`~/.bash_history` inode (and bash/readline touch a few other new paths).
On a device where the wedge fires during that allocation, bash spawns,
hangs *before printing a prompt*, and never exits — the user sees the boot
banner followed by a lone cursor and nothing else. The terminal is not
"broken"; the underlying `cx.run` is wedged on inode allocation.

The wedge rate is higher on iPad Safari in practice (memory pressure and
GC timing change the race), which is why the reporter saw it on iPad while
desktop browsers usually get a working prompt.

## Environment

- CheerpX `1.3.3` (latest; bumped from 1.3.0 in this PR — the
  1.3.1–1.3.3 changelog has no `OverlayDevice` fix, so the wedge
  persists). `vscode-web@1.91.1`.
- Host page is cross-origin isolated (`crossOriginIsolated === true`,
  `SharedArrayBuffer` present) via a COOP/COEP service worker — so this is
  **not** a SAB/isolation problem; CheerpX boots far enough to print the
  banner, which already requires SAB.
- Disk: rust-alpine ext2 (read-only base) + `IDBDevice` (writable) +
  `OverlayDevice` combining them.

## Three observed triggers of the one bug

| Issue | Trigger | High-volume path |
| --- | --- | --- |
| #15 | `primeGuestWorkspace()` `mkdir -p /workspace/.vscode`, `printf > newfile` | boot-time workspace seed |
| #17 | plain `cargo run` debug build | `target/debug/{build,deps,.fingerprint}/` is dense in fresh inodes |
| #37 | interactive `bash --login` first start | `~/.bash_history` + readline temp paths |

## Workarounds shipped in rust-web-box (recoverable when upstream fixes it)

1. Pre-bake all workspace seed paths in the disk image so priming
   overwrites existing inodes only (#15).
2. `CARGO_INCREMENTAL=0` + pre-baked debug **and** release builds so
   `cargo run` re-uses inodes (#17).
3. `HISTFILE=/dev/null` everywhere bash starts (`BASH_ENV`, the shell
   profile builder, the baked `/root/.bash_profile`) so interactive bash
   stops allocating a fresh history inode (#37).
4. `skipPrime` + `Promise.race` timeouts so a wedge bounds boot at
   `vmPhase: ready` instead of hanging forever.
5. **First-output watchdog**: if `bash` produces no output within 15 s of
   spawn, rust-web-box writes a visible advisory into the terminal (reload
   / use Chromium) instead of leaving a blank pane (#37).

## Suggested fix directions for upstream

- The primary ask: make fresh-inode allocation on `OverlayDevice`
  deterministic (the `'a1'` access reads an undefined object — looks like a
  missing/late-initialised entry in the overlay's inode table under a
  specific allocation ordering).
- Defensive: when the internal error fires, **reject the `cx.run` promise**
  instead of leaving it permanently pending, so callers can recover
  (respawn / surface an error) rather than wedging the whole runtime.

## How to capture an on-device diagnostic dump

rust-web-box exposes `window.__rustWebBox.dump()` (auto-collected with
`?debug=1`). On a failing iPad it reports `platform`, `maxTouchPoints`,
`isSafari`, `isIPad`, `crossOriginIsolated`, and the `shellLoop` snapshot
(`spawns`, `exits`, `errors`, `fastCycles`, `silentSpawns`,
`slowFirstOutput`, `lastError`) — `silentSpawns > 0` with `running: true`
and no `lastExitCode` is the wedge signature described above.
