// Keep the default browser console focused on actionable rust-web-box
// warnings/errors. VS Code Web emits a few repeated startup messages
// for our embedded, no-gallery workbench shape; exact-message filtering
// keeps them out of normal sessions while `?debug=1` or `?debug=vscode`
// leaves the upstream console untouched for diagnostics.
(function () {
  var root = typeof globalThis === 'object' ? globalThis : window;
  var search = root.location && root.location.search ? root.location.search : '';
  var params = new URLSearchParams(search.charAt(0) === '?' ? search.slice(1) : search);
  var debug = params.get('debug');
  if (debug == null) {
    try {
      debug =
        root.localStorage.getItem('rustWebBoxDebug') ||
        root.localStorage.getItem('debug') ||
        root.localStorage.getItem('DEBUG');
    } catch {
      debug = null;
    }
  }
  if (shouldBypass(debug)) return;

  var rules = [
    /Ignoring fetching additional builtin extensions from gallery as it is disabled\./,
    /Found additional builtin location extensions in env/,
    /Updating additional builtin extensions cache/,
    /No search provider registered for scheme: webvm, waiting/,
    /Ignoring the error while validating workspace folder webvm:\/workspace - ENOPRO/,
    /The web worker extension host is started in a same-origin iframe!/,
  ];

  var state = {
    enabled: true,
    filtered: 0,
    samples: [],
  };
  root.__rustWebBox = root.__rustWebBox || {};
  root.__rustWebBox.consoleFilter = state;

  root.addEventListener?.('error', function (event) {
    if (!matchesKnownCheerpXError(event)) return;
    state.filtered += 1;
    if (state.samples.length < 20) state.samples.push(event.message || 'CheerpX internal a1 error');
    event.preventDefault();
    event.stopImmediatePropagation?.();
  }, true);

  root.addEventListener?.('unhandledrejection', function (event) {
    if (!matchesKnownCheerpXError(event.reason)) return;
    state.filtered += 1;
    if (state.samples.length < 20) state.samples.push(joinArgs([event.reason]));
    event.preventDefault();
    event.stopImmediatePropagation?.();
  }, true);

  ['debug', 'info', 'log', 'warn'].forEach(function (method) {
    var original = root.console && root.console[method];
    if (typeof original !== 'function') return;
    root.console[method] = function () {
      var args = Array.prototype.slice.call(arguments);
      if (matchesKnownNoise(args)) {
        state.filtered += 1;
        if (state.samples.length < 20) state.samples.push(joinArgs(args));
        return;
      }
      return original.apply(this, args);
    };
  });

  function shouldBypass(raw) {
    if (raw == null) return false;
    return String(raw)
      .split(/[\s,]+/)
      .some(function (token) {
        return /^(1|true|on|all|\*|vscode|workbench|rust-web-box:\*)$/i.test(token);
      });
  }

  function matchesKnownNoise(args) {
    var text = joinArgs(args);
    return rules.some(function (rule) { return rule.test(text); });
  }

  function matchesKnownCheerpXError(value) {
    var message = value?.message || value?.reason?.message || String(value || '');
    var filename = value?.filename || '';
    var stack = value?.error?.stack || value?.stack || '';
    var text = [message, filename, stack].join('\n');
    return /(?:reading 'a1'|evaluating 'c\.a4\.a1')/.test(text) && /\/cheerpx\/cx_esm\.js/.test(text);
  }

  function joinArgs(args) {
    return args.map(function (arg) {
      if (arg == null) return String(arg);
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.message;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }).join(' ');
  }
})();
