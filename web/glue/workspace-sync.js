// Guest-to-host workspace sync helpers.
//
// CheerpX gives the page two reliable communication channels:
//   * JavaScript -> guest: stage a script on /data and run it.
//   * guest -> JavaScript: bytes written to the configured console.
//
// The interactive bash profile emits a compact OSC frame after each
// prompt. The page strips that frame from terminal output, decodes the
// snapshot, and applies changed user files back into the JS-side
// workspace store that VS Code's FileSystemProvider serves.

export const WORKSPACE_SYNC_OSC_PREFIX = '\x1b]777;rust-web-box-sync;';
export const WORKSPACE_SYNC_OSC_END = '\x07';
export const DEFAULT_SYNC_MAX_FILE_BYTES = 262_144;

const WORKSPACE_ROOT = '/workspace';
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

export function buildGuestSyncProfileBlock({
  maxFileBytes = DEFAULT_SYNC_MAX_FILE_BYTES,
} = {}) {
  // Issue #27: PR #26 removed `-path /workspace/target -prune` so that the
  // Explorer would list the build directory. The unintended effect was
  // catastrophic: every prompt re-scanned ~10K target/ files (find + wc +
  // base64) and dragged a multi-MB OSC frame through the terminal, which
  // (a) produced visible terminal jank and made `cargo run` feel like it
  // wasn't reacting, and (b) introduced a sync race that overwrote
  // editor saves. The fix here keeps the directory visible by emitting a
  // SINGLE 'S' marker for /workspace/target itself, while pruning its
  // contents from the per-prompt scan.
  return [
    '# rust-web-box: mirror small terminal-side workspace edits back to VS Code.',
    `export RWB_SYNC_MAX_FILE_BYTES="\${RWB_SYNC_MAX_FILE_BYTES:-${maxFileBytes}}"`,
    '__rwb_sync_from_guest() {',
    '  [ "${RWB_SYNC_DISABLE:-0}" = "1" ] && return 0',
    '  [ -d /workspace ] || return 0',
    '  {',
    "    printf 'RWB_SYNC_V1\\n'",
    // Surface /workspace/target as a directory so VS Code's Explorer
    // shows it without forcing the prompt-time scan to descend into it.
    '    if [ -d /workspace/target ]; then',
    '      printf \'D\\t%s\\n\' "$(printf \'%s\' /workspace/target | base64 | tr -d \'\\n\')"',
    '    fi',
    '    find /workspace -path /workspace/.git -prune -o -path /workspace/target -prune -o -print 2>/dev/null | sort | while IFS= read -r path; do',
    '      [ "$path" = /workspace ] && continue',
    '      if [ -d "$path" ]; then',
    '        printf \'D\\t%s\\n\' "$(printf \'%s\' "$path" | base64 | tr -d \'\\n\')"',
    '      elif [ -f "$path" ]; then',
    '        size=$(wc -c < "$path" 2>/dev/null | tr -d \' \')',
    '        if [ "${size:-0}" -le "${RWB_SYNC_MAX_FILE_BYTES:-262144}" ] 2>/dev/null; then',
    '          printf \'F\\t%s\\t\' "$(printf \'%s\' "$path" | base64 | tr -d \'\\n\')"',
    '          base64 < "$path" | tr -d \'\\n\'',
    "          printf '\\n'",
    '        else',
    '          printf \'S\\t%s\\t%s\\n\' "$(printf \'%s\' "$path" | base64 | tr -d \'\\n\')" "${size:-0}"',
    '        fi',
    '      fi',
    '    done',
    '  } | {',
    "    printf '\\033]777;rust-web-box-sync;'",
    "    base64 | tr -d '\\n'",
    "    printf '\\007'",
    '  }',
    '}',
    'if [ -n "${PROMPT_COMMAND:-}" ]; then',
    '  case "${PROMPT_COMMAND}" in',
    '    *__rwb_sync_from_guest*) ;;',
    '    *) PROMPT_COMMAND="__rwb_sync_from_guest;${PROMPT_COMMAND}" ;;',
    '  esac',
    'else',
    '  PROMPT_COMMAND="__rwb_sync_from_guest"',
    'fi',
  ].join('\n') + '\n';
}

export function createWorkspaceSyncFrameParser({ onFrame, logger = console } = {}) {
  let buffer = '';

  function filter(text) {
    buffer += String(text ?? '');
    let visible = '';
    while (buffer.length > 0) {
      const start = buffer.indexOf(WORKSPACE_SYNC_OSC_PREFIX);
      if (start < 0) {
        const keep = longestPrefixSuffix(buffer, WORKSPACE_SYNC_OSC_PREFIX);
        visible += buffer.slice(0, buffer.length - keep);
        buffer = buffer.slice(buffer.length - keep);
        break;
      }

      visible += buffer.slice(0, start);
      const payloadStart = start + WORKSPACE_SYNC_OSC_PREFIX.length;
      const end = buffer.indexOf(WORKSPACE_SYNC_OSC_END, payloadStart);
      if (end < 0) {
        buffer = buffer.slice(start);
        break;
      }

      const payload = buffer.slice(payloadStart, end);
      try {
        onFrame?.(payload);
      } catch (err) {
        logger?.warn?.('[rust-web-box] workspace sync frame handler failed:', err);
      }
      buffer = buffer.slice(end + WORKSPACE_SYNC_OSC_END.length);
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

export function decodeWorkspaceSyncPayload(encodedPayload) {
  const text = TEXT_DECODER.decode(decodeBase64Bytes(encodedPayload));
  const lines = text.split('\n');
  if (lines.shift() !== 'RWB_SYNC_V1') {
    throw new Error('unsupported workspace sync payload');
  }
  const dirs = [];
  const files = [];
  const skippedFiles = [];
  const paths = new Set();

  for (const line of lines) {
    if (!line) continue;
    const [kind, encodedPath, encodedContent] = line.split('\t');
    const path = decodeBase64Text(encodedPath);
    if (!isWorkspacePath(path)) continue;
    if (kind === 'D') {
      dirs.push(path);
      paths.add(path);
    } else if (kind === 'F') {
      files.push({ path, bytes: decodeBase64Bytes(encodedContent ?? '') });
      paths.add(path);
    } else if (kind === 'S') {
      skippedFiles.push({ path, size: decodeSize(encodedContent) });
      paths.add(path);
    }
  }

  return { dirs, files, skippedFiles, paths };
}

export async function applyWorkspaceSyncSnapshot(workspace, snapshot, state = {}) {
  if (!workspace) throw new TypeError('applyWorkspaceSyncSnapshot requires a workspace');
  const knownPaths = state.knownPaths ?? new Set();
  const currentPaths = snapshot.paths ?? new Set([
    ...(snapshot.dirs ?? []),
    ...(snapshot.files ?? []).map((f) => f.path),
    ...(snapshot.skippedFiles ?? []).map((f) => f.path),
  ]);

  for (const dir of [...(snapshot.dirs ?? [])].sort((a, b) => a.length - b.length)) {
    await ensureDirectory(workspace, dir);
  }

  for (const file of snapshot.files ?? []) {
    if (!(await sameFile(workspace, file.path, file.bytes))) {
      await workspace.writeFile(file.path, file.bytes, {
        create: true,
        overwrite: true,
      });
    }
  }

  for (const file of snapshot.skippedFiles ?? []) {
    await ensureMetadataFile(workspace, file);
  }

  // Issue #27: target/ contents are intentionally pruned from the
  // prompt-time scan, so they appear "missing" relative to knownPaths
  // every cycle. Skipping them here prevents the deletion sweep from
  // wiping cached metadata stubs (and, critically, from being a noisy
  // no-op for thousands of paths).
  const deleted = [...knownPaths]
    .filter((path) => !currentPaths.has(path))
    .filter((path) => !isUnderTarget(path))
    .sort((a, b) => b.length - a.length);
  for (const path of deleted) {
    await deleteIfPresent(workspace, path);
  }

  state.knownPaths = new Set(currentPaths);
  return state;
}

function longestPrefixSuffix(text, prefix) {
  const max = Math.min(text.length, prefix.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.slice(-len) === prefix.slice(0, len)) return len;
  }
  return 0;
}

function isWorkspacePath(path) {
  return path === WORKSPACE_ROOT || path.startsWith(`${WORKSPACE_ROOT}/`);
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

function decodeSize(input) {
  const size = Number.parseInt(input ?? '0', 10);
  return Number.isFinite(size) && size >= 0 ? size : 0;
}

async function ensureDirectory(workspace, path) {
  try {
    await workspace.stat(path);
  } catch {
    await workspace.createDirectory(path);
  }
}

async function sameFile(workspace, path, bytes) {
  try {
    const got = await workspace.readFile(path);
    return bytesEqual(got, bytes);
  } catch {
    return false;
  }
}

async function ensureMetadataFile(workspace, file) {
  if (typeof workspace.writeMetadataFile !== 'function') return;
  try {
    await workspace.stat(file.path);
    if (isTargetPath(file.path)) {
      await workspace.writeMetadataFile(file.path, { size: file.size ?? 0 });
    }
    return;
  } catch (err) {
    if (err?.code !== 'FileNotFound') throw err;
  }
  await workspace.writeMetadataFile(file.path, { size: file.size ?? 0 });
}

function isTargetPath(path) {
  return path.startsWith(`${WORKSPACE_ROOT}/target/`);
}

function isUnderTarget(path) {
  return path === `${WORKSPACE_ROOT}/target` || isTargetPath(path);
}

async function deleteIfPresent(workspace, path) {
  try {
    await workspace.delete(path, { recursive: true });
  } catch (err) {
    if (err?.code !== 'FileNotFound') throw err;
  }
}

function bytesEqual(a, b) {
  if (a?.byteLength !== b?.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
