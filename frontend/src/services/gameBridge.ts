// Oyun ile Ahududu kabuğu arasındaki köprü.
//
// Oyun ayrı bir iframe'dir; kabuğun soketini, durum yoklamasını ve tam ekranı
// doğrudan göremez (farklı pencere). Bu modül iki tarafın da kullandığı küçük
// `postMessage` protokolünü tanımlar:
//
//   OYUN  -> KABUK : { __ahududu: 1, kind: 'hello' }              oyun hazır
//                    { __ahududu: 1, kind: 'send', payload }      partnere yolla
//                    { __ahududu: 1, kind: 'state?', id }         durum sor
//                    { __ahududu: 1, kind: 'fullscreen' }         tam ekran iste
//                    { __ahududu: 1, kind: 'ping' }               hazır mı? (poll)
//   KABUK -> OYUN  : { __ahududu: 1, kind: 'ready' }              köprü hazır
//                    { __ahududu: 1, kind: 'recv', payload }      partnere paket
//                    { __ahududu: 1, kind: 'state', id, open }    durum yanıtı
//                    { __ahududu: 1, kind: 'pong' }
//
// Aynı belge (same-origin) durumunda iframe penceresine doğrudan
// `__ahududuGameBus` nesnesi de yazılır; oyun hangi yol varsa onu kullanır.

import { wsClient } from './websocket';

export const BRIDGE_TAG = '__ahududu';

/** Kabuk (üst sayfa) penceresinden gelen mesaj mı? */
export function isAhududuBridgeMessage(data: unknown): data is Record<string, unknown> {
  return Boolean(data && typeof data === 'object' && (data as Record<string, unknown>)[BRIDGE_TAG] === 1);
}

/**
 * Oyun iframe'i için köprüyü kurar. `currentUserId` paketlerin kime ait olduğunu
 * sunucu tarafında belirleyen soket kullanıcısıdır (log amaçlı da tutulur).
 */
export function installFrameBridge(
  frame: HTMLIFrameElement | null,
  currentUserId: string,
  send: (payload: unknown) => boolean,
  isOpen: () => boolean,
  requestFullscreen: () => void
): () => void {
  if (!frame) return () => undefined;
  const win = frame.contentWindow;

  const post = (msg: Record<string, unknown>) => {
    try {
      win?.postMessage({ [BRIDGE_TAG]: 1, ...msg }, '*');
    } catch {
      /* iframe kapanmış olabilir */
    }
  };

  const bus = {
    user: currentUserId,
    open: () => isOpen(),
    send: (payload: unknown) => {
      const ok = send(payload);
      if (!ok) post({ kind: 'state', id: -1, open: false });
      return ok;
    },
    requestFullscreen: () => requestFullscreen(),
  };
  // Same-origin: doğrudan nesne de erişilebilir olsun (postMessage'a ek).
  try {
    (win as unknown as { __ahududuGameBus?: typeof bus }).__ahududuGameBus = bus;
  } catch {
    /* farklı köken: postMessage yolu kullanılır */
  }

  const onMsg = (ev: MessageEvent) => {
    if (ev.source !== win) return;
    const d = ev.data;
    if (!isAhududuBridgeMessage(d)) return;
    switch (d.kind) {
      case 'hello':
      case 'ping':
        post({ kind: 'state', id: -1, open: bus.open() });
        if (bus.open()) post({ kind: 'ready' });
        break;
      case 'send':
        bus.send(d.payload);
        break;
      case 'state?':
        post({ kind: 'state', id: d.id, open: bus.open() });
        break;
      case 'fullscreen':
        bus.requestFullscreen();
        break;
      default:
        break;
    }
  };
  window.addEventListener('message', onMsg);

  // Soket açılıp kapandığında oyunu haberdar et: oyun kendi yedeğini bu
  // sinyale göre yönetiyor (bkz. 55_multiplayer.js onState).
  const unsubscribeStatus = wsClient.on('connection_status', (d: { connected?: boolean } | null) => {
    post({ kind: 'state', id: -1, open: Boolean(d?.connected) });
  });
  const unregisterOpen = wsClient.addOpenListener((open) => {
    post({ kind: 'state', id: -1, open });
  });

  return () => {
    window.removeEventListener('message', onMsg);
    unsubscribeStatus();
    unregisterOpen();
    try {
      const w = win as unknown as { __ahududuGameBus?: unknown } | null;
      if (w && w.__ahududuGameBus === bus) delete w.__ahududuGameBus;
    } catch {
      /* yok say */
    }
  };
}
