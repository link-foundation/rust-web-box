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
  return {
    id: isBrave ? 'brave' : isChromium ? 'chromium' : 'other',
    isBrave,
    isChromium,
    ua,
  };
}
