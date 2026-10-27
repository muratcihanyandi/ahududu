import { registerPlugin } from '@capacitor/core';

export interface WatchNode {
  id: string;
  name: string;
  isNearby: boolean;
}

export interface WatchStatusResponse {
  connected: boolean;
  watches?: WatchNode[];
  count?: number;
  error?: string;
}

interface GalaxyWatchBridgePluginInterface {
  getConnectedWatchInfo(): Promise<WatchStatusResponse>;
  openUrlOnWatch(options: { url: string }): Promise<{ success: boolean; message?: string; targetWatch?: string }>;
  openGalaxyWearable(): Promise<{ success: boolean }>;
}

const GalaxyWatchBridge = registerPlugin<GalaxyWatchBridgePluginInterface>('GalaxyWatchBridge');

export const galaxyWatchService = {
  /**
   * Check if a Samsung Galaxy Watch is currently paired and connected over Bluetooth/Wi-Fi
   */
  async getStatus(): Promise<WatchStatusResponse> {
    try {
      return await GalaxyWatchBridge.getConnectedWatchInfo();
    } catch (e: any) {
      console.warn('GalaxyWatchBridge.getStatus error:', e);
      return { connected: false, error: e?.message || 'Köprüye ulaşılamadı' };
    }
  },

  /**
   * 1-Tap Direct Push: Sends an intent over Bluetooth to the connected Galaxy Watch
   * The watch vibrates and immediately opens the Ahududu watch interface!
   */
  async launchOnWatch(url: string): Promise<{ success: boolean; message: string }> {
    try {
      const res = await GalaxyWatchBridge.openUrlOnWatch({ url });
      return {
        success: true,
        message: res.targetWatch
          ? `${res.targetWatch} saatinize sinyal gönderildi, ekran açılıyor! ⌚✨`
          : 'Bağlı saatinize sinyal gönderildi, ekran açılıyor! ⌚✨',
      };
    } catch (e: any) {
      // Fallback: Web Share / Samsung Quick Share
      try {
        if (typeof navigator !== 'undefined' && navigator.share) {
          await navigator.share({
            title: 'Ahududu Saat Companion',
            text: 'Samsung Galaxy Watch üzerinde aç',
            url: url,
          });
          return {
            success: true,
            message: 'Paylaşım ekranı açıldı. "Galaxy Watch" seçerek saate aktarabilirsiniz.',
          };
        }
      } catch (shareErr) {
        // User cancelled share
      }

      return {
        success: false,
        message: e?.message || 'Saate doğrudan ulaşılamadı.',
      };
    }
  },

  /**
   * Opens Samsung Galaxy Wearable app on the phone directly
   */
  async openWearableApp(): Promise<boolean> {
    try {
      const res = await GalaxyWatchBridge.openGalaxyWearable();
      return res.success;
    } catch (e) {
      console.warn('Galaxy Wearable could not be opened:', e);
      return false;
    }
  },
};
