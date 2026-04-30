// Workspace-only methods table.
//
// Returns the bus method table that serves `fs.*` and `vm.status`
// requests against the JS-side workspace store before CheerpX has
// finished booting. Once the VM is ready, `boot.js` swaps these out
// for the full webvm-server methods (which add terminal/process
// support).
//
// Why two stages: VS Code's Explorer asks for `fs.stat('/workspace')`
// the moment the FileSystemProvider registers. If we wait for CheerpX
// (30+ seconds), the Explorer shows a loading spinner and the
// workspace looks empty — exactly the screenshot complaint on PR #2.
// Serving the JS-side workspace immediately makes src/main.rs
// visible in <1 s.

export function workspaceOnlyMethods({ workspace } = {}) {
  if (!workspace) throw new TypeError('workspaceOnlyMethods requires a workspace');
  return {
    'vm.status': async () => ({ booted: false, stage: 'workspace-only' }),
    'fs.stat': async ({ path }) => await workspace.stat(path),
    'fs.readDir': async ({ path }) => await workspace.readDirectory(path),
    'fs.readFile': async ({ path }) => await workspace.readFile(path),
    'fs.writeFile': async ({ path, data, options }) => {
      const buf = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
      await workspace.writeFile(path, buf, options);
    },
    'fs.delete': async ({ path, recursive }) => {
      await workspace.delete(path, { recursive });
    },
    'fs.rename': async ({ from, to }) => {
      await workspace.rename(from, to);
    },
    'fs.createDirectory': async ({ path }) => {
      await workspace.createDirectory(path);
    },
    // Process methods aren't available yet — the VM hasn't booted.
    // Surface a structured error so the extension renders "VM is
    // booting" rather than crashing.
    'proc.spawn': async () => {
      const err = new Error('VM is still booting');
      err.code = 'VM_BOOTING';
      throw err;
    },
    'proc.write': async () => {
      const err = new Error('VM is still booting');
      err.code = 'VM_BOOTING';
      throw err;
    },
    'proc.resize': async () => {
      // No-op pre-boot.
    },
    'proc.kill': async () => {
      // No-op.
    },
    'proc.wait': async () => {
      const err = new Error('VM is still booting');
      err.code = 'VM_BOOTING';
      throw err;
    },
    'workspace.prime': async () => {
      // Nothing to mirror yet; the VM doesn't exist.
    },
  };
}
