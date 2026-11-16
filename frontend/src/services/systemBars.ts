/**
 * System bar theming for the native (Capacitor) shell.
 *
 * The app is light-themed on every screen, so the status bar needs DARK icons
 * and a light background. Capacitor's default is white icons, which vanish on
 * the near-white app background.
 *
 * This runs in the browser too, where `@capacitor/core` reports the platform
 * as "web" and the plugin calls are skipped, so nothing breaks on desktop.
 */
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

const BAR_BACKGROUND = '#fdf2f8';

export async function applySystemBarStyle() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    // Style.Light renders DARK (black) icons; Style.Dark renders white ones.
    await StatusBar.setStyle({ style: Style.Light });
    if (Capacitor.getPlatform() === 'android') {
      await StatusBar.setBackgroundColor({ color: BAR_BACKGROUND });
      // Keep the WebView below the status bar so layout never collides with it.
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch {
    // Older shells without the plugin: the CSS safe-area fallback still applies.
  }
}
