import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { nativeNotificationsActive } from './nativeNotify';

/**
 * Bildirim servisi
 * ----------------
 * İki yol var:
 *
 *  1. NATIVE (Android kabuğu): `AhududuNotifyService` arka planda kendi
 *     WebSocket'ini açık tutar ve mesaj geldiğinde sistem bildirimini gösterir.
 *     Uygulama kapalıyken de çalışır. Bu yüzden native'de burada AYRICA yerel
 *     bildirim göstermiyoruz — yoksa aynı mesaj iki kez bildirilir.
 *
 *  2. WEB (tarayıcı): Uygulama arka plandayken WebSocket ölür; bu yüzden
 *     tarayıcının kendi Notification API'si kullanılır (izin varsa).
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

/**
 * Bir kez çalışır: izin ister ve bildirim kanalını oluşturur.
 *
 * NATIVE NOT: Bu fonksiyon native bildirim servisini BAŞLATMAZ; servis
 * App.tsx içinde ayrıca `startNativeNotifications(userId)` ile başlatılır.
 * Burada yalnızca yerel bildirim izni/kanalı hazırlanır. Native servis zaten
 * ayaktaysa bildirimi O gösterir; o durumda yerel kanal şart değildir.
 */
export async function initNotifications(userId?: string): Promise<boolean> {
  // `userId` geriye dönük uyumluluk için duruyor; servisi App.tsx başlatıyor.
  void userId;
  if (!isNative()) return ready;

  // Native ön plan servisi çalışıyorsa bildirim sorumluluğu tamamen serviste.
  try {
    if (await nativeNotificationsActive()) {
      ready = true;
      return true;
    }
  } catch {
    /* yok say */
  }

  if (ready) return true;
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

  // Native bildirim servisi çalışıyorsa bildirimi O gösterir (çift bildirim yok).
  try {
    if (await nativeNotificationsActive()) {
      return;
    }
  } catch {
    /* yok say */
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
