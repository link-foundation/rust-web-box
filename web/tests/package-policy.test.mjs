import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('only rust-web-box is a public package', () => {
  const manifest = read('Cargo.toml');
  assert.match(manifest, /\[package\]\s+name = "rust-web-box"/);
  assert.match(manifest, /\[lib\]\s+name = "rust_web_box"/);
  assert.match(manifest, /\[\[bin\]\]\s+name = "rust-web-box"/);
  assert.match(manifest, /repository = "https:\/\/github.com\/link-foundation\/rust-web-box"/);
  for (const path of ['web/extensions/rust-analyzer-web', 'web/extensions/webvm-host', 'web/tests']) {
    assert.equal(JSON.parse(read(`${path}/package.json`)).private, true, path);
  }
});

test('both release paths use temporary OIDC credentials on main', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.doesNotMatch(workflow, /secrets\.CARGO_(?:REGISTRY_TOKEN|TOKEN)/);
  for (const job of ['auto-release', 'manual-release']) {
    const body = workflow.split(`\n  ${job}:\n`)[1].split(/\n  [a-z][a-z-]*:\n/)[0];
    assert.match(body, /github.ref == 'refs\/heads\/main'/);
    assert.match(body, /id-token: write/);
    assert.match(body, /uses: rust-lang\/crates-io-auth-action@/);
    assert.match(body, /CARGO_REGISTRY_TOKEN: \$\{\{ steps\.auth\.outputs\.token \}\}/);
    assert.ok(body.indexOf('id: auth') < body.indexOf('name: Collect changelog'));
    assert.ok(body.indexOf('id: auth') < body.indexOf('name: Publish to Crates.io'));
    assert.match(body, /if: failure\(\) && steps.auth.outcome == 'failure'/);
    assert.match(body, /docs\/ci-cd\/trusted-publishing.md/);
  }
});
