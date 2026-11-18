import React from 'react';
import { UserId } from '../types';
import { Capacitor } from '@capacitor/core';
import { StatusBar } from '@capacitor/status-bar';
import {
  registerBackHandler,
  getActiveServerUrl,
} from '../services/backButton';
import { installFrameBridge } from '../services/gameBridge';
import { wsClient } from '../services/websocket';

/** Oyun kataloğu: birden fazla oyun eklemek için buraya bir satır eklemek yeter. */
export interface GameEntry {
  id: string;
  /** Klasör adı: frontend/public/games/<folder>/index.html */
  folder: string;
  title: string;
  subtitle: string;
  emoji: string;
  accent: string;
  /** Oyun içi tarayıcı gereksinimi (WebGPU gibi) */
  requirement?: string;
  players: 'tek' | 'çift' | 'online-çift';
  notes?: string[];
}

export const GAMES: GameEntry[] = [
  {
    id: 'uno-com-escada',
    folder: 'uno-com-escada',
    title: 'Uno Merdivenli',
    subtitle: 'Fiat Uno Mille EP 1996 · dağ pisti · merdivenli',
    emoji: '🚗',
    accent: 'from-berry-500 to-rose-500',
    requirement: 'WebGPU (Chrome / Edge)',
    players: 'online-çift',
    notes: [
      'İkiniz aynı pistte olursunuz; sevgilinin arabası olarak (pembe) canlı görünür.',
      'İkiniz de "Başla"ya basınca 3-2-1 geri sayım aynı anda başlar, birlikte kalkarsınız.',
      'Ses: "Basılı tut: konuş" ile birbirinize seslenebilirsiniz.',
    ],
  },
];

export interface GamesListProps {
  currentUserId: UserId;
  onOpen: (game: GameEntry) => void;
}

/** Oyunlar sekmesi: eklediğimiz oyunların listesi. */
export const GamesList: React.FC<GamesListProps> = ({ currentUserId, onOpen }) => {
  return (
    <div className="flex flex-col space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-lg font-bold text-berry-950">Oyunlar 🎮</h2>
        <span className="text-[10px] font-semibold text-stone-500 px-2.5 py-1 rounded-full bg-rose-100/70">
          {GAMES.length} oyun
        </span>
      </div>

      {GAMES.map((game) => (
        <button
          key={game.id}
          onClick={() => onOpen(game)}
          className="w-full text-left rounded-3xl border border-rose-100 bg-white/90 shadow-sm p-4 active:scale-[0.98] transition-transform"
        >
          <div className="flex items-start gap-3">
            <div
              className={`w-12 h-12 shrink-0 rounded-2xl bg-gradient-to-br ${game.accent} flex items-center justify-center text-2xl shadow-sm`}
            >
              {game.emoji}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-serif text-base font-bold text-berry-950 truncate">
                {game.title}
              </h3>
              <p className="text-[11px] text-stone-500 mt-0.5">{game.subtitle}</p>
              <div className="flex flex-wrap items-center gap-1.5 mt-2">
                {game.players === 'online-çift' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    ● Beraber oyna
                  </span>
                )}
                {game.requirement && (
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    {game.requirement}
                  </span>
                )}
              </div>
            </div>
          </div>

          {game.notes && game.notes.length > 0 && (
            <ul className="mt-3 space-y-1">
              {game.notes.map((n) => (
                <li key={n} className="text-[11px] text-stone-600 flex gap-1.5">
                  <span className="text-berry-400">•</span>
                  <span className="min-w-0">{n}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] font-bold text-berry-700">Oyna ›</span>
            <span className="text-[10px] text-stone-400">{currentUserId === 'murat' ? 'Murat' : 'Selin'} olarak</span>
          </div>
        </button>
      ))}
    </div>
  );
};

export interface GamePlayerProps {
  game: GameEntry;
  currentUserId: UserId;
  onClose: () => void;
}

/**
 * Oyunu GERÇEK tam ekranda açar.
 *
 * Tam ekran için yapılanlar:
 *   1) Safari/Chrome tam ekranı: iframe yerine doğrudan oyunun kendi sayfası
 *      üst katmana taşınır (`document.fullscreenElement`). Böylece adres çubuğu
 *      ve durum çubuğu gizlenir; telefonda gerçek tam ekran olur. İzin
 *      verilmezse (iOS vb.) iframe yolu kullanılır — görünüm yine tam ekran.
 *   2) Native kabuk (Capacitor): Android'in immersive modu açılır (durum ve
 *      gezinme çubuğu gizlenir), yatay yön kilidi istenir.
 *   3) Uygulama alanına oturma: `viewport-fit=cover` + sabit konum sayesinde
 *      iframe her zaman ekranın TAMAMINI kaplar.
 *
 * Ohm çıkışta her şey eski hâline döner (durum çubuğu, tam ekran, kilidi).
 */
export const GamePlayer: React.FC<GamePlayerProps> = ({ game, currentUserId, onClose }) => {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const nativeRef = React.useRef<{ immersive: boolean; orientation: string | null }>({
    immersive: false,
    orientation: null,
  });
  const isNative = Capacitor.isNativePlatform();

  /** Sunucu adresini (native'de canlı sunucu) tek yerden çöz. */
  const serverBase = (): string => {
    try {
      const url = getActiveServerUrl();
      if (url) return url.replace(/\/+$/, '');
    } catch {
      /* yok say */
    }
    if (window.location.protocol.startsWith('http')) {
      return `${window.location.origin}`;
    }
    return 'https://ahududu.fakeyol.com';
  };

  const gameUrl = React.useMemo(
    () => `${serverBase()}/games/${game.folder}/index.html?u=${currentUserId}&return=1`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game.folder, currentUserId]
  );

  // ---- 1) Açılış: native immersive + yatay kilit ----
  React.useEffect(() => {
    const enterNative = async () => {
      if (!isNative) return;
      try {
        await StatusBar.hide();
        nativeRef.current.immersive = true;
      } catch {
        /* eski kabuk: sessizce geç */
      }
      try {
        const so = screen.orientation as any;
        if (so && typeof so.lock === 'function') {
          await so.lock('landscape');
          nativeRef.current.orientation = 'locked';
        }
      } catch {
        /* kilit desteklenmiyor */
      }
    };
    void enterNative();
    return () => {
      // ---- Çıkış: her şeyi geri al ----
      if (nativeRef.current.immersive) {
        void StatusBar.show().catch(() => undefined);
        nativeRef.current.immersive = false;
      }
      if (nativeRef.current.orientation) {
        try {
          const so = screen.orientation as any;
          if (so && typeof so.unlock === 'function') so.unlock();
        } catch {
          /* yok say */
        }
        nativeRef.current.orientation = null;
      }
      try {
        if (document.fullscreenElement) void document.exitFullscreen();
      } catch {
        /* yok say */
      }
    };
  }, [isNative]);

  // ---- 2) Oyun mesajları: çık / geri ----
  React.useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { type?: string } | null;
      if (d && (d.type === 'ahududu:game-quit' || d.type === 'ahududu:game-back')) onCloseRef.current();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ---- 3) Donanım geri tuşu: oyun açıkken uygulamadan çıkmasın ----
  React.useEffect(() => {
    const unregister = registerBackHandler(() => {
      onCloseRef.current();
      return true;
    });
    return () => unregister();
  }, []);

  /** Üst sayfadaki soketten gelen `game_*` paketlerini oyun iframe'ine ilet. */
  const forwardToFrame = React.useRef<(payload: unknown) => void>(() => undefined);
  React.useEffect(() => {
    // wsClient iki tarafı da görür: sunucu paketi partnere iletir, gelen paket
    // her iki uçta da buraya düşer. Oyun kendi kimliğiyle gelen yankıyı zaten
    // `from` alanından ayıklıyor.
    const unsubscribe = wsClient.on('*', (data: Record<string, unknown>) => {
      if (typeof data?.type !== 'string' || !data.type.startsWith('game_')) return;
      forwardToFrame.current(data);
    });
    return () => unsubscribe();
  }, []);

  // ---- 4) Oyun ↔ kabuk köprüsü ----
  // Yalnızca `window.__ahududuGameBus` yazmak YETMEZ: oyun ayrı bir iframe
  // penceresinde çalışır ve kabuğun `window`'unu hiçbir zaman göremez. Bu
  // yüzden köprü postMessage ile kurulur (bkz. services/gameBridge.ts);
  // aynı köken durumunda nesne de iframe penceresine yazılır.
  const goFullscreenRef = React.useRef<() => void>(() => undefined);
  React.useEffect(() => {
    const upload = (payload: unknown) => {
      try {
        return wsClient.send(payload);
      } catch (e) {
        console.warn('[Ahududu Games] paket gönderilemedi:', e);
        return false;
      }
    };
    const cleanup = installFrameBridge(
      frameRef.current,
      currentUserId,
      upload,
      () => wsClient.isOpen(),
      () => goFullscreenRef.current()
    );
    forwardToFrame.current = (payload: unknown) => {
      try {
        frameRef.current?.contentWindow?.postMessage({ __ahududu: 1, kind: 'recv', payload }, '*');
      } catch {
        /* yok say */
      }
    };
    return () => {
      forwardToFrame.current = () => undefined;
      cleanup();
    };
  }, [currentUserId]);

  const goFullscreen = async () => {
    // Önce iframe'i (varsa) tam ekrana al: adres çubuğu ve durum çubuğu gizlenir.
    const el = frameRef.current;
    if (!el) return;
    try {
      const anyEl = el as HTMLIFrameElement & {
        webkitRequestFullscreen?: () => Promise<void> | void;
      };
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return;
      }
      if (el.requestFullscreen) {
        await el.requestFullscreen({ navigationUI: 'hide' });
      } else if (anyEl.webkitRequestFullscreen) {
        await anyEl.webkitRequestFullscreen();
      }
    } catch {
      /* izin yok (iOS Safari): iframe zaten tam ekran boyutunda */
    }
  };

  // Oyun "tam ekran" istediğinde köprüden çağrılır (güncel fonksiyonu tutar).
  React.useEffect(() => {
    goFullscreenRef.current = () => void goFullscreen();
  });

  // Açılır açılmaz tam ekrana girmeyi dene (tarayıcı kullanıcı hareketi
  // istiyorsa sessizce başarısız olur; "Tam ekran" düğmesi her zaman var).
  React.useEffect(() => {
    if (isNative) return; // native: immersive mod zaten tam ekran
    const t = setTimeout(() => {
      void goFullscreen();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className="fixed inset-0 z-[95] bg-black flex flex-col"
      style={{
        // Uygulamanın gövde dolgusu (güvenli alan) oyunu küçültmesin
        marginLeft: 'calc(-1 * var(--safe-left, 0px))',
        marginRight: 'calc(-1 * var(--safe-right, 0px))',
        width: 'calc(100% + var(--safe-left, 0px) + var(--safe-right, 0px))',
      }}
    >
      {/* Üst şerit: 44 px'e indirildi ve yalnızca çıkış düğmesi kaldı →
          oyun alanı telefonda neredeyse tam ekran. */}
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 bg-black border-b border-white/10"
        style={{ paddingTop: 'calc(var(--safe-top, 0px) + 0.375rem)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">{game.emoji}</span>
          <span className="font-serif text-sm font-bold text-white truncate">{game.title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => void goFullscreen()}
            className="px-2.5 py-1.5 rounded-full bg-white/12 text-white text-[11px] font-bold active:scale-95"
            aria-label="Tam ekran"
          >
            ⛶
          </button>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-full bg-white/12 text-white text-[11px] font-bold active:scale-95"
          >
            Çık ✕
          </button>
        </div>
      </div>
      <iframe
        ref={frameRef}
        src={gameUrl}
        title={game.title}
        className="flex-1 w-full border-0 bg-black"
        // Kamera İZNİ KALDIRILDI (oyundaki kamera sistemi silindi). Mikrofon
        // yalnızca "basılı tut: konuş" için kullanılır.
        allow="microphone; fullscreen; gamepad; autoplay; screen-orientation"
        allowFullScreen
        style={{ touchAction: 'none' }}
      />
    </div>
  );
};

