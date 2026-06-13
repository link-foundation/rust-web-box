// Unit tests for the in-VM cargo benchmark harness (issue #41).
//
// The benchmark runs the user's REAL `cargo run` / `cargo build` / `cargo
// check` inside the CheerpX guest and ships per-phase wall-clock timing back
// over the same OSC-frame stdout channel workspace-sync already uses. These
// tests exercise the pure, page-side pieces in isolation:
//   - buildCargoBenchScript: the guest shell script is well-formed, quotes
//     its inputs safely, replicates the shipped build env, and never deletes
//     the workspace fingerprint tree (which would trip the CheerpX 'a1' wedge).
//   - parseCargoBenchPayload: decodes the line-oriented payload back into a
//     structured { env, phases, passes } result, and rejects junk.
//   - createCargoBenchFrameParser: extracts frames from a noisy byte stream,
//     including when a frame is split across chunk boundaries.
//   - summarizeCargoBench: renders minutes-scale phases the way the issue
//     reports them (6m04s, 23.96s).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

import {
  CARGO_BENCH_OSC_PREFIX,
  CARGO_BENCH_OSC_END,
  CARGO_BENCH_SCHEMA,
  SHIPPED_BENCH_ENV,
  buildCargoBenchScript,
  parseCargoBenchPayload,
  createCargoBenchFrameParser,
  summarizeCargoBench,
} from '../glue/cargo-bench.js';

const b64 = (input) => Buffer.from(input).toString('base64');

// Assemble a realistic decoded payload, then wrap it the way the guest does:
// the OSC frame carries the base64 of the whole line-oriented payload.
function makeBenchPayload({
  env = {
    arch: 'i686',
    kernel: 'Linux 6.1.0',
    nproc: '1',
    rustc: 'rustc 1.78.0 (9b00956e5 2024-04-29)',
    cargo: 'cargo 1.78.0',
    cwd: '/workspace',
  },
  phases = [
    { id: 'noop-run', secs: '23.960', exit: '0', compiled: '0', label: 'cargo run (no change)', cmd: 'cargo run', tail: 'Finished dev' },
    { id: 'edit-run', secs: '364.120', exit: '0', compiled: '1', label: 'cargo run (one-line edit)', cmd: 'cargo run', tail: 'Compiling hello v0.1.0' },
    { id: 'edit-build', secs: '360.500', exit: '0', compiled: '1', label: 'cargo build (one-line edit)', cmd: 'cargo build', tail: 'Finished' },
    { id: 'edit-check', secs: '12.300', exit: '0', compiled: '1', label: 'cargo check (one-line edit)', cmd: 'cargo check', tail: 'Finished' },
  ],
  passes = { link_binary: '0.049', type_check_crate: '0.002', total: '0.072' },
} = {}) {
  const lines = ['RWB_BENCH_V1'];
  for (const [key, value] of Object.entries(env)) {
    lines.push(`E\t${key}\t${b64(value)}`);
  }
  for (const p of phases) {
    lines.push(`P\t${p.id}\t${p.secs}\t${p.exit}\t${p.compiled}\t${b64(p.label)}\t${b64(p.cmd)}\t${b64(p.tail)}`);
  }
  for (const [name, secs] of Object.entries(passes)) {
    lines.push(`T\t${name}\t${secs}`);
  }
  lines.push('');
  return b64(lines.join('\n'));
}

function benchFrame(encodedPayload) {
  return `${CARGO_BENCH_OSC_PREFIX}${encodedPayload}${CARGO_BENCH_OSC_END}`;
}

test('cargo-bench: buildCargoBenchScript emits a well-formed, self-restoring guest script', () => {
  const script = buildCargoBenchScript({});

  // It changes into the workspace and bails clearly if it is missing.
  assert.match(script, /cd '\/workspace' 2>\/dev\/null \|\| \{ printf 'RWB_BENCH_NO_WORKSPACE/);
  // It replicates the shipped build configuration so numbers match the terminal.
  for (const kv of SHIPPED_BENCH_ENV) {
    assert.ok(script.includes(`export ${kv}`), `script should export ${kv}`);
  }
  // It runs the REAL cargo commands the issue is about — no cargo check
  // substitution for the headline edit-run phase.
  assert.match(script, /__rwb_phase noop-run "cargo run \(no change\)" cargo run/);
  assert.match(script, /__rwb_phase edit-run "cargo run \(one-line edit\)" cargo run/);
  assert.match(script, /__rwb_phase edit-build "cargo build \(one-line edit\)" cargo build/);
  assert.match(script, /__rwb_phase edit-check "cargo check \(one-line edit\)" cargo check/);
  // The -Z time-passes split runs by default.
  assert.match(script, /RUSTC_BOOTSTRAP=1 cargo rustc --bin 'hello' -- -Z time-passes/);
  // It only ever rewrites the existing src/main.rs inode and restores the
  // shipped baseline at the end — it must never delete the fingerprint/target
  // tree (that allocation is what trips the CheerpX 1.3.x 'a1' wedge, #37).
  assert.match(script, /__rwb_set_main "Hello, world!"[\s\S]*\} \| \{/);
  assert.doesNotMatch(script, /rm -rf/);
  assert.doesNotMatch(script, /\.fingerprint/);
  // It defends against the per-prompt workspace sync firing mid-benchmark.
  assert.match(script, /export RWB_SYNC_DISABLE=1/);
  // It emits exactly one bench OSC frame on stdout.
  assert.ok(script.includes("printf '\\033]777;rust-web-box-bench;'"));
  assert.ok(script.includes("printf '\\007'"));
});

test('cargo-bench: buildCargoBenchScript can omit the time-passes block and override env', () => {
  const script = buildCargoBenchScript({ timePasses: false, env: ['CARGO_INCREMENTAL=1'] });
  assert.doesNotMatch(script, /-Z time-passes/);
  assert.ok(script.includes('export CARGO_INCREMENTAL=1'));
  // Overriding env replaces the shipped knobs entirely.
  assert.equal(script.includes('export CARGO_PROFILE_DEV_CODEGEN_UNITS=1'), false);
});

test('cargo-bench: buildCargoBenchScript safely quotes hostile workspace/bin names', () => {
  const script = buildCargoBenchScript({ workspaceDir: "/tmp/it's here", binName: "a'b" });
  // The single quote is closed/escaped/reopened, never left to break out.
  assert.match(script, /cd '\/tmp\/it'\\''s here'/);
  assert.match(script, /cargo rustc --bin 'a'\\''b'/);
});

test('cargo-bench: generated guest script is valid POSIX shell', () => {
  // The script runs under busybox /bin/sh in the guest. `sh -n` is the
  // closest local proxy for a parse-time syntax check.
  for (const opts of [{}, { timePasses: false }, { env: [] }]) {
    const script = buildCargoBenchScript(opts);
    assert.doesNotThrow(
      () => execFileSync('sh', ['-n'], { input: script }),
      `sh -n rejected script for opts=${JSON.stringify(opts)}`,
    );
  }
});

test('cargo-bench: parseCargoBenchPayload round-trips env, phases, and passes', () => {
  const result = parseCargoBenchPayload(makeBenchPayload());

  assert.equal(result.schema, CARGO_BENCH_SCHEMA);
  assert.equal(result.env.arch, 'i686');
  assert.equal(result.env.nproc, '1');
  assert.equal(result.env.rustc, 'rustc 1.78.0 (9b00956e5 2024-04-29)');
  assert.equal(result.env.cwd, '/workspace');

  assert.equal(result.phases.length, 4);
  const editRun = result.phases.find((p) => p.id === 'edit-run');
  assert.ok(editRun);
  assert.equal(editRun.seconds, 364.12);
  assert.equal(editRun.exitCode, 0);
  assert.equal(editRun.compiled, true);
  assert.equal(editRun.label, 'cargo run (one-line edit)');
  assert.equal(editRun.cmd, 'cargo run');
  assert.equal(editRun.tail, 'Compiling hello v0.1.0');

  const noop = result.phases.find((p) => p.id === 'noop-run');
  assert.equal(noop.compiled, false, 'no-op run should not report compilation');

  assert.equal(result.passes.link_binary, 0.049);
  assert.equal(result.passes.type_check_crate, 0.002);
  assert.equal(result.passes.total, 0.072);
});

test('cargo-bench: parseCargoBenchPayload rejects an unknown schema header', () => {
  const bad = b64(['NOT_A_BENCH', 'E\tarch\t' + b64('i686'), ''].join('\n'));
  assert.throws(() => parseCargoBenchPayload(bad), /unsupported cargo bench payload/);
});

test('cargo-bench: parseCargoBenchPayload tolerates a phase with no tail', () => {
  const payload = b64([
    'RWB_BENCH_V1',
    `P\tedit-run\t5.000\t0\t1\t${b64('cargo run')}\t${b64('cargo run')}\t`,
    '',
  ].join('\n'));
  const result = parseCargoBenchPayload(payload);
  assert.equal(result.phases[0].tail, '');
  assert.equal(result.phases[0].seconds, 5);
});

test('cargo-bench: frame parser extracts a frame and leaves surrounding text', () => {
  const encoded = makeBenchPayload();
  let captured = null;
  const parser = createCargoBenchFrameParser({ onFrame: (p) => { captured = p; } });
  const visible = parser.filter(`before${benchFrame(encoded)}after`);
  assert.equal(visible, 'beforeafter');
  assert.equal(captured, encoded);
});

test('cargo-bench: frame parser reassembles a frame split across chunks', () => {
  const encoded = makeBenchPayload();
  const whole = `noise-${benchFrame(encoded)}-tail`;
  let captured = null;
  const parser = createCargoBenchFrameParser({ onFrame: (p) => { captured = p; } });

  // Feed one byte at a time — the streaming buffer must reassemble the frame.
  let visible = '';
  for (const ch of whole) visible += parser.filter(ch);
  visible += parser.flush();

  assert.equal(captured, encoded, 'frame should survive byte-by-byte delivery');
  assert.equal(visible, 'noise--tail');
});

test('cargo-bench: frame parser passes through a stream with no frame untouched', () => {
  let calls = 0;
  const parser = createCargoBenchFrameParser({ onFrame: () => { calls += 1; } });
  const text = 'Compiling hello v0.1.0\n   Finished dev [unoptimized] target(s)\n';
  assert.equal(parser.filter(text) + parser.flush(), text);
  assert.equal(calls, 0);
});

test('cargo-bench: summarizeCargoBench renders minutes-scale phases like the issue', () => {
  const result = parseCargoBenchPayload(makeBenchPayload());
  const report = summarizeCargoBench(result, { wallMs: 364500 });

  // Environment proof line.
  assert.match(report, /arch=i686/);
  assert.match(report, /rustc 1\.78\.0/);
  // The reporter's exact figures, formatted for humans.
  assert.match(report, /cargo run \(no change\)\s+23\.96s \[fresh\]/);
  assert.match(report, /cargo run \(one-line edit\)\s+6m04\.1s \(364\.1s\) \[compiled\]/);
  // time-passes split with the dominant phase called out.
  assert.match(report, /link_binary\s+0\.049s \(68%\)/);
  assert.match(report, /total\s+0\.072s \(100%\)/);
  // Independent page-side wall-clock cross-check.
  assert.match(report, /page-side wall-clock: 364\.50s/);
});

test('cargo-bench: summarizeCargoBench handles an empty/absent result gracefully', () => {
  assert.equal(summarizeCargoBench(null), 'cargo bench: no result');
  const bare = summarizeCargoBench({ schema: CARGO_BENCH_SCHEMA, env: {}, phases: [], passes: {} });
  assert.match(bare, /cargo bench \(real in-VM build\)/);
});
