// Terminal output normalisation.
//
// Bash inside CheerpX writes via `cx.setCustomConsole`, which is not a
// kernel TTY: there is no ONLCR mapping, so each newline reaches us as a
// bare `\n`. VS Code's Pseudoterminal (and xterm.js underneath it) needs
// CRLF — without `\r` the cursor only moves down, not back to column 0,
// producing the staircase artefact visible in PR #2 boot screenshots.
//
// `createLfToCrlfNormaliser()` returns a stateful function that converts
// every lone `\n` to `\r\n` while leaving existing `\r\n` and bare `\r`
// untouched. State is needed because a chunk boundary can fall between
// `\r` and `\n`; without remembering the trailing `\r` we would emit
// `\r\r\n` and double-space the line.

export function createLfToCrlfNormaliser() {
  let lastWasCr = false;
  return function normalise(chunk) {
    if (typeof chunk !== 'string' || chunk.length === 0) return chunk;
    let out = '';
    let i = 0;
    if (lastWasCr && chunk.charCodeAt(0) === 0x0a /* \n */) {
      out += '\n';
      i = 1;
    }
    for (; i < chunk.length; i++) {
      const c = chunk.charCodeAt(i);
      if (c === 0x0a /* \n */) {
        const prev = i > 0 ? chunk.charCodeAt(i - 1) : -1;
        out += prev === 0x0d ? '\n' : '\r\n';
      } else {
        out += chunk[i];
      }
    }
    lastWasCr = chunk.charCodeAt(chunk.length - 1) === 0x0d;
    return out;
  };
}

// One-shot convenience for callers that don't span chunks (e.g. tests).
export function lfToCrlf(text) {
  return createLfToCrlfNormaliser()(text);
}
