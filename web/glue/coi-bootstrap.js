// Cross-origin isolation bootstrap for rust-web-box.
//
// Purpose: ensure `self.crossOriginIsolated === true` so CheerpX (and
// any other page-side WASM-threading code) can use `SharedArrayBuffer`
// and posted SAB transfers between the page and Web Workers.
//
// Why this is non-trivial on GitHub Pages:
//   • Cross-origin isolation requires the *top-level navigation*
//     response to carry `Cross-Origin-Opener-Policy: same-origin` plus
//     `Cross-Origin-Embedder-Policy: require-corp` or `credentialless`.
//   • GitHub Pages does not let us set custom response headers
//     (https://github.com/orgs/community/discussions/categories/pages),
//     so the document is served without those headers.
//   • Our service worker (`./sw.js`) synthesizes the headers on its
//     `fetch` listener — but the *very first* navigation is fetched
//     before any SW is registered, so the document itself never gets
//     the headers, and isolation latches off for the page lifetime.
//   • Subsequent reloads, with the SW active and in scope, do get the
//     synthesized headers and isolation latches on.
//
// The fix used by webcontainers.io, jsfiddle, observable, and the
// upstream `coi-serviceworker` (https://github.com/gzuidhof/coi-serviceworker)
// is the same one we implement here:
//
//   1. As early as possible (before the workbench AMD loader runs),
//      register `./sw.js` and force a single `location.reload()` once
//      the SW takes control of the page. After the reload, the SW
//      intercepts the navigation request and sets COOP/COEP on it.
//   2. Skip the reload entirely when the page is already isolated,
//      when SW registration is unavailable (private mode, file://),
//      or when the user has opted out via `?coi=0`.
//   3. Self-disarm if the reload still doesn't produce isolation
//      (e.g. browser blocks SW navigation interception): fall through
//      so CheerpX surfaces a clear error instead of looping forever.
//
// This runs as a classic <script> in <head> so it executes before the
// AMD loader pulls in the workbench bundle and before CheerpX tries
// to allocate shared memory. It is intentionally tiny and dependency-
// free — the workbench bundle is multiple megabytes, so spending
// 30 ms here to avoid a wasted boot is a clear win.

(function () {
  // Opt-out via `?coi=0` — useful for diagnostics and for the rare
  // browser where SW reload is harmful (no known cases at writing).
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get('coi') === '0') return;
  } catch (_) {}

  // Already isolated — nothing to do. This is the warm-load path.
  if (window.crossOriginIsolated) return;

  // No service worker support? Surface this once on the next tick so
  // CheerpX's later DataCloneError isn't the first signal the user
  // sees, then bail. The page will still load — just without VM
  // threading, which usually means CheerpX hangs or runs degraded.
  if (!('serviceWorker' in navigator)) {
    setTimeout(function () {
      // eslint-disable-next-line no-console
      console.warn(
        '[rust-web-box] Service workers unavailable; cross-origin ' +
          'isolation cannot be synthesized on GitHub Pages. CheerpX ' +
          'will fail to start. Try a regular (non-private) tab.',
      );
    }, 0);
    return;
  }

  // Reload-loop guard. Without this, a browser that registers the SW
  // but refuses to intercept navigation (or a quota-exceeded SW that
  // can't install) would reload forever. We allow exactly one reload
  // per fresh navigation; the marker is cleared as soon as we observe
  // isolation. Stored in `sessionStorage` so it doesn't leak across
  // tabs or survive a tab-close.
  var KEY = 'rust-web-box.coi.reloaded';
  var alreadyReloaded = false;
  try {
    alreadyReloaded = sessionStorage.getItem(KEY) === '1';
  } catch (_) {
    // sessionStorage is unavailable in some sandboxed iframes; we
    // treat that as "no reload yet" and the worst case is the same
    // first-load fallback every time.
  }

  // Resolve the SW URL relative to the current document so deploy
  // sub-paths (e.g. /rust-web-box/) work without baking absolute
  // paths.
  var swUrl = new URL('./sw.js', window.location.href).href;

  // Best-effort: if the SW is already controlling the page but we're
  // not isolated, the cached SW may be a previous build that didn't
  // synthesize COOP/COEP — try to update it before reloading.
  function reloadOnce(reason) {
    if (alreadyReloaded) {
      // We've already reloaded once and isolation still didn't latch.
      // Give up rather than loop, and log a structured diagnostic so
      // a future maintainer can find this exact branch.
      // eslint-disable-next-line no-console
      console.warn(
        '[rust-web-box] cross-origin isolation could not be enabled ' +
          'after a one-shot SW reload (reason: ' + reason + '). ' +
          'CheerpX will fall back to non-threaded mode and likely ' +
          'fail with a DataCloneError. See ' +
          'docs/case-studies/issue-7/analysis-coop-coep-bootstrap.md',
      );
      return;
    }
    try {
      sessionStorage.setItem(KEY, '1');
    } catch (_) {}
    // `location.reload()` reissues the navigation. The SW (now active)
    // intercepts it and synthesizes COOP/COEP, the response is parsed
    // by the browser with the headers attached, and isolation latches.
    window.location.reload();
  }

  // Clear the marker once isolation is observed — so a *future* fresh
  // navigation that loses isolation can reload again. Without this, a
  // user opening a new tab to the page would never get the reload
  // because `sessionStorage` is per-tab but persists across reloads.
  function clearMarkerIfIsolated() {
    if (!window.crossOriginIsolated) return;
    try {
      sessionStorage.removeItem(KEY);
    } catch (_) {}
  }

  // If a controller is already attached, the SW just hasn't supplied
  // headers on this navigation (because the navigation request landed
  // before the SW activated). Reload immediately — the next request
  // will be intercepted.
  if (navigator.serviceWorker.controller) {
    reloadOnce('controller-attached-but-not-isolated');
    return;
  }

  // No controller yet — register the SW and reload once it takes over.
  navigator.serviceWorker
    .register(swUrl, { scope: './' })
    .then(function (reg) {
      // Some browsers fire `controllerchange` only after the page is
      // claimed; others claim eagerly via `clients.claim()` in our SW
      // and still don't fire it. Belt-and-braces: listen for both
      // events and also poll once after a short delay.
      function onClaim() {
        clearMarkerIfIsolated();
        if (!window.crossOriginIsolated) {
          reloadOnce('controllerchange-without-isolation');
        }
      }
      navigator.serviceWorker.addEventListener('controllerchange', onClaim, {
        once: true,
      });
      // Fallback: even if `controllerchange` doesn't fire (some SW
      // quirks), the active worker may still be in scope. Poll once.
      setTimeout(function () {
        if (window.crossOriginIsolated) {
          clearMarkerIfIsolated();
          return;
        }
        if (navigator.serviceWorker.controller) {
          reloadOnce('post-register-poll');
        }
      }, 1500);
      // If registration succeeded but the SW is `installing`/`waiting`,
      // wait for it to activate and then reload. `clients.claim()` in
      // the SW makes `controllerchange` fire above; this is just a
      // belt-and-braces fallback for SWs that don't claim().
      var sw = reg.installing || reg.waiting || reg.active;
      if (sw && sw.state !== 'activated') {
        sw.addEventListener(
          'statechange',
          function () {
            if (sw.state === 'activated' && !window.crossOriginIsolated) {
              reloadOnce('statechange-activated');
            }
          },
          { once: true },
        );
      } else if (sw && sw.state === 'activated' && !navigator.serviceWorker.controller) {
        // SW is active but no controller — typically a fresh page
        // load where the SW just claimed. Reload to attach.
        reloadOnce('activated-no-controller');
      }
    })
    .catch(function (err) {
      // eslint-disable-next-line no-console
      console.warn(
        '[rust-web-box] service worker registration failed; cross-origin ' +
          'isolation cannot be synthesized:',
        err,
      );
    });
})();
