// On-demand in-VM cargo benchmark driver (issue #41).
//
// This is NOT a `node --test` file — it is a runnable measurement tool that
// boots the real workbench in a headless Chromium, lets CheerpX boot the
// i386 Alpine guest, and runs the user's ACTUAL `cargo run` / `cargo build`
// / `cargo check` inside that guest via the `vm.benchCargo` bus method. It
// then prints a Markdown report (and appends it to $GITHUB_STEP_SUMMARY when
// running in CI).
//
// Why a separate driver instead of the e2e suite:
//   - The benchmark is minutes long by design (it is timing the slow build),
//     far past the e2e suite's per-bus-request 60s budget. We use our own
//     long-timeout bus request here.
//   - It produces DATA, not pass/fail assertions. A 6-minute rebuild is the
//     finding, not a failure. We only exit non-zero when the VM genuinely
//     fails to boot or every requested config errors.
//   - konard asked (PR #42) to keep all benchmarks runnable on demand via
//     CI manual dispatch "to reduce load on your machine" — this is the
//     payload `.github/workflows/perf-bench.yml` dispatches.
//
// It also runs a READ-ONLY storage + CPU probe (`mount`, `df`, `nproc`,
// `/proc/cpuinfo`, `/dev/shm`, `/proc/meminfo`) so the case study's IO and
// multithreading sections (issue #41 Parts 1 & 2) are grounded in what the
// live guest actually reports, not assumptions.
//
// Usage:
//   node web/tests/bench/run-in-vm-bench.mjs \
//     [--configs shipped,incremental,jobs1,jobs4] \
//     [--no-time-passes] [--out report.md] [--timeout-ms 1800000]
//
// Prereqs (same as the e2e suite): vendored CheerpX + a staged warm
// rust-alpine disk under web/disk/. CI stages those before invoking this.

import { existsSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import path from 'node:path';

import {
  E2E_REQUIRED,
  WEB_ROOT,
  REPO_ROOT,
  DEFAULT_BOOT_TIMEOUT_MS,
  isWarmDiskStaged,
  runInVM,
  startDevServer,
  tryLoadBrowserCommander,
  waitForLinux,
  withWorkbench,
} from '../helpers/cheerpx-page-harness.mjs';
import { summarizeCargoBench } from '../../glue/cargo-bench.js';

const BASE_PREFIX = '/rust-web-box';

// Build-env presets. The headline `shipped` config mirrors exactly what the
// disk image sets today (issues #17/#31 workarounds); the others probe the
// two questions konard raised — does cargo job parallelism help on the
// single-core guest, and does re-enabling incremental help or trip the
// CheerpX 1.3.x OverlayDevice 'a1' wedge in-VM?
const SHIPPED = ['CARGO_INCREMENTAL=0', 'CARGO_PROFILE_DEV_DEBUG=0', 'CARGO_PROFILE_DEV_CODEGEN_UNITS=1'];
const BENCH_CONFIGS = {
  shipped: {
    label: 'shipped lean profile (incremental=0, debug=0, codegen-units=1)',
    env: [...SHIPPED],
  },
  incremental: {
    label: 'incremental ON (probes the a1 wedge in-VM)',
    env: ['CARGO_INCREMENTAL=1', 'CARGO_PROFILE_DEV_DEBUG=0', 'CARGO_PROFILE_DEV_CODEGEN_UNITS=1'],
  },
  jobs1: {
    label: 'shipped + single cargo job (-j1)',
    env: [...SHIPPED, 'CARGO_BUILD_JOBS=1'],
  },
  jobs4: {
    label: 'shipped + four cargo jobs (-j4)',
    env: [...SHIPPED, 'CARGO_BUILD_JOBS=4'],
  },
};

// Read-only guest probe. Answers issue #41 Part 1 (is there any RAM-backed /
// tmpfs mount we could redirect target/ onto?) and Part 2 (how many cores
// does the guest actually expose?). Nothing here allocates an inode, so it
// cannot trip the OverlayDevice wedge.
const STORAGE_CPU_PROBE = [
  'echo "### nproc"; nproc 2>&1',
  'echo; echo "### /proc/cpuinfo"; cat /proc/cpuinfo 2>&1',
  'echo; echo "### mount"; mount 2>&1',
  'echo; echo "### df -h"; df -h 2>&1',
  'echo; echo "### df -h /workspace"; df -h /workspace 2>&1',
  'echo; echo "### tmpfs / shm mounts"; (mount 2>&1 | grep -Ei "tmpfs|shm|ramfs" || echo "(no tmpfs/shm/ramfs mount)")',
  'echo; echo "### /dev/shm"; ls -la /dev/shm 2>&1 | head -20',
  'echo; echo "### /tmp"; ls -la /tmp 2>&1 | head -20',
  'echo; echo "### /proc/meminfo (head)"; head -5 /proc/meminfo 2>&1',
  'echo; echo "### free"; (free 2>&1 || echo "(no free)")',
].join('\n');

function parseArgs(argv) {
  const out = {
    configs: ['shipped'],
    timePasses: true,
    outPath: null,
    timeoutMs: 1_800_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--configs') {
      out.configs = String(argv[++i] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith('--configs=')) {
      out.configs = arg.slice('--configs='.length).split(',').map((s) => s.trim()).filter(Boolean);
    } else if (arg === '--no-time-passes') {
      out.timePasses = false;
    } else if (arg === '--out') {
      out.outPath = argv[++i];
    } else if (arg.startsWith('--out=')) {
      out.outPath = arg.slice('--out='.length);
    } else if (arg === '--timeout-ms') {
      out.timeoutMs = Number.parseInt(argv[++i], 10);
    } else if (arg.startsWith('--timeout-ms=')) {
      out.timeoutMs = Number.parseInt(arg.slice('--timeout-ms='.length), 10);
    }
  }
  // Validate config names up front so a typo fails loudly instead of
  // silently measuring nothing.
  const unknown = out.configs.filter((c) => !BENCH_CONFIGS[c]);
  if (unknown.length) {
    throw new Error(
      `unknown bench config(s): ${unknown.join(', ')}. ` +
      `known: ${Object.keys(BENCH_CONFIGS).join(', ')}`,
    );
  }
  if (!out.configs.length) out.configs = ['shipped'];
  return out;
}

// Long-timeout sibling of the e2e suite's requestWorkbenchBus. The bench can
// run for many minutes, so the in-page request waits `timeoutMs + margin`
// and the server is told the same budget via params.timeoutMs.
async function requestBenchLong(page, params, timeoutMs) {
  return await page.evaluate(async ({ params, timeoutMs }) => {
    const channel = new BroadcastChannel('rust-web-box/webvm-bus');
    const id = Math.floor(Math.random() * 1_000_000_000);
    try {
      return await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`vm.benchCargo bus request timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
        channel.addEventListener('message', (ev) => {
          const msg = ev.data;
          if (!msg || msg.kind !== 'response' || msg.id !== id) return;
          clearTimeout(timer);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        });
        channel.postMessage({ id, kind: 'request', method: 'vm.benchCargo', params });
      });
    } finally {
      channel.close();
    }
  }, { params, timeoutMs: timeoutMs + 60_000 });
}

// Subscribe to the live proc.stdout byte stream the terminal renders, so we
// can keep a tail of the REAL guest output as anti-fake evidence alongside
// the structured timings.
async function startStdoutCapture(page) {
  await page.evaluate(() => {
    globalThis.__rwbBenchStdout = '';
    const ch = new BroadcastChannel('rust-web-box/webvm-bus');
    ch.addEventListener('message', (ev) => {
      const m = ev.data;
      if (m && m.kind === 'event' && m.topic === 'proc.stdout' && m.payload && typeof m.payload.chunk === 'string') {
        globalThis.__rwbBenchStdout += m.payload.chunk;
        // Keep memory bounded — we only want a tail.
        if (globalThis.__rwbBenchStdout.length > 200_000) {
          globalThis.__rwbBenchStdout = globalThis.__rwbBenchStdout.slice(-100_000);
        }
      }
    });
    globalThis.__rwbBenchStdoutChannel = ch;
  });
}

async function readStdoutTail(page, maxChars = 4000) {
  return await page.evaluate((maxChars) => {
    const s = globalThis.__rwbBenchStdout || '';
    return s.length > maxChars ? s.slice(-maxChars) : s;
  }, maxChars);
}

const fence = (body, lang = '') => `\`\`\`${lang}\n${String(body).replace(/```/g, '`​``')}\n\`\`\``;

function renderProbe(probe) {
  const lines = [];
  lines.push('## Guest storage + CPU probe (read-only)');
  lines.push('');
  lines.push('Answers issue #41 Part 1 (RAM/tmpfs-backed mount for `target/`?) and');
  lines.push('Part 2 (cores the CheerpX guest actually exposes). Captured live from');
  lines.push('the booted VM — no inode is allocated, so it cannot trip the a1 wedge.');
  lines.push('');
  if (probe.timedOut) {
    lines.push('> ⚠️ probe timed out — VM may be wedged.');
  }
  lines.push(fence(probe.output?.trim() || '(no output)'));
  lines.push('');
  return lines.join('\n');
}

function editRunSeconds(result) {
  const p = (result?.phases || []).find((x) => x.id === 'edit-run');
  return p ? p.seconds : null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  const commander = await tryLoadBrowserCommander();
  if (!commander) {
    const msg = 'browser-commander / playwright not installed';
    if (E2E_REQUIRED) throw new Error(msg + ' (RUST_WEB_BOX_E2E=1 requires it)');
    console.warn(`[in-vm-bench] ${msg}; skipping (set RUST_WEB_BOX_E2E=1 to fail hard)`);
    return;
  }
  if (!existsSync(path.join(WEB_ROOT, 'cheerpx', 'cx.esm.js'))) {
    const msg = 'web/cheerpx/cx.esm.js missing — run node web/build/build-workbench.mjs first';
    if (E2E_REQUIRED) throw new Error(msg);
    console.warn(`[in-vm-bench] ${msg}; skipping`);
    return;
  }
  if (!isWarmDiskStaged()) {
    const msg = 'warm rust-alpine disk not staged under web/disk/ — run web/build/stage-pages-disk.mjs first';
    if (E2E_REQUIRED) throw new Error(msg);
    console.warn(`[in-vm-bench] ${msg}; skipping`);
    return;
  }

  const bootTimeoutMs = DEFAULT_BOOT_TIMEOUT_MS;
  const server = await startDevServer({ basePrefix: BASE_PREFIX });

  const sections = [];
  const tableRows = [];
  let probeRendered = null;
  let okCount = 0;

  try {
    // One fresh browser session per config. A wedge (e.g. the incremental
    // leg tripping the a1 bug) poisons the CheerpX runtime for the rest of
    // that session, so isolating each config keeps a single failure from
    // contaminating the others' numbers.
    for (let i = 0; i < args.configs.length; i += 1) {
      const name = args.configs[i];
      const preset = BENCH_CONFIGS[name];
      const isFirst = i === 0;
      console.log(`[in-vm-bench] config ${i + 1}/${args.configs.length}: ${name} — booting VM…`);
      try {
        // eslint-disable-next-line no-await-in-loop
        await withWorkbench(server.url, async ({ page, errors, diagnostics }) => {
          const vmPhase = await waitForLinux(page, { diagnostics: { ...diagnostics, errors }, timeoutMs: bootTimeoutMs });
          if (vmPhase !== 'ready') throw new Error(`VM did not reach ready (got ${vmPhase})`);

          if (isFirst) {
            console.log('[in-vm-bench] running read-only storage + CPU probe…');
            const probe = await runInVM(page, STORAGE_CPU_PROBE, { timeoutMs: 60_000 });
            probeRendered = renderProbe(probe);
          }

          await startStdoutCapture(page);
          console.log(`[in-vm-bench] running vm.benchCargo (${name})… this is minutes-scale by design.`);
          const result = await requestBenchLong(
            page,
            { env: preset.env, timePasses: args.timePasses, timeoutMs: args.timeoutMs },
            args.timeoutMs,
          );
          const stdoutTail = await readStdoutTail(page);

          const section = [];
          section.push(`## Config: \`${name}\``);
          section.push('');
          section.push(`**${preset.label}**`);
          section.push('');
          section.push('`env`: ' + preset.env.map((e) => `\`${e}\``).join(', '));
          section.push('');
          section.push(fence(summarizeCargoBench(result, { wallMs: result.wallMs })));
          section.push('');
          section.push('<details><summary>live terminal stdout tail (anti-fake proof)</summary>');
          section.push('');
          section.push(fence(stdoutTail.trim() || '(no stdout captured)'));
          section.push('');
          section.push('</details>');
          section.push('');
          sections.push(section.join('\n'));

          const editRun = editRunSeconds(result);
          tableRows.push(
            `| \`${name}\` | ${result.env?.nproc ?? '?'} | ` +
            `${editRun != null ? editRun.toFixed(1) + 's' : 'n/a'} | ` +
            `${(result.wallMs / 1000).toFixed(1)}s | ok |`,
          );
          okCount += 1;
          console.log(`[in-vm-bench] ${name}: edit-run=${editRun != null ? editRun.toFixed(1) + 's' : 'n/a'} wall=${(result.wallMs / 1000).toFixed(1)}s`);
        }, { commander, bootTimeoutMs });
      } catch (err) {
        const message = err?.message ?? String(err);
        console.error(`[in-vm-bench] config ${name} failed: ${message}`);
        sections.push([
          `## Config: \`${name}\``,
          '',
          `**${preset.label}**`,
          '',
          `> ❌ failed: ${message.split('\n')[0]}`,
          '',
          fence(message),
          '',
        ].join('\n'));
        tableRows.push(`| \`${name}\` | ? | n/a | n/a | failed |`);
      }
    }
  } finally {
    await server.stop();
  }

  const elapsedS = ((Date.now() - startedAt) / 1000).toFixed(0);
  const doc = [];
  doc.push('# Issue #41 — in-VM cargo benchmark (real CheerpX guest)');
  doc.push('');
  doc.push(`Driver: \`web/tests/bench/run-in-vm-bench.mjs\` · total wall-clock ${elapsedS}s · ` +
    `configs: ${args.configs.join(', ')} · time-passes: ${args.timePasses}`);
  doc.push('');
  doc.push('These numbers are the user\'s **actual** `cargo run`/`build`/`check` run');
  doc.push('inside the in-browser VM (not a native proxy). The `noop-run` phase is the');
  doc.push('cached fast-path; **`edit-run` is the one-line-edit rebuild the issue is about**.');
  doc.push('');
  if (tableRows.length) {
    doc.push('| config | guest nproc | edit-run | wall-clock | status |');
    doc.push('|--------|-------------|----------|-----------|--------|');
    doc.push(...tableRows);
    doc.push('');
  }
  if (probeRendered) doc.push(probeRendered);
  doc.push(...sections);
  const report = doc.join('\n');

  // Always print to stdout.
  console.log('\n' + report + '\n');

  // Persist to --out (default under docs/case-studies/issue-41/data/).
  const outPath = args.outPath
    ? path.resolve(args.outPath)
    : path.join(REPO_ROOT, 'docs', 'case-studies', 'issue-41', 'data', 'in-vm-bench-latest.md');
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, report + '\n', 'utf8');
  console.log(`[in-vm-bench] wrote ${outPath}`);

  // Append to the GitHub Actions job summary when present.
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + '\n');
    } catch (err) {
      console.warn('[in-vm-bench] could not append to GITHUB_STEP_SUMMARY:', err?.message ?? err);
    }
  }

  if (okCount === 0) {
    throw new Error('every requested in-VM bench config failed — see report above');
  }
}

main().catch((err) => {
  console.error('[in-vm-bench] fatal:', err?.stack ?? err);
  process.exitCode = 1;
});
