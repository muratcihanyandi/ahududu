/**
 * Android geri tuşu yönetimi.
 *
 * Native kabuk (MainActivity) geri tuşuna basıldığında `window.__ahududuBack()`
 * çağırır. Bu fonksiyon `true` dönerse native taraf hiçbir şey yapmaz (uygulama
 * açık kalır); `false` dönerse uygulama arka plana alınır.
 *
 * Türkçe karşılığı: geri tuşu asla uygulamadan çıkarmaz.
 *   1. Açık bir pencere (mektup, sinema, sohbet, an paylaşma...) varsa onu kapatır.
 *   2. Ana ekranda değilsek ana ekrana döner.
 *   3. Ana ekrandaysak uygulamayı arka plana alır (kapatmaz).
 *
 * Tarayıcıda (Capacitor yokken) `popstate` ile aynı davranış sağlanır.
 */

type BackHandler = () => boolean;

const handlers: BackHandler[] = [];

/** Bir pencere/sayfa açıldığında geri tuşu için handler kaydeder. */
export function registerBackHandler(handler: BackHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.indexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

/** En son açılan pencereye geri tuşunu iletir. */
export function runBackHandlers(): boolean {
  for (let i = handlers.length - 1; i >= 0; i -= 1) {
    try {
      if (handlers[i]()) return true;
    } catch (e) {
      console.warn('[Ahududu Back] handler hatası:', e);
    }
  }
  return false;
}

export function hasBackHandlers(): boolean {
  return handlers.length > 0;
}

/**
 * Uygulama seviyesindeki geri davranışını kurar.
 * `onResetToHome`: açık pencere yokken çağrılır (ana ekrana dön); `true` dönerse işlenmiş sayılır.
 * Dönen fonksiyon kurulumu geri alır.
 */
export function installBackNavigation(onResetToHome: () => boolean): () => void {
  const win = window as unknown as {
    __ahududuBack?: () => boolean;
    Capacitor?: { isNativePlatform?: () => boolean };
  };

  const previous = win.__ahududuBack;
  win.__ahududuBack = () => {
    if (runBackHandlers()) return true;
    return onResetToHome();
  };

  // Mobil tarayıcı / PWA: geri tuşu geçmişi geri alır; uygulamadan çıkmasın.
  const isNative = Boolean(win.Capacitor?.isNativePlatform?.());
  let popHandler: (() => void) | null = null;
  if (!isNative) {
    window.history.pushState({ ahududu: true }, '');
    popHandler = () => {
      onResetToHome();
      window.history.pushState({ ahududu: true }, '');
    };
    window.addEventListener('popstate', popHandler);
  }

  return () => {
    win.__ahududuBack = previous;
    if (popHandler) window.removeEventListener('popstate', popHandler);
  };
}
