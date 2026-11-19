/**
 * Safe-area support for the WebView / browser viewport.
 * Reads CSS `env(safe-area-inset-*)` and writes `--safe-*` custom properties.
 * (Capacitor Android runs with `overlaysWebView: false`, so status bar insets
 * are intentionally 0 without synthesizing artificial padding.)
 */

function envInsetPx(name: string): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;top:0;left:0;height:env(${name},0px);width:0;visibility:hidden;pointer-events:none;`;
  document.body.appendChild(probe);
  const value = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(value) ? value : 0;
}

function setVar(name: string, px: number) {
  document.documentElement.style.setProperty(name, `${px}px`);
}

export function applySafeAreaInsets() {
  const top = envInsetPx('safe-area-inset-top');
  const bottom = envInsetPx('safe-area-inset-bottom');
  const left = envInsetPx('safe-area-inset-left');
  const right = envInsetPx('safe-area-inset-right');

  setVar('--safe-top', top);
  setVar('--safe-bottom', bottom);
  setVar('--safe-left', left);
  setVar('--safe-right', right);
}

/** Re-measure on rotation and whenever the viewport geometry changes. */
export function watchSafeAreaInsets() {
  let last = -1;
  const remeasure = () => {
    const height = window.innerHeight;
    if (height === last) return;
    last = height;
    applySafeAreaInsets();
  };
  window.addEventListener('resize', remeasure);
  window.addEventListener('orientationchange', () => setTimeout(remeasure, 150));
}
