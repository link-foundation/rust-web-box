import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createLfToCrlfNormaliser,
  lfToCrlf,
} from '../glue/terminal-stream.js';

test('lfToCrlf: converts lone LF to CRLF', () => {
  assert.equal(lfToCrlf('a\nb\nc'), 'a\r\nb\r\nc');
});

test('lfToCrlf: preserves existing CRLF', () => {
  assert.equal(lfToCrlf('a\r\nb\r\n'), 'a\r\nb\r\n');
});

test('lfToCrlf: leaves bare CR alone', () => {
  assert.equal(lfToCrlf('progress: 42%\r'), 'progress: 42%\r');
});

test('lfToCrlf: matches the staircase repro from the screenshot', () => {
  // What `ls -la /workspace` writes when bash has no PTY: bare LF
  // between lines. Without normalisation, xterm.js leaves the cursor at
  // the end of the previous line, indenting every subsequent line.
  const raw =
    'total 0\n' +
    '-rw-r--r-- 1 root root  114 Apr 30 06:17 Cargo.toml\n' +
    '-rw-r--r-- 1 root root  387 Apr 28 22:47 README.md\n' +
    'drwxr-xr-x 2 root root 4096 Apr 30 06:17 src\n';
  const out = lfToCrlf(raw);
  // Every newline must be CRLF after normalisation.
  assert.match(out, /total 0\r\n/);
  assert.match(out, /Cargo\.toml\r\n/);
  assert.match(out, /README\.md\r\n/);
  assert.match(out, /src\r\n/);
  // No lone LF left anywhere.
  assert.equal(/[^\r]\n/.test(out), false);
});

test('normaliser: stateful across chunks split mid-CRLF', () => {
  const norm = createLfToCrlfNormaliser();
  // Real-world split: CheerpX delivers `foo\r` in one chunk, `\nbar` in
  // the next. We must NOT emit `\r\r\n` for the boundary newline.
  const a = norm('foo\r');
  const b = norm('\nbar\n');
  assert.equal(a + b, 'foo\r\nbar\r\n');
});

test('normaliser: independent instances do not share state', () => {
  const a = createLfToCrlfNormaliser();
  const b = createLfToCrlfNormaliser();
  // Feed `\r` only into `a`; `b` must still convert a leading `\n` to CRLF.
  a('foo\r');
  assert.equal(b('\nbar'), '\r\nbar');
});

test('normaliser: empty / non-string input is passed through', () => {
  const norm = createLfToCrlfNormaliser();
  assert.equal(norm(''), '');
  assert.equal(norm(undefined), undefined);
  assert.equal(norm(null), null);
});

test('normaliser: handles ANSI control sequences without mangling them', () => {
  // `clear` emits ESC[H ESC[2J then bash writes a prompt. The sequence
  // contains no LF; we must leave it byte-for-byte intact.
  const norm = createLfToCrlfNormaliser();
  const seq = '\x1b[H\x1b[2Jroot@:/workspace# ';
  assert.equal(norm(seq), seq);
});
