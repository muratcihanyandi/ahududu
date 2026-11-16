import { Capacitor, registerPlugin } from '@capacitor/core';
import { UserId } from '../types';

/**
 * Ahududu — uygulama kapalıyken/arka plandayken bildirim.
 * -------------------------------------------------------
 * Android WebView arka planda WebSocket'i öldürür; bu yüzden bildirim
 * gösteremez. Native tarafta çalışan `AhududuNotifyService` kendi WebSocket
 * bağlantısını açık tutar ve mesaj geldiğinde sistem bildirimi gösterir.
 * Bu dosya web tarafındaki köprüdür; web'de (tarayıcı) sessizce no-op olur.
 */

export interface NativeNotifyStatus {
  running: boolean;
  userId?: string | null;
  serverUrl?: string | null;
}

interface NotificationsBridgePlugin {
  configure(options: { userId: string; serverUrl?: string }): Promise<{ running: boolean }>;
  status(): Promise<NativeNotifyStatus>;
  start(): Promise<{ running: boolean }>;
  stop(): Promise<{ running: boolean }>;
  consumeOpenChat(): Promise<{ pending: boolean; userId?: string | null }>;
  clearPendingOpenChat(): Promise<void>;
}

let plugin: NotificationsBridgePlugin | null = null;
let pluginLookupFailed = false;

/** Native köprü var mı? (yalnızca Android kabuğunda true) */
export const isNativeNotificationsAvailable = (): boolean => {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
};

const getPlugin = (): NotificationsBridgePlugin | null => {
  if (plugin) return plugin;
  if (pluginLookupFailed) return null;
  if (!isNativeNotificationsAvailable()) return null;

  try {
    plugin = registerPlugin<NotificationsBridgePlugin>('NotificationsBridge');
    return plugin;
  } catch (e) {
    pluginLookupFailed = true;
    console.warn('[Ahududu] Bildirim köprüsü bulunamadı', e);
    return null;
  }
};

/** Sunucu adresi: uygulamanın yüklendiği adres (native'de https://ahududu.fakeyol.com). */
export const currentServerUrl = (): string => {
  try {
    if (typeof window !== 'undefined') {
      if (window.location.hostname === 'localhost') {
        return localStorage.getItem('ahududu_server_url') || 'https://ahududu.fakeyol.com';
      }
      return window.location.origin;
    }
  } catch {
    /* yok say */
  }
  return 'https://ahududu.fakeyol.com';
};

/**
 * Native bildirim servisini bu kullanıcı için başlatır.
 * Servis çalışmıyorsa (web, izin yok, eski APK) false döner ve uygulama
 * normal şekilde çalışmaya devam eder.
 */
export async function startNativeNotifications(
  userId: UserId | string,
  serverUrl: string = currentServerUrl()
): Promise<boolean> {
  const p = getPlugin();
  if (!p) return false;
  try {
    const result = await p.configure({ userId, serverUrl });
    const running = Boolean(result?.running);
    if (running) {
      console.log('[Ahududu] Bildirim servisi çalışıyor:', userId);
    }
    return running;
  } catch (e) {
    console.warn('[Ahududu] Bildirim servisi başlatılamadı', e);
    return false;
  }
}

/** Servis ayakta mı? */
export async function nativeNotificationsActive(): Promise<boolean> {
  const p = getPlugin();
  if (!p) return false;
  try {
    const status = await p.status();
    return Boolean(status?.running);
  } catch {
    return false;
  }
}

/** Bildirim servisini durdur (kullanıcı değişince temizlik için). */
export async function stopNativeNotifications(): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.stop();
  } catch {
    /* yok say */
  }
}

/**
 * Kullanıcı bildirime dokunduysa true döner (sohbet sekmesi açılacak).
 * Aynı dokunuşun tekrar tekrar işlenmemesi için bayrak hemen temizlenir.
 */
export async function consumeOpenChat(): Promise<boolean> {
  const p = getPlugin();
  if (!p) return false;
  try {
    const result = await p.consumeOpenChat();
    return Boolean(result?.pending);
  } catch {
    return false;
  }
}

/** Bekleyen "sohbeti aç" isteğini temizle. */
export async function clearPendingOpenChat(): Promise<void> {
  const p = getPlugin();
  if (!p) return;
  try {
    await p.clearPendingOpenChat();
  } catch {
    /* yok say */
  }
}
