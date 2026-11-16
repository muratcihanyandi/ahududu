import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';

/**
 * Bildirim servisi
 * ----------------
 * Uygulama ön plandayken mesajlar WebSocket'ten gelir ve sohbet ekranı
 * kendini günceller. Sorun, uygulama ARKA PLANDA ya da ekran kapalıyken:
 * Android WebView'in WS bağlantısını öldürür, dolayısıyla mesaj gelince
 * hiçbir bildirim çıkmaz. Bu servis yerel bildirim kanalını kurar ve
 * gelen her mesajı sistem bildirimi olarak gösterir.
 */

/** Android 8+ zorunlu: bildirim kanalı (önem derecesi burada belirlenir). */
const CHANNEL_ID = 'ahududu_messages';

let ready = false;

const isNative = (): boolean => {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
};

/** Bir kez çalışır: izin ister ve bildirim kanalını oluşturur. */
export async function initNotifications(): Promise<boolean> {
  if (!isNative() || ready) return ready;
  try {
    const perm = await LocalNotifications.checkPermissions();
    let granted = perm.display === 'granted';
    if (!granted) {
      const req = await LocalNotifications.requestPermissions();
      granted = req.display === 'granted';
    }
    if (!granted) {
      console.warn('[Ahududu Notify] izin verilmedi');
      return false;
    }

    // Android 8+ kanal tanımı. Yüksek önem = ses + açılır bildirim.
    try {
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: 'Mesajlar',
        description: 'Sohbet ve hatırlatma bildirimleri',
        importance: 5,
        visibility: 1,
        vibration: true,
        lights: true,
        lightColor: '#e11d6b',
      });
    } catch {
      /* kanal zaten varsa veya desteklenmiyorsa yok say */
    }

    ready = true;
    return true;
  } catch (e) {
    console.warn('[Ahududu Notify] init hatası', e);
    return false;
  }
}

/** Mesaj bildirimi göster. */
export async function notifyMessage(opts: {
  title: string;
  body: string;
  id?: number;
  groupKey?: string;
}): Promise<void> {
  const { title, body } = opts;
  const id = opts.id ?? Math.floor(Date.now() / 1000) % 2147483647;

  if (!isNative()) {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(title, { body, icon: '/logo.png' });
      }
    } catch {
      /* yok say */
    }
    return;
  }

  try {
    if (!ready) await initNotifications();
    await LocalNotifications.schedule({
      notifications: [
        {
          id,
          title,
          body,
          channelId: CHANNEL_ID,
          smallIcon: 'ic_stat_icon_config_sample',
          iconColor: '#e11d6b',
          group: opts.groupKey,
          groupSummary: false,
          autoCancel: true,
          extra: { kind: 'chat' },
        },
      ],
    });
  } catch (e) {
    console.warn('[Ahududu Notify] schedule hatası', e);
  }
}

/** Uygulama ön plandayken gösterilen bildirimleri temizle. */
export async function clearAllNotifications(): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.removeAllDeliveredNotifications();
  } catch {
    /* yok say */
  }
}

/** Kullanıcı bildirime dokununca tetiklenir. */
export function onNotificationTap(handler: (extra: any) => void): () => void {
  if (!isNative()) return () => {};
  let removed = false;
  let sub: any = null;
  try {
    LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
      if (!removed) handler(action?.notification?.extra ?? {});
    }).then((s) => {
      sub = s;
    });
  } catch {
    /* yok say */
  }
  return () => {
    removed = true;
    try {
      sub?.remove?.();
    } catch {
      /* yok say */
    }
  };
}
