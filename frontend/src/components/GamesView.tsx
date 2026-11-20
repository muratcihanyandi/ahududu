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
import { updates } from '../services/updates';
import { playHaptic } from '../services/haptics';

export type GameCategory = 'tumu' | 'dunya' | 'strateji' | 'aksiyon' | 'bulmaca' | 'parti';

/** Oyun kataloğu: birden fazla oyun eklemek için buraya bir satır eklemek yeter. */
export interface GameEntry {
  id: string;
  /** Klasör adı: frontend/public/games/<folder>/index.html */
  folder: string;
  /** Sunucu alt yolu (örn. /ext/<oyun>/) varsa doğrudan bu adres açılır. */
  externalPath?: string;
  title: string;
  subtitle: string;
  emoji: string;
  accent: string;
  category: Exclude<GameCategory, 'tumu'>;
  orientation: 'landscape' | 'portrait' | 'any';
  durationLabel?: string;
  /** Oyun içi teknik gereksinim alanı. Arayüzde gösterilmez. */
  requirement?: string;
  players: 'tek' | 'çift' | 'online-çift';
  notes?: string[];
}

export interface PartnerGamePresence {
  game: string;
  title?: string;
  emoji?: string;
}

const CATEGORIES: { id: GameCategory; label: string }[] = [
  { id: 'tumu', label: 'Tümü' },
  { id: 'strateji', label: 'Strateji' },
  { id: 'aksiyon', label: 'Aksiyon' },
  { id: 'bulmaca', label: 'Bulmaca' },
  { id: 'parti', label: 'Parti' },
];

/** Kullanıcıya gösterilen oyunlar: teknik detay yok. */
export const GAMES: GameEntry[] = [
  {
    id: 'uno-com-escada',
    folder: 'uno-com-escada',
    title: 'Uno Merdivenli',
    subtitle: 'Dağ pistinde araba yarışı',
    emoji: '🚗',
    accent: 'from-berry-500 to-rose-500',
    category: 'aksiyon',
    orientation: 'landscape',
    durationLabel: 'Serbest',
    players: 'online-çift',
    notes: [
      'Tek başına da oynayabilirsin; partnerin oyunu açınca arabası pistte belirir.',
      'İkiniz "Başla"ya basınca birlikte kalkarsınız.',
    ],
  },
  {
    id: 'chess-duel',
    folder: 'chess-duel',
    title: 'Satranç Düellosu',
    subtitle: 'Klasik tahta, canlı saat ve hamle yarışı',
    emoji: '♟️',
    accent: 'from-amber-600 to-rose-700',
    category: 'strateji',
    orientation: 'portrait',
    durationLabel: '5-15 dk',
    players: 'online-çift',
    notes: [
      'Kendi tarafın hep altta görünür; her maç renkler değişir.',
      'Süre seçebilir, geri alma ya da beraberlik önerebilirsin.',
    ],
  },
  {
    id: 'battle-2048',
    folder: 'battle-2048',
    title: '2048 Düellosu',
    subtitle: 'Büyük taşları birleştir, rakibine buz gönder',
    emoji: '🔢',
    accent: 'from-orange-500 to-rose-500',
    category: 'bulmaca',
    orientation: 'portrait',
    durationLabel: '3-5 dk',
    players: 'online-çift',
    notes: [
      'Saldırı modunda 128+ birleştirince rakibe donmuş karo gider.',
      '3 dakikalık yarışta ikiniz aynı başlangıçla skor yarıştırırsınız.',
    ],
  },
  {
    id: 'blok-duello',
    folder: 'blok-duello',
    title: 'Blok Düellosu',
    subtitle: 'Satırları temizle, rakibin alanını doldur',
    emoji: '🧱',
    accent: 'from-violet-600 to-fuchsia-600',
    category: 'aksiyon',
    orientation: 'portrait',
    durationLabel: '3-6 dk',
    players: 'online-çift',
    notes: [
      'Aynı anda 2, 3 ya da 4 satır silerek rakibe engel satırı yolla.',
      'Üstte rakibinin tahtasını canlı takip edebilirsin.',
    ],
  },
  {
    id: 'neon-air-hockey',
    folder: 'neon-air-hockey',
    title: 'Neon Hava Hokeyi',
    subtitle: 'Hızlı refleks, 7 golde maç biter',
    emoji: '🏒',
    accent: 'from-sky-500 to-berry-500',
    category: 'aksiyon',
    orientation: 'portrait',
    durationLabel: '2-4 dk',
    players: 'online-çift',
    notes: [
      'Parmağınla raketini sürükle, diski kaleye yolla.',
      'İkiniz de kendi kalenizi altta görürsünüz.',
    ],
  },
  {
    id: 'ciz-tahmin',
    folder: 'ciz-tahmin',
    title: 'Çiz & Tahmin Et',
    subtitle: 'Biri çizsin, diğeri kelimeyi bulsun',
    emoji: '🎨',
    accent: 'from-pink-500 to-amber-500',
    category: 'parti',
    orientation: 'portrait',
    durationLabel: '5-8 dk',
    players: 'online-çift',
    notes: [
      'Çizdiklerin anlık olarak ekranda belirir; 6 turda sırayla çizim yapılır.',
      'Beklerken ortak tahtada birlikte serbestçe karalayabilirsiniz.',
    ],
  },
  {
    id: 'amiral-batti',
    folder: 'amiral-batti',
    title: 'Amiral Battı',
    subtitle: 'Filonu gizle, rakip gemileri batır',
    emoji: '⚓',
    accent: 'from-teal-600 to-cyan-700',
    category: 'strateji',
    orientation: 'portrait',
    durationLabel: '5-10 dk',
    players: 'online-çift',
    notes: [
      '5 gemini 10×10 alana diz; isabet edince bir atış hakkı daha kazan.',
      'Tek başına beklerken de akıllı rakiple pratik yapabilirsin.',
    ],
  },
];

export interface GamesListProps {
  currentUserId: UserId;
  onOpen: (game: GameEntry) => void;
  partnerActiveGame?: PartnerGamePresence | null;
  isPartnerOnline?: boolean;
  onInvite?: (game: GameEntry) => void;
}

/** Oyunlar sekmesi: cok oyunculu oyun lobisi. */
export const GamesList: React.FC<GamesListProps> = ({
  currentUserId,
  onOpen,
  partnerActiveGame = null,
  isPartnerOnline = false,
  onInvite,
}) => {
  const [category, setCategory] = React.useState<GameCategory>('tumu');
  const [invitedId, setInvitedId] = React.useState<string | null>(null);
  const inviteTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    return () => {
      if (inviteTimerRef.current !== null) {
        window.clearTimeout(inviteTimerRef.current);
      }
    };
  }, []);

  const partnerName = currentUserId === 'murat' ? 'Selin' : 'Murat';
  const activePartnerEntry = partnerActiveGame
    ? GAMES.find((g) => g.id === partnerActiveGame.game)
    : undefined;

  const filteredGames = React.useMemo(
    () => (category === 'tumu' ? GAMES : GAMES.filter((g) => g.category === category)),
    [category]
  );

  const sendInvite = (e: React.MouseEvent, game: GameEntry) => {
    e.stopPropagation();
    playHaptic(20);
    if (onInvite) {
      onInvite(game);
    } else {
      wsClient.send({
        type: 'game_invite',
        game: game.id,
        title: game.title,
        emoji: game.emoji,
      });
    }
    setInvitedId(game.id);
    if (inviteTimerRef.current !== null) {
      window.clearTimeout(inviteTimerRef.current);
    }
    inviteTimerRef.current = window.setTimeout(() => setInvitedId(null), 2500);
  };

  return (
    <div className="flex flex-col space-y-3.5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-serif text-lg font-bold text-berry-950">Oyunlar 🎮</h2>
          <p className="text-[11px] text-stone-500">
            Hepsi ikiniz için canlı çok oyunculu
          </p>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${
            isPartnerOnline
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-white/80 text-stone-500 border-rose-100'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              isPartnerOnline ? 'bg-emerald-500 animate-pulse' : 'bg-stone-300'
            }`}
          />
          {partnerName} {isPartnerOnline ? 'çevrimiçi' : 'çevrimdışı'}
        </span>
      </div>

      {/* Partner şu an bir oyundaysa anında katılma kartı */}
      {partnerActiveGame && (
        <div
          onClick={() => {
            if (activePartnerEntry) onOpen(activePartnerEntry);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && activePartnerEntry) {
              e.preventDefault();
              onOpen(activePartnerEntry);
            }
          }}
          className="w-full rounded-3xl p-3.5 bg-gradient-to-r from-berry-600 to-rose-500 text-white shadow-lg shadow-berry-600/20 flex items-center justify-between gap-3 cursor-pointer active:scale-[0.98] transition-transform"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center text-2xl shrink-0">
              {activePartnerEntry?.emoji || partnerActiveGame.emoji || '🎮'}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-rose-100">
                <span className="w-2 h-2 rounded-full bg-emerald-300 animate-ping" />
                <span>Canlı Oyun</span>
              </div>
              <p className="text-sm font-bold truncate">
                {partnerName} şu an{' '}
                {activePartnerEntry?.title || partnerActiveGame.title || 'oyun'} oynuyor
              </p>
            </div>
          </div>
          {activePartnerEntry && (
            <span className="shrink-0 px-3 py-1.5 rounded-full bg-white text-berry-700 text-xs font-bold shadow-xs">
              Hemen Katıl ›
            </span>
          )}
        </div>
      )}

      {/* Kategori filtreleri */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
        {CATEGORIES.map((cat) => {
          const active = category === cat.id;
          const count =
            cat.id === 'tumu'
              ? GAMES.length
              : GAMES.filter((g) => g.category === cat.id).length;
          return (
            <button
              key={cat.id}
              type="button"
              data-category={cat.id}
              onClick={() => {
                playHaptic(12);
                setCategory(cat.id);
              }}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                active
                  ? 'bg-gradient-to-r from-berry-500 to-rose-500 text-white shadow-sm'
                  : 'bg-white/85 text-stone-600 border border-rose-100 hover:border-rose-200'
              }`}
            >
              {cat.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Oyun kartları */}
      <div className="flex flex-col space-y-3">
        {filteredGames.map((game) => {
          const isPartnerHere = partnerActiveGame?.game === game.id;
          const justInvited = invitedId === game.id;
          return (
            <div
              key={game.id}
              data-game-id={game.id}
              role="button"
              tabIndex={0}
              onClick={() => onOpen(game)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onOpen(game);
                }
              }}
              className={`w-full text-left rounded-3xl border bg-white/92 shadow-sm p-4 cursor-pointer active:scale-[0.985] transition-transform ${
                isPartnerHere
                  ? 'border-emerald-300 ring-2 ring-emerald-200/70'
                  : 'border-rose-100'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`w-12 h-12 shrink-0 rounded-2xl bg-gradient-to-br ${game.accent} flex items-center justify-center text-2xl shadow-sm`}
                >
                  {game.emoji}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-serif text-base font-bold text-berry-950 truncate">
                      {game.title}
                    </h3>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isPartnerHere && (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold">
                          🟢 İçeride
                        </span>
                      )}
                      {game.durationLabel && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-50 text-berry-700 text-[10px] font-semibold border border-rose-100">
                          {game.durationLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-stone-500 mt-0.5">{game.subtitle}</p>
                </div>
              </div>

              {game.notes && game.notes.length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {game.notes.slice(0, 2).map((n) => (
                    <li key={n} className="text-[11px] text-stone-600 flex gap-1.5">
                      <span className="text-berry-400">•</span>
                      <span className="min-w-0">{n}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-3 pt-2.5 border-t border-rose-50 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-berry-700">
                  {isPartnerHere ? `${partnerName}'e Katıl ›` : 'Oyna ›'}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-stone-400">
                    {currentUserId === 'murat' ? 'Murat' : 'Selin'} olarak
                  </span>
                  <button
                    type="button"
                    onClick={(e) => sendInvite(e, game)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all active:scale-95 ${
                      justInvited
                        ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-berry-700 border border-rose-200 hover:bg-rose-100'
                    }`}
                  >
                    {justInvited ? 'Davet yollandı ✓' : 'Davet Et 💌'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export interface GamePlayerProps {
  game: GameEntry;
  currentUserId: UserId;
  onClose: () => void;
}

/**
 * Oyunu gercek tam ekranda acar, soket koprusunu kurar ve canli varligi bildirir.
 */
export const GamePlayer: React.FC<GamePlayerProps> = ({ game, currentUserId, onClose }) => {
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const frameRef = React.useRef<HTMLIFrameElement | null>(null);
  const nativeRef = React.useRef<{ immersive: boolean; orientation: string | null }>({
    immersive: false,
    orientation: null,
  });
  const [inviteSent, setInviteSent] = React.useState(false);
  const inviteTimerRef = React.useRef<number | null>(null);
  const isNative = Capacitor.isNativePlatform();

  React.useEffect(() => {
    return () => {
      if (inviteTimerRef.current !== null) {
        window.clearTimeout(inviteTimerRef.current);
      }
    };
  }, []);

  /** Sunucu adresini (native'de canli sunucu) tek yerden coz. */
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
    () =>
      game.externalPath
        ? `${serverBase()}${game.externalPath}?u=${currentUserId}&return=1`
        : `${serverBase()}/games/${game.folder}/index.html?u=${currentUserId}&return=1`,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game.folder, game.externalPath, currentUserId]
  );

  // ---- 0) Oyun acikken OTA yenilemesini durdur ----
  React.useEffect(() => {
    updates.setBusy(true);
    return () => updates.setBusy(false);
  }, []);

  // ---- 1) Acilis: native immersive + oyuna uygun ekran yon kilidi ----
  React.useEffect(() => {
    let cancelled = false;
    const enterNative = async () => {
      if (!isNative) return;
      try {
        await StatusBar.hide();
        if (cancelled) {
          void StatusBar.show().catch(() => undefined);
          return;
        }
        nativeRef.current.immersive = true;
      } catch {
        /* eski kabuk: sessizce gec */
      }
      if (game.orientation === 'any') return;
      try {
        const so = screen.orientation as any;
        if (so && typeof so.lock === 'function') {
          await so.lock(game.orientation === 'landscape' ? 'landscape' : 'portrait');
          if (cancelled) {
            if (typeof so.unlock === 'function') so.unlock();
            return;
          }
          nativeRef.current.orientation = 'locked';
        }
      } catch {
        /* kilit desteklenmiyor */
      }
    };
    void enterNative();
    return () => {
      cancelled = true;
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
  }, [isNative, game.orientation]);

  // ---- 2) Oyun mesajlari: cik / geri ----
  React.useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const frameWin = frameRef.current?.contentWindow;
      if (frameWin && ev.source !== frameWin) return;
      const d = ev.data as { type?: string } | null;
      if (d && (d.type === 'ahududu:game-quit' || d.type === 'ahududu:game-back')) {
        onCloseRef.current();
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // ---- 3) Donanim geri tusu: oyun acikken uygulamadan cikmasin ----
  React.useEffect(() => {
    const unregister = registerBackHandler(() => {
      onCloseRef.current();
      return true;
    });
    return () => unregister();
  }, []);

  // ---- 4) Canli oyun varligi (presence) ----
  React.useEffect(() => {
    const announce = () => {
      wsClient.send({
        type: 'game_presence',
        game: game.id,
        title: game.title,
        emoji: game.emoji,
      });
    };
    announce();
    const unregOpen = wsClient.addOpenListener((open) => {
      if (open) announce();
    });
    return () => {
      unregOpen();
      wsClient.send({ type: 'game_presence', game: null });
      wsClient.send({ type: 'game_bye', game: game.id });
    };
  }, [game.id, game.title, game.emoji]);

  /** Ust sayfadaki soketten gelen paketleri yalnizca ilgili oyunun iframe'ine ilet. */
  const forwardToFrame = React.useRef<(payload: unknown) => void>(() => undefined);
  React.useEffect(() => {
    const unsubscribe = wsClient.on('*', (data: Record<string, unknown>) => {
      if (typeof data?.type !== 'string' || !data.type.startsWith('game_')) return;
      const pktGame = typeof data.game === 'string' ? data.game : '';
      if (pktGame && pktGame !== game.id) return;
      if (!pktGame && game.id !== 'uno-com-escada') return;
      forwardToFrame.current(data);
    });
    return () => unsubscribe();
  }, [game.id]);

  // ---- 5) Oyun <-> kabuk koprusu ----
  const goFullscreenRef = React.useRef<() => void>(() => undefined);
  React.useEffect(() => {
    const upload = (payload: unknown) => {
      try {
        return wsClient.send(payload);
      } catch (e) {
        console.warn('[Ahududu Games] paket gonderilemedi:', e);
        return false;
      }
    };
    const cleanup = installFrameBridge(
      frameRef.current,
      currentUserId,
      upload,
      () => wsClient.isOpen(),
      () => goFullscreenRef.current(),
      () => onCloseRef.current()
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

  React.useEffect(() => {
    goFullscreenRef.current = () => void goFullscreen();
  });

  React.useEffect(() => {
    if (isNative) return;
    const t = setTimeout(() => {
      void goFullscreen();
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendPlayerInvite = () => {
    playHaptic(20);
    wsClient.send({
      type: 'game_invite',
      game: game.id,
      title: game.title,
      emoji: game.emoji,
    });
    setInviteSent(true);
    if (inviteTimerRef.current !== null) {
      window.clearTimeout(inviteTimerRef.current);
    }
    inviteTimerRef.current = window.setTimeout(() => setInviteSent(false), 2500);
  };

  return (
    <div
      className="fixed inset-0 z-[95] bg-black flex flex-col"
      style={{
        marginLeft: 'calc(-1 * var(--safe-left, 0px))',
        marginRight: 'calc(-1 * var(--safe-right, 0px))',
        width: 'calc(100% + var(--safe-left, 0px) + var(--safe-right, 0px))',
      }}
    >
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
            type="button"
            onClick={sendPlayerInvite}
            className="px-2.5 py-1.5 rounded-full bg-white/12 text-white text-[11px] font-bold active:scale-95"
          >
            {inviteSent ? '✓' : '💌 Davet'}
          </button>
          <button
            type="button"
            onClick={() => void goFullscreen()}
            className="px-2.5 py-1.5 rounded-full bg-white/12 text-white text-[11px] font-bold active:scale-95"
            aria-label="Tam ekran"
          >
            ⛶
          </button>
          <button
            type="button"
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
        allow="microphone; fullscreen; gamepad; autoplay; screen-orientation"
        allowFullScreen
        style={{ touchAction: 'none' }}
      />
    </div>
  );
};
