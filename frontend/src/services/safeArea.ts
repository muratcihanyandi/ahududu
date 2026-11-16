/**
 * Safe-area support for the edge-to-edge (Capacitor) WebView.
 *
 * The Android WebView here reports `env(safe-area-inset-*)` as 0 even though
 * the window is genuinely inset (screen.height - innerHeight > 0), so the
 * header ends up drawn underneath the translucent status bar.
 *
 * Strategy:
 *   1. Prefer `env()` when it reports a real value.
 *   2. Otherwise derive the inset from the difference between the physical
 *      screen height and the WebView viewport height, which is exactly the
 *      status bar height on a non-fullscreen-window device.
 *
 * Values are written to CSS custom properties so the layout stays in CSS.
 */

/** Physical screen and viewport height differ only by the system bars. */
function derivedTopInset(): number {
  const screenH = window.screen?.height ?? 0;
  const viewportH = window.innerHeight;
  if (!screenH || !viewportH) return 0;

  const diff = screenH - viewportH;
  // A plausible status bar is a small positive slice of the screen. Anything
  // larger means the viewport is measured differently (desktop, zoom, etc.).
  if (diff > 0 && diff < screenH * 0.12) {
    return Math.round(diff);
  }
  return 0;
}

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
  const top = envInsetPx('safe-area-inset-top') || derivedTopInset();
  const bottom = envInsetPx('safe-area-inset-bottom');
  const left = envInsetPx('safe-area-inset-left');
  const right = envInsetPx('safe-area-inset-right');

  setVar('--safe-top', top);
  setVar('--safe-bottom', bottom);
  setVar('--safe-left', left);
  setVar('--safe-right', right);

  // The status bar is translucent, so the page background must extend behind
  // it. Reserve the inset as padding while letting the background paint.
  document.documentElement.style.setProperty('--safe-top', `${top}px`);
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
