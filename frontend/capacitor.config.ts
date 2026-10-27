import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ahududu.app',
  appName: 'Ahududu',
  webDir: 'dist',
  server: {
    // Points directly to the live server on Raspberry Pi 5
    // Guarantees zero-reinstall instant updates!
    url: 'http://192.168.2.170:33470',
    cleartext: true,
    allowNavigation: [
      '192.168.2.170:33470',
      '*.muratcihanyandi.com',
      'localhost:*'
    ]
  },
  android: {
    allowMixedContent: true,
    backgroundColor: '#fdf2f8'
  }
};

export default config;
