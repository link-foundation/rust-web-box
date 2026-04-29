# Root cause #2 — `.vscode/{settings,tasks,launch}.json` ENOENT noise

> **Severity**: P3 — non-fatal, but obscures real signal.
> **Symptom**: 12–18 red `ENOENT` lines in the console on first load.
> **Distinct console signal**:
> `F: Unable to read file 'webvm:/workspace/.vscode/settings.json' (BusError: ENOENT: /workspace/.vscode/settings.json)`
> ([`evidence/console-first-load.log:20-30, 36-50, 57-80`](./evidence/console-first-load.log))

## What VS Code probes on workspace open

When a workspace folder is registered, VS Code Web's
`@vscode/extension-host` synchronously reads three configuration files:

| File                              | Consumed by                             | Effect when missing                  |
| --------------------------------- | --------------------------------------- | ------------------------------------ |
| `.vscode/settings.json`           | `ConfigurationService` (workspace)      | Falls back to user/default settings. |
| `.vscode/tasks.json`              | `TaskConfigurationContribution`         | "No tasks defined for this folder."  |
| `.vscode/launch.json`             | `DebugConfigurationContribution`        | "No launch configurations defined."  |

Each probe goes through `IFileService.readFile`, which calls into our
`FileSystemProvider`. Our provider correctly throws `FileNotFound`/`ENOENT`,
which VS Code logs at error level even though it then falls back to defaults.
The probes happen at least 6× across initial layout + reconciliation, which
is why we see 12–18 lines per page load.

## Why we missed this in PR #2

PR #2's smoke screenshots were taken on a freshly-loaded workspace where
the user typed `cargo run` immediately. The console output was already
populated by the time anyone scrolled up. The boot-shell test
(`web/tests/boot-shell.test.mjs`) only asserts file presence in the rendered
HTML — it never inspects runtime console output.

## Two ways to fix

| Approach                                                                   | Pros                                              | Cons                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------- |
| **A. Seed `.vscode/*.json` in `SEED_FILES`** (chosen)                      | One change, no per-FS-call logic. Users can edit. | Three small extra files in the IDB store.        |
| **B. Catch ENOENT inside the FileSystemProvider, return empty buffer**     | Zero seeds.                                       | Diverges from POSIX; breaks "did the file exist?" semantics for user code. |
| **C. Filter the workbench logger.**                                        | Zero changes to data layer.                       | Workbench is vendored; patching its logger is brittle and hides real errors. |

Option A is the cleanest. The seed files are minimal but useful (`tasks.json`
includes a `cargo run` task; `settings.json` disables format-on-save which
otherwise corrupts Rust files in our stub server). A user who deletes
them never has them re-seeded — `SEED_FILES` only runs on first open
(empty store), per `workspace-fs.js:174-188`.

## Fix (applied)

In `web/glue/workspace-fs.js`, the `SEED_FILES` map gains three entries:

```js
'/workspace/.vscode/settings.json': '{ … }',
'/workspace/.vscode/tasks.json':    '{ "version": "2.0.0", "tasks": [ … ] }',
'/workspace/.vscode/launch.json':   '{ "version": "0.2.0", "configurations": [] }',
```

`workspace-fs.js`'s seed loop (`for (const [path, content] of Object.entries(seed))`)
already calls `collectDirs(path)` to ensure parent `/workspace/.vscode/`
exists before the file goes in.

## Test

`web/tests/workspace-fs.test.mjs` gains:

```js
test('workspace-fs: seed includes .vscode/{settings,tasks,launch}.json (issue #5)', () => {
  for (const name of ['settings.json', 'tasks.json', 'launch.json']) {
    const p = `/workspace/.vscode/${name}`;
    assert.ok(DEFAULT_SEED[p]);
    // Each must be parseable JSON (with comments stripped for settings).
    assert.doesNotThrow(() => JSON.parse(DEFAULT_SEED[p].replace(/\/\/.*$/gm, '')));
  }
});
```

So a future cleanup that re-orders or trims the seed map can't accidentally
re-introduce the noise.
