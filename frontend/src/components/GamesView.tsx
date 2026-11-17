import React from 'react';
import { UserId } from '../types';

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
      'İkiniz de aynı pistte olursunuz; arkadaşının arabası canlı görünür.',
      'Canlı kamera: sağ altta birbirini görürsün.',
      'Ses: "Basılı tut: konuş" ile konuşabilirsin.',
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
 * Oyunu tam ekran, sandık içi (iframe) bir çerçevede açar.
 * `?u=<kullanıcı>` oyunun hangi karakter olarak gireceğini belirler; böylece
 * iki telefonda iki ayrı oyuncu olarak aynı piste girilir.
 */
export const GamePlayer: React.FC<GamePlayerProps> = ({ game, currentUserId, onClose }) => {
  React.useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { type?: string } | null;
      if (d && d.type === 'ahududu:game-quit') onClose();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [onClose]);

  const src = `/games/${game.folder}/index.html?u=${currentUserId}&return=1`;

  return (
    <div className="fixed inset-0 z-[90] bg-black flex flex-col">
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 bg-black/90 border-b border-white/10"
        style={{ paddingTop: 'calc(var(--safe-top, 0px) + 0.5rem)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">{game.emoji}</span>
          <span className="font-serif text-sm font-bold text-white truncate">{game.title}</span>
        </div>
        <button
          onClick={onClose}
          className="shrink-0 px-3 py-1.5 rounded-full bg-white/12 text-white text-[11px] font-bold active:scale-95"
        >
          Çık ✕
        </button>
      </div>
      <iframe
        src={src}
        title={game.title}
        className="flex-1 w-full border-0 bg-black"
        allow="camera; microphone; fullscreen; gamepad; autoplay; screen-orientation"
        allowFullScreen
      />
    </div>
  );
};
