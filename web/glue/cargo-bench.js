// In-VM cargo build benchmark (issue #41).
//
// The reporter measured a one-line edit to a single-file hello crate taking
// 6m04s to `cargo run` in the browser, versus <1s on their local machine.
// To attribute that cost to the EXACT phase that is slow — and to prove the
// numbers come from a REAL CheerpX VM rather than an assumption — we run the
// actual build inside the guest and report per-phase wall-clock timing.
//
// This is deliberately NOT a workaround: it changes nothing about how the
// build runs. It stages a measurement script on CheerpX's /data mount, runs
// the user's real `cargo run` / `cargo build` / `cargo check`, times each
// phase with the guest clock, and reports the rustc front-end/codegen/link
// split via `-Z time-passes`. Results travel back over the same OSC-frame
// stdout channel that workspace-sync already uses (see workspace-sync.js),
// so no new, version-fragile CheerpX API is involved.
//
// The frame the guest emits looks like:
//   \x1b]777;rust-web-box-bench;<base64 of a line-oriented payload>\x07
// where the decoded payload is:
//   RWB_BENCH_V1
//   E\t<key>\t<base64 value>            (environment proof: arch, rustc, ...)
//   P\t<id>\t<secs>\t<exit>\t<compiled>\t<base64 label>\t<base64 cmd>\t<base64 tail>
//   T\t<pass name>\t<secs>             (rustc -Z time-passes split)

export const CARGO_BENCH_OSC_PREFIX = '\x1b]777;rust-web-box-bench;';
export const CARGO_BENCH_OSC_END = '\x07';
export const CARGO_BENCH_SCHEMA = 'rust-web-box-bench/v1';

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

// The build configuration the shipped disk actually uses (issues #17/#31):
// incremental OFF, no debuginfo, a single codegen unit. We measure THIS by
// default so the numbers match what the interactive terminal experiences.
// Pass a different `env` (e.g. CARGO_INCREMENTAL=1, or lld RUSTFLAGS) to
// benchmark a candidate fix against the same crate.
export const SHIPPED_BENCH_ENV = [
  'CARGO_INCREMENTAL=0',
  'CARGO_PROFILE_DEV_DEBUG=0',
  'CARGO_PROFILE_DEV_CODEGEN_UNITS=1',
];

/**
 * Build the guest shell script that runs the real cargo benchmark and emits
 * a single `rust-web-box-bench` OSC frame on stdout.
 *
 * The script only ever overwrites the EXISTING `src/main.rs` inode and reuses
 * the pre-baked `target/` tree, so it does not allocate the brand-new
 * OverlayDevice inodes that trip the CheerpX 1.3.x 'a1' wedge (issue #37).
 * It restores `src/main.rs` to the shipped "Hello, world!" baseline on exit.
 */
export function buildCargoBenchScript({
  workspaceDir = '/workspace',
  binName = 'hello',
  timePasses = true,
  env = SHIPPED_BENCH_ENV,
} = {}) {
  const dir = shellQuote(workspaceDir);
  const bin = shellQuote(binName);
  const envExports = (env ?? []).map((kv) => `export ${kv}`);

  const lines = [
    'set -u',
    `cd '${dir}' 2>/dev/null || { printf 'RWB_BENCH_NO_WORKSPACE\\n' >&2; exit 1; }`,
    // Never let the per-prompt workspace sync fire while we benchmark (we run
    // under /bin/sh, not the interactive bash, but be defensive).
    'export RWB_SYNC_DISABLE=1',
    // Replicate the shipped build configuration (or the caller's override).
    ...envExports,
    'RWB_LOG=/tmp/rwb-bench-phase.log',
    'SRC=src/main.rs',
    // High-resolution clock when the guest `date` supports %N, integer
    // seconds otherwise (busybox). Either way the in-browser phases are
    // seconds-to-minutes, so resolution is never the limiting factor.
    '__rwb_now() {',
    "  date +%s.%N 2>/dev/null | awk '{ if ($0 ~ /^[0-9]+(\\.[0-9]+)?$/) printf \"%s\", $0; else { n = $0; sub(/\\..*/, \"\", n); printf \"%s\", n } }'",
    '}',
    "__rwb_delta() { awk -v a=\"$1\" -v b=\"$2\" 'BEGIN { d = b - a; if (d < 0) d = 0; printf \"%.3f\", d }'; }",
    "__rwb_b64() { printf '%s' \"$1\" | base64 | tr -d '\\n'; }",
    // Rewrite main.rs to a one-line-different program and bump its mtime so
    // Cargo treats the crate as dirty and performs a real rebuild.
    '__rwb_set_main() {',
    "  printf 'fn main() {\\n    println!(\"%s\");\\n}\\n' \"$1\" > \"$SRC\"",
    '  touch "$SRC" 2>/dev/null || true',
    '}',
    // __rwb_phase <id> <label> <cmd...>: time one real cargo invocation.
    '__rwb_phase() {',
    '  __rwb_id="$1"; __rwb_label="$2"; shift 2',
    '  : > "$RWB_LOG"',
    '  __rwb_s=$(__rwb_now)',
    '  "$@" > "$RWB_LOG" 2>&1',
    '  __rwb_rc=$?',
    '  __rwb_e=$(__rwb_now)',
    '  __rwb_secs=$(__rwb_delta "$__rwb_s" "$__rwb_e")',
    '  __rwb_compiled=0',
    '  grep -q "Compiling" "$RWB_LOG" 2>/dev/null && __rwb_compiled=1',
    "  __rwb_tail=$(tail -c 400 \"$RWB_LOG\" 2>/dev/null | base64 | tr -d '\\n')",
    "  printf 'P\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\t%s\\n' \"$__rwb_id\" \"$__rwb_secs\" \"$__rwb_rc\" \"$__rwb_compiled\" \"$(__rwb_b64 \"$__rwb_label\")\" \"$(__rwb_b64 \"$*\")\" \"$__rwb_tail\"",
    '}',
    '{',
    "  printf 'RWB_BENCH_V1\\n'",
    // Environment proof: these come straight from the running guest, so a
    // faked/short-circuited VM cannot produce them.
    "  printf 'E\\tarch\\t%s\\n' \"$(__rwb_b64 \"$(uname -m 2>/dev/null)\")\"",
    "  printf 'E\\tkernel\\t%s\\n' \"$(__rwb_b64 \"$(uname -sr 2>/dev/null)\")\"",
    "  printf 'E\\tnproc\\t%s\\n' \"$(__rwb_b64 \"$(nproc 2>/dev/null)\")\"",
    "  printf 'E\\trustc\\t%s\\n' \"$(__rwb_b64 \"$(rustc --version 2>/dev/null)\")\"",
    "  printf 'E\\tcargo\\t%s\\n' \"$(__rwb_b64 \"$(cargo --version 2>/dev/null)\")\"",
    "  printf 'E\\tcwd\\t%s\\n' \"$(__rwb_b64 \"$(pwd)\")\"",
    // Prime a baseline build so the first measured phase is a true no-op.
    '  __rwb_set_main "Hello, world!"',
    '  cargo build > "$RWB_LOG" 2>&1 || true',
    // Phase 1 — `cargo run` with nothing changed (the reporter's 23.96s case).
    '  __rwb_phase noop-run "cargo run (no change)" cargo run',
    // Phase 2 — one-line edit then a REAL `cargo run` (the 6m04s headline).
    '  __rwb_set_main "Hello, edited world!"',
    '  __rwb_phase edit-run "cargo run (one-line edit)" cargo run',
    // Phase 3 — one-line edit then `cargo build`, isolating compile+link from
    // the run/exec step.
    '  __rwb_set_main "Hello, rebuilt world!"',
    '  __rwb_phase edit-build "cargo build (one-line edit)" cargo build',
    // Phase 4 — one-line edit then `cargo check` (the no-codegen comparison).
    '  __rwb_set_main "Hello, checked world!"',
    '  __rwb_phase edit-check "cargo check (one-line edit)" cargo check',
    ...(timePasses ? buildTimePassesBlock(bin) : []),
    // Leave the workspace exactly as shipped.
    '  __rwb_set_main "Hello, world!"',
    '} | {',
    "  printf '\\033]777;rust-web-box-bench;'",
    "  base64 | tr -d '\\n'",
    "  printf '\\007'",
    '}',
  ];
  return lines.join('\n') + '\n';
}

function buildTimePassesBlock(bin) {
  return [
    // Phase 5 — rustc front-end/codegen/link split. RUSTC_BOOTSTRAP=1 unlocks
    // the unstable -Z flag on stable rustc; the per-pass `time:` lines are
    // captured as T records so we can see exactly which phase dominates.
    '  __rwb_set_main "Hello, profiled world!"',
    '  : > "$RWB_LOG"',
    '  __rwb_s=$(__rwb_now)',
    `  RUSTC_BOOTSTRAP=1 cargo rustc --bin '${bin}' -- -Z time-passes > "$RWB_LOG" 2>&1`,
    '  __rwb_rc=$?',
    '  __rwb_e=$(__rwb_now)',
    '  __rwb_secs=$(__rwb_delta "$__rwb_s" "$__rwb_e")',
    "  printf 'P\\ttime-passes\\t%s\\t%s\\t1\\t%s\\t%s\\t%s\\n' \"$__rwb_secs\" \"$__rwb_rc\" \"$(__rwb_b64 'rustc -Z time-passes')\" \"$(__rwb_b64 'cargo rustc -- -Z time-passes')\" \"$(tail -c 400 \"$RWB_LOG\" 2>/dev/null | base64 | tr -d '\\n')\"",
    "  grep 'time:' \"$RWB_LOG\" 2>/dev/null | while IFS= read -r __rwb_line; do",
    "    __rwb_name=$(printf '%s' \"$__rwb_line\" | awk '{ print $NF }')",
    "    __rwb_val=$(printf '%s' \"$__rwb_line\" | sed -n 's/^[[:space:]]*time:[[:space:]]*\\([0-9.]*\\).*/\\1/p')",
    "    [ -n \"$__rwb_val\" ] && printf 'T\\t%s\\t%s\\n' \"$__rwb_name\" \"$__rwb_val\"",
    '  done',
  ];
}

/**
 * Streaming filter that strips `rust-web-box-bench` OSC frames out of the
 * terminal byte stream, handing each decoded payload to `onFrame`. Mirrors
 * createWorkspaceSyncFrameParser so it composes with it in the same onData
 * pipeline. Returns the visible text with bench frames removed.
 */
export function createCargoBenchFrameParser({ onFrame, logger = console } = {}) {
  return createOscFrameParser({
    prefix: CARGO_BENCH_OSC_PREFIX,
    end: CARGO_BENCH_OSC_END,
    onFrame,
    logger,
    label: 'cargo bench',
  });
}

/**
 * Decode a `rust-web-box-bench` payload into a structured result:
 *   { schema, env: {arch, rustc, ...}, phases: [...], passes: {...} }
 */
export function parseCargoBenchPayload(encodedPayload) {
  const text = TEXT_DECODER.decode(decodeBase64Bytes(encodedPayload));
  const lines = text.split('\n');
  if (lines.shift() !== 'RWB_BENCH_V1') {
    throw new Error('unsupported cargo bench payload');
  }
  const env = {};
  const phases = [];
  const passes = {};

  for (const line of lines) {
    if (!line) continue;
    const fields = line.split('\t');
    const kind = fields[0];
    if (kind === 'E') {
      const [, key, value] = fields;
      if (key) env[key] = decodeBase64Text(value ?? '');
    } else if (kind === 'P') {
      const [, id, secs, exit, compiled, label, cmd, tail] = fields;
      phases.push({
        id,
        seconds: decodeNumber(secs),
        exitCode: Number.parseInt(exit ?? '0', 10) || 0,
        compiled: compiled === '1',
        label: decodeBase64Text(label ?? ''),
        cmd: decodeBase64Text(cmd ?? ''),
        tail: tail ? decodeBase64Text(tail) : '',
      });
    } else if (kind === 'T') {
      const [, name, secs] = fields;
      if (name) passes[name] = decodeNumber(secs);
    }
  }

  return { schema: CARGO_BENCH_SCHEMA, env, phases, passes };
}

/**
 * Render a benchmark result as a compact, human-readable report (used for
 * console logging and the case study). `wallMs`, when present, is the
 * page-side wall-clock for the whole guest run, as an independent cross-check
 * against the sum of guest-measured phases.
 */
export function summarizeCargoBench(result, { wallMs } = {}) {
  if (!result) return 'cargo bench: no result';
  const out = [];
  out.push('cargo bench (real in-VM build) — issue #41');
  const env = result.env ?? {};
  out.push(
    `  vm: arch=${env.arch ?? '?'} nproc=${env.nproc ?? '?'} ` +
    `${env.rustc ?? 'rustc ?'} / ${env.cargo ?? 'cargo ?'}`,
  );
  if (env.kernel) out.push(`  kernel: ${env.kernel}`);
  for (const phase of result.phases ?? []) {
    const compiled = phase.id === 'time-passes'
      ? ''
      : phase.compiled ? ' [compiled]' : ' [fresh]';
    const rc = phase.exitCode ? ` (exit ${phase.exitCode})` : '';
    out.push(`  ${phase.label.padEnd(28)} ${formatSeconds(phase.seconds)}${compiled}${rc}`);
  }
  const passes = result.passes ?? {};
  const passNames = Object.keys(passes);
  if (passNames.length) {
    const total = passes.total;
    out.push('  rustc -Z time-passes:');
    for (const name of ['link_binary', 'codegen_crate', 'LLVM_passes', 'type_check_crate', 'total']) {
      if (passes[name] == null) continue;
      const pct = total ? ` (${Math.round((passes[name] / total) * 100)}%)` : '';
      out.push(`    ${name.padEnd(20)} ${passes[name].toFixed(3)}s${pct}`);
    }
  }
  if (Number.isFinite(wallMs)) {
    out.push(`  page-side wall-clock: ${(wallMs / 1000).toFixed(2)}s`);
  }
  return out.join('\n');
}

function formatSeconds(secs) {
  if (!Number.isFinite(secs)) return '?s';
  if (secs >= 60) {
    const m = Math.floor(secs / 60);
    const s = secs - m * 60;
    return `${m}m${s.toFixed(1).padStart(4, '0')}s (${secs.toFixed(1)}s)`;
  }
  return `${secs.toFixed(2)}s`;
}

// --- internal helpers -----------------------------------------------------

// Escape a value for safe interpolation inside a single-quoted shell string.
// Mirrors the helper of the same name in workspace-sync.js: every embedded
// single quote is closed, escaped, and reopened ('\'').
function shellQuote(value) {
  return String(value).replace(/'/g, "'\\''");
}

// Generic OSC-frame extractor, parameterised by prefix/end. Identical in
// spirit to createWorkspaceSyncFrameParser; kept self-contained here so the
// battle-tested sync parser stays untouched.
function createOscFrameParser({ prefix, end, onFrame, logger = console, label = 'osc' }) {
  let buffer = '';
  function filter(text) {
    buffer += String(text ?? '');
    let visible = '';
    while (buffer.length > 0) {
      const start = buffer.indexOf(prefix);
      if (start < 0) {
        const keep = longestPrefixSuffix(buffer, prefix);
        visible += buffer.slice(0, buffer.length - keep);
        buffer = buffer.slice(buffer.length - keep);
        break;
      }
      visible += buffer.slice(0, start);
      const payloadStart = start + prefix.length;
      const stop = buffer.indexOf(end, payloadStart);
      if (stop < 0) {
        buffer = buffer.slice(start);
        break;
      }
      const payload = buffer.slice(payloadStart, stop);
      try {
        onFrame?.(payload);
      } catch (err) {
        logger?.warn?.(`[rust-web-box] ${label} frame handler failed:`, err);
      }
      buffer = buffer.slice(stop + end.length);
    }
    return visible;
  }
  function flush() {
    const out = buffer;
    buffer = '';
    return out;
  }
  return { filter, flush };
}

function longestPrefixSuffix(text, prefix) {
  const max = Math.min(text.length, prefix.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.slice(-len) === prefix.slice(0, len)) return len;
  }
  return 0;
}

function decodeNumber(input) {
  const n = Number.parseFloat(input ?? '');
  return Number.isFinite(n) ? n : NaN;
}

function decodeBase64Text(input) {
  return TEXT_DECODER.decode(decodeBase64Bytes(input));
}

function decodeBase64Bytes(input = '') {
  if (typeof atob === 'function') {
    const raw = atob(input);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(input, 'base64'));
  }
  throw new Error('base64 decoder unavailable');
}
