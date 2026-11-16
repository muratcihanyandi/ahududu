import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ahududu.app',
  appName: 'Ahududu',
  webDir: 'dist',
  server: {
    // Points directly to the live server on Raspberry Pi 5
    // Guarantees zero-reinstall instant updates!
    url: 'https://ahududu.fakeyol.com',
    cleartext: false,
    allowNavigation: [
      'ahududu.fakeyol.com',
      '*.muratcihanyandi.com',
      'localhost:*'
    ]
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#fdf2f8',
  },
  plugins: {
    // The app is light-themed on every screen, so the OS must draw DARK
    // status-bar icons. Without this the system defaults to white icons,
    // which are invisible on the near-white app background.
    StatusBar: {
      style: 'LIGHT',           // 'LIGHT' = dark icons (Android naming)
      overlaysWebView: false,   // WebView starts below the status bar
      backgroundColor: '#fdf2f8',
    },
  },
};

export default config;
