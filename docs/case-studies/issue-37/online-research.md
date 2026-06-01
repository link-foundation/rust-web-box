# Online research — Issue #37

Corroborating facts gathered while root-causing the three defects. Each
claim is tied to a source; conclusions we drew for this PR are marked
**→**.

## 1. Safari `100vw` is wider than the visible viewport

> "If the page has a vertical classic scrollbar, `100vw` is larger than
> the viewport width … setting an element to `width: 100vw` causes the
> page to overflow horizontally by a small amount in browsers with
> classic scrollbars." — Smashing Magazine, *New CSS Viewport Units Do
> Not Solve The Classic Scrollbar Problem* (2023).

> "In Safari, media queries take scrollbars into account … Safari's
> behavior is considered a bug." — same article.

> "`scrollbar-gutter: stable` … is not supported in Safari at the time of
> writing." — same article.

Related WebKit behaviour:

- WebKit bug 153852 — `<body>` with `overflow: hidden` is still
  scrollable on iOS, i.e. mobile Safari does not treat the body box the
  way other engines do.
- The well-known `100vh` problem on iOS Safari: `100vh` counts the area
  *behind* the dynamic browser toolbar, so a `height: 100vh` element is
  taller than the visible area until the toolbar collapses (DEV
  Community; Medium / Susie Kim).

**→** Our `html, body { width: 100vw; height: 100vh }` was the root cause
of one clipping vector: `overflow: hidden` on the workbench then crops the
few px of overflow exactly where the title-bar/panel actions sit. We
replaced it with `position: fixed; inset: 0`, which always equals the
*visible* viewport box and side-steps both the `100vw` scrollbar-gutter
bug and the `100vh` toolbar bug. (Note: the scroll-lock community warns
that `position: fixed` on the body "crops to the small viewport" — for a
full-screen, non-scrolling app like ours, filling the small/visible
viewport is exactly the desired behaviour.)

Sources:
- [Smashing Magazine — New CSS Viewport Units Do Not Solve The Classic Scrollbar Problem](https://www.smashingmagazine.com/2023/12/new-css-viewport-units-not-solve-classic-scrollbar-problem/)
- [DEV — 100vh problem with iOS Safari](https://dev.to/maciejtrzcinski/100vh-problem-with-ios-safari-3ge9)
- [Medium — Addressing the iOS Viewport Unit Bug](https://medium.com/@susiekim9/how-to-compensate-for-the-ios-viewport-unit-bug-46e78d54af0d)
- [WebKit Bug 153852 — body overflow:hidden scrollable on iOS](https://bugs.webkit.org/show_bug.cgi?id=153852)

## 2. Global `box-sizing` resets can change third-party control geometry

MDN documents that `box-sizing` controls how an element's total width and
height are calculated. With the default `content-box`, padding and border
are added to the declared width; with `border-box`, padding and border are
included inside the declared width and the content box shrinks.

**→** Our `* { box-sizing: border-box }` reset changed VS Code Web's
internal geometry. VS Code action labels and tree twisties use fixed
content widths with padding for icon and hover hitbox spacing. Playwright
DOM measurements showed title/panel action labels rendered as 16 px
`border-box` boxes instead of 22 px `content-box` boxes, and Explorer
twisties rendered as 16 px boxes with a 20 px label offset instead of
30 px / 34 px. Removing the global reset and scoping `border-box` to the
boot toast restored the expected VS Code geometry without changing our
own shell UI.

Sources:
- [MDN — box-sizing CSS property](https://developer.mozilla.org/en-US/docs/Web/CSS/box-sizing)

## 3. VS Code theme selection / default

> "VS Code … preferred dark and light color themes … default to Dark
> Modern and Light Modern respectively. The `workbench.colorTheme`
> setting specifies the color theme used in the workbench." — VS Code
> docs, *Themes*.

> Users can make VS Code follow the OS scheme with
> `window.autoDetectColorScheme: true` plus
> `workbench.preferredDarkColorTheme` / `preferredLightColorTheme`. — same.

**→** With no persisted `workbench.colorTheme` and no shipped default, the
web workbench resolves the theme from the OS `prefers-color-scheme`. The
deployed page rendered the `…light_modern-json` theme class, confirming
the light fallback. Setting `configurationDefaults["workbench.colorTheme"]
= "Default Dark Modern"` makes the *default* dark (what vscode.dev does)
while still letting a user switch themes (their choice persists and wins
over the default).

Sources:
- [VS Code Docs — Themes](https://code.visualstudio.com/docs/configure/themes)
- [microsoft/vscode#137635 — colorTheme restores to Default Dark+ automatically](https://github.com/microsoft/vscode/issues/137635)

## 4. CheerpX / WebVM on Safari, iOS and iPadOS

> "WebVM and CheerpX are compatible with any browser, both on Desktop
> (Chrome/Chromium, Edge, Firefox, Safari) and Mobile (Chrome, Safari),
> provided support for SAB [SharedArrayBuffer] is present, and the device
> has sufficient memory." — leaningtech/webvm README.

> "CheerpX relies on SharedArrayBuffer, which requires the site to be
> cross-origin isolated [COOP/COEP]." — leaningtech.

> "Every iOS browser must use the … WebKit framework and WebKit
> JavaScript" — so every browser on iOS/iPadOS is effectively Safari.
> SharedArrayBuffer landed in Safari (re-enabled with cross-origin
> isolation) and is available in modern versions. iOS ≤ 16.3 silently
> falls back to scalar code for some WASM SIMD paths (≈½ perf). —
> StackBlitz / LambdaTest / HN.

**→** CheerpX is *supposed* to work on iPad Safari given SAB +
cross-origin isolation and enough memory. Our service worker already
synthesises COOP/COEP (verified by `pages-parity.test.mjs`), and the
workbench itself rendered on the reporter's iPad — so isolation is
working. That points the iPad terminal failure at a device/version
specific condition (memory pressure, a WASM/JIT limitation, or a
Safari-version SAB edge) rather than a missing capability. We can't
distinguish these without a dump from the device, which is why we added
shell-loop + platform diagnostics and prepared an upstream report.

Sources:
- [leaningtech/webvm README](https://github.com/leaningtech/webvm/blob/main/README.md)
- [StackBlitz — WebContainers now run on Safari, iOS, and iPadOS](https://blog.stackblitz.com/posts/webcontainers-are-now-supported-on-safari/)
- [LambdaTest — WebAssembly browser support (Safari)](https://www.lambdatest.com/web-technologies/wasm-safari)
- [Apple Developer Forums — Safari SharedArrayBuffer support](https://developer.apple.com/forums/thread/678808)

## 5. Safe-area insets / `viewport-fit=cover`

The platform-standard way to paint edge-to-edge under the iPad/iPhone
notch and home-indicator is `<meta name="viewport"
content="…, viewport-fit=cover">` combined with `env(safe-area-inset-*)`
padding on any chrome that must stay clear of the rounded corners /
indicator. This is a CSS/HTML primitive — no library needed — and is what
we applied to the viewport meta and the boot toast.
