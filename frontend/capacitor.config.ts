import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ahududu.app',
  appName: 'Ahududu',
  webDir: 'dist',
  server: {
    // Allows loading live updates from the Pi or Cloudflare tunnel URL
    // When unset, falls back to the local bundled assets
    cleartext: true,
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#fdf2f8'
  }
};

export default config;
