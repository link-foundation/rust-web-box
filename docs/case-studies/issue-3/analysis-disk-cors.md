# Root cause #2 — Warm Alpine+Rust disk fails under CORS

## Symptom

CheerpX falls back to the public Debian image
(`wss://disks.webvm.io/debian_large_20230522_5044875331_2.ext2`) instead
of using our pre‑baked Alpine + Rust image. Users never see the
pre‑installed `cargo` and `rustc`; running `cargo run` requires
`apk add rust cargo` first, which itself needs Tailscale.

## Direct evidence

`evidence/console-first-load.log:2588 ms`:

```
Access to XMLHttpRequest at
'https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2'
from origin 'https://link-foundation.github.io' has been blocked by CORS policy:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

The release asset itself responds correctly to anonymous requests:

```sh
$ curl -sI -L https://github.com/link-foundation/rust-web-box/releases/download/disk-latest/rust-alpine.ext2 | head -20
HTTP/2 302
location: https://release-assets.githubusercontent.com/.../rust-alpine.ext2
HTTP/2 200
content-type: application/octet-stream
content-length: 121634816
# (no Access-Control-Allow-Origin header)
```

So the *file* is reachable, but the *browser* refuses to expose it to JS
because the upstream
`release-assets.githubusercontent.com` does not advertise CORS.

## Why our probe accepted it anyway

`web/glue/cheerpx-bridge.js:78–103` (`probeUrl`) uses
`fetch(url, { mode: 'no-cors' })`. With `no-cors`, the browser will
return an *opaque* response and not raise a CORS error — but the response
body is unreadable. The probe treats `res.type === 'opaque'` as success
and resolves the URL, then hands it to `CheerpX.CloudDevice.create()`
which reads the actual bytes with **XMLHttpRequest**. XHR has no `no-cors`
mode; it always exposes the body to JS, so the browser must enforce
CORS — and it fails.

In short: **`no-cors` is the wrong test**. It tells us "the URL is
fetchable" but not "the URL is usable as a JS‑readable resource".

## Why the fallback masks the bug

`bootLinux()` in `cheerpx-bridge.js:153–212` catches `CloudDevice.create`
errors and silently falls back to `FALLBACK_DISK_URL`. The fallback works
(Debian disk over `wss://`, no CORS), so the page boots — just without
Rust. That's why the issue presents as "no terminal, no files" rather than
"loading failed".

## Fix options

### Option 1 — Probe with a HEAD that reads CORS headers (lightweight)

Replace the opaque probe with a real `cors` HEAD that inspects
`Access-Control-Allow-Origin`. If absent or wrong, treat the URL as
unusable and fall back to the same‑origin manifest mirror immediately
(no need to wait for `CloudDevice.create` to fail).

```js
async function probeUrl(url, fetchImpl) {
  try {
    const res = await fetchImpl(url, {
      method: 'HEAD',
      mode: 'cors',
      redirect: 'follow',
    });
    if (!res.ok) return false;
    const aco = res.headers.get('access-control-allow-origin');
    return aco === '*' || aco === self.location.origin;
  } catch {
    return false;
  }
}
```

Trade‑off: the GitHub Releases redirect to
`release-assets.githubusercontent.com` does not allow HEAD; we'd need to
fall back to a `GET` with `Range: bytes=0-0`. Still, the principle holds
— inspect the headers, not the response type.

### Option 2 — Mirror the disk image on the same origin

Pages serves all assets with `access-control-allow-origin: *` (verified
by `curl`). If we copy `rust-alpine.ext2` into `web/disk/` and let the
disk‑image workflow upload it as a Pages artifact, the browser will treat
it as same‑origin and skip CORS entirely.

Trade‑off: Pages has a soft 1 GB site limit and a 100 MB per‑file limit
for the underlying Git LFS, both of which the 120 MB ext2 brushes against.
We'd need to ship a smaller image (drop crate cache, ship only `cargo`
+ `rustc`) or split into chunks fetched lazily by the engine.

### Option 3 — Cloudflare Worker proxy with CORS

A 30‑line Worker that proxies requests to
`github.com/.../rust-alpine.ext2` and adds `Access-Control-Allow-Origin: *`
+ `Cross-Origin-Resource-Policy: cross-origin`. Free tier covers our
expected traffic.

Trade‑off: introduces an external dependency outside the GitHub org. Goes
against the issue's "fully anonymous, zero-signup, zero-backend" goal in
spirit, though Cloudflare Workers don't require the user to sign up for
anything.

### Recommended

**For PR #4**: Option 1 (improve the probe so we surface a clear
diagnostic and fall back gracefully). This is a one‑file, one‑function
change and ships *now*.

**Follow‑up**: Option 2 with a stripped‑down Alpine image. Filed as a
separate issue.

## Verification

`web/tests/disk-cors.test.mjs` (new):

* Mocks `fetch` to return a response with no `Access-Control-Allow-Origin`
  header. Asserts `probeUrl` returns `false`.
* Mocks `fetch` to return a response with `Access-Control-Allow-Origin: *`.
  Asserts `probeUrl` returns `true`.
* Asserts that `bootLinux` falls back to `FALLBACK_DISK_URL` and logs a
  structured warning (not just a generic console.warn) when the warm URL
  probe fails.

## Upstream reports

* `leaningtech/cheerpx`: feature request to surface the underlying XHR
  failure (status, response headers, error string) when
  `CloudDevice.create()` fails. Currently we only see `null` or a
  generic Promise rejection.
* `leaningtech/webvm`: documentation note about CORS requirements for
  custom disks; this trips up everyone who hosts disks outside of
  `disks.webvm.io`.
