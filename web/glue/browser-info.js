// Lightweight browser identification.
//
// We treat browser identity as best-effort and observational only:
// no code path depends on it; the boot-toast renderer uses it to
// surface Brave-specific hints when CheerpX errors look like the
// upstream V8/Shields/farbling issues documented in
// docs/case-studies/issue-35/online-research.md.

const BRAVE_UA_RE = /Brave/i;

export async function detectBrowser({ nav = globalThis.navigator } = {}) {
  if (!nav) {
    return { id: 'unknown', isBrave: false, isChromium: false, ua: '' };
  }
  const ua = String(nav.userAgent || '');
  let isBrave = false;
  try {
    if (typeof nav.brave?.isBrave === 'function') {
      isBrave = await nav.brave.isBrave();
    }
  } catch {
    isBrave = false;
  }
  // Brave UA is intentionally Chrome's — `nav.brave.isBrave()` is
  // the only reliable check. We also accept the legacy explicit
  // `Brave/` token in case a future version restores it.
  if (!isBrave && BRAVE_UA_RE.test(ua)) isBrave = true;
  const isChromium =
    /Chrome\/|Chromium\//.test(ua) || isBrave || !!nav.userAgentData?.brands?.some?.(
      (b) => /Chromium|Google Chrome|Brave/.test(b?.brand ?? ''),
    );

  // Apple platform detection (issue #37: the terminal fails specifically
  // on iPad Safari). iPhone/iPod still carry their device token in the
  // UA, but since iPadOS 13 desktop-class Safari reports as "Macintosh"
  // with no iPad token — the only reliable tell is a Mac UA that also has
  // a touch screen (`maxTouchPoints > 1`). `platform` is deprecated but
  // still the most stable signal where present.
  const platform = String(nav.platform || '');
  const maxTouchPoints = Number(nav.maxTouchPoints || 0);
  const isIPhone = /iPhone|iPod/.test(ua);
  const isIPadOS = /iPad/.test(ua) || (/Mac/.test(platform) && maxTouchPoints > 1);
  const isIOS = isIPhone || isIPadOS;
  // Safari's UA contains "Safari" but so does Chrome's; the distinguishing
  // tell is the absence of the Chromium/Edge/Firefox tokens. On iOS every
  // browser is WebKit under the hood, so we also flag iOS as Safari-class.
  const isSafari =
    isIOS ||
    (/Safari\//.test(ua) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(ua));

  return {
    id: isBrave ? 'brave' : isChromium ? 'chromium' : isSafari ? 'safari' : 'other',
    isBrave,
    isChromium,
    isSafari,
    isIOS,
    isIPad: isIPadOS,
    isIPhone,
    platform,
    maxTouchPoints,
    ua,
  };
}
