import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, RotateCcw, Loader2, Film,
} from 'lucide-react';
import { CinemaRoom } from '../types';
import { mediaUrl } from '../services/api';
import { playHaptic } from '../services/haptics';
import {
  PlaybackState,
  SyncEngine,
  clampPosition,
  compensateLatency,
  expectedPosition,
  formatTime,
} from '../services/cinemaSync';
import {
  AdapterEvents,
  HTML5PlayerAdapter,
  PlayerAdapter,
  VimeoPlayerAdapter,
  YouTubePlayerAdapter,
  detectPlayerSource,
  extractYouTubeId,
  extractYouTubeStart,
  vimeoApiUrl,
} from '../services/youtubePlayer';

/**
 * Sinema perdesindeki oynatıcı — senkron motorlu.
 *
 * Kaynak ne olursa olsun (mp4/m3u8 dosyası, YouTube, Vimeo) aynı `SyncEngine`
 * ile sürülür:
 *   - Sunucudan gelen durum (position/is_playing) RTT/2 kadar ileri alınır.
 *   - Kademeli düzeltme: hizalıysa dokunmaz, küçük sapmada hızı %10 kaydırır,
 *     büyük sapmada 5 sn cooldown ile sarma yapar.
 *   - Late-join: oynatıcı hazır olana kadar durum bekletilir.
 *   - Programatik çağrıların yankısı adaptör içinde susturulur.
 *
 * Tasarım (perde, alt bar, yükleniyor/tepki görünümü) aynen korunur.
 */
export interface CinemaStageProps {
  room: CinemaRoom;
  state: PlaybackState;
  /** Oynatıcının kendi durum bildirimi (sunucuya yazılmaz). */
  onStateChange: (next: Partial<PlaybackState>) => void;
  onUserPlayPause: (shouldPlay: boolean) => void;
  onUserSeek: (position: number) => void;
  onReady?: (duration: number) => void;
  /** Ağ gecikmesi (ms) — ping/pong ile ölçülür. */
  latencyMs?: number;
}

const TICK_MS = 1000;

export const CinemaStage: React.FC<CinemaStageProps> = ({
  room,
  state,
  onStateChange,
  onUserPlayPause,
  onUserSeek,
  onReady,
  latencyMs = 120,
}) => {
  const source = useMemo(
    () =>
      detectPlayerSource({
        video_url: room.video_url,
        embed_url: room.embed_url,
        source: room.source,
        kind: room.kind,
      }),
    [room.video_url, room.embed_url, room.source, room.kind]
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const embedHostRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(room.duration || 0);
  const [blockedAutoplay, setBlockedAutoplay] = useState(false);

  /** Kullanıcı eylemlerini sunucuya yayınla (kendi yankımızı susturur). */
  const publishPlayPause = useCallback(
    (playing: boolean) => {
      engineRef.current?.noteLocalAction();
      onUserPlayPause(playing);
    },
    [onUserPlayPause]
  );

  const publishSeek = useCallback(
    (position: number) => {
      engineRef.current?.noteLocalAction(true);
      onUserSeek(position);
    },
    [onUserSeek]
  );

  const events: AdapterEvents = useMemo(
    () => ({
      onReady: (dur) => {
        setReady(true);
        if (dur > 0) setDuration(dur);
        engineRef.current?.markReady();
        if (dur > 0) onReady?.(dur);
      },
      onDuration: (dur) => {
        if (dur > 0) setDuration(dur);
      },
      onUserPlay: () => publishPlayPause(true),
      onUserPause: () => publishPlayPause(false),
      onUserSeek: (position) => publishSeek(position),
      onBuffering: () => {
        /* tampon durumu motor içinde değerlendirilir */
      },
      onEnded: () => {
        onStateChange({ isPlaying: false, position: 0 });
      },
      onAutoplayBlocked: () => setBlockedAutoplay(true),
      onError: (message) => setError(message),
    }),
    [onReady, onStateChange, publishPlayPause, publishSeek]
  );

  /* ------------------------------------------------------------------ */
  /* Oynatıcıyı kur                                                      */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    let adapter: PlayerAdapter | null = null;
    let destroyed = false;

    const engine = new SyncEngine({ latencyMs });
    engineRef.current = engine;

    const attach = (created: PlayerAdapter) => {
      if (destroyed) {
        created.destroy?.();
        return;
      }
      adapter = created;
      engine.attach(created);
      if (created.isReady()) engine.markReady();
    };

    if (source === 'html5' && videoRef.current) {
      attach(new HTML5PlayerAdapter(videoRef.current, events));
    } else if (source === 'youtube') {
      const videoId =
        extractYouTubeId(room.embed_url || '') || extractYouTubeId(room.video_url || '');
      const host = embedHostRef.current;
      if (videoId && host) {
        const yt = new YouTubePlayerAdapter({
          videoId,
          container: host,
          events,
          startSeconds: extractYouTubeStart(room.video_url) || state.position || 0,
        });
        yt.init().catch((e) => {
          if (!destroyed) setError(e?.message || 'YouTube videosu açılamadı 🎬');
        });
        attach(yt);
      } else {
        setError('Bu YouTube bağlantısı çözümlenemedi 🎬');
      }
    } else if (source === 'vimeo' && iframeRef.current) {
      attach(new VimeoPlayerAdapter(iframeRef.current, events));
    }

    return () => {
      destroyed = true;
      engine.detach();
      adapter?.destroy?.();
      if (engineRef.current === engine) engineRef.current = null;
      setReady(false);
      setError(null);
      setBlockedAutoplay(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, room.id]);

  /* ------------------------------------------------------------------ */
  /* Sunucu/partner durumu değişti → motora ver                          */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setLatency(latencyMs);
    engine.applyState(
      compensateLatency(
        {
          position: state.position,
          isPlaying: state.isPlaying,
          duration: state.duration || duration || undefined,
        },
        latencyMs
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.position, state.isPlaying, state.anchorMs, latencyMs]);

  /* ------------------------------------------------------------------ */
  /* Periyodik düzeltme + zaman göstergesi                               */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      engine.tick();
      const adapter = engine.getAdapter();
      if (adapter) {
        setCurrentTime(adapter.getTime());
        const dur = adapter.getDuration();
        if (dur > 0 && Math.abs(dur - duration) > 0.5) setDuration(dur);
        onStateChange({ position: adapter.getTime(), duration: dur });
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [duration, onStateChange]);

  /* ------------------------------------------------------------------ */
  /* Kontroller                                                          */
  /* ------------------------------------------------------------------ */
  const adapterNow = () => engineRef.current?.getAdapter() ?? null;

  const togglePlay = () => {
    const playing = !state.isPlaying;
    const adapter = adapterNow();
    if (adapter) {
      if (playing) adapter.play();
      else adapter.pause();
    }
    publishPlayPause(playing);
  };

  const seekTo = (next: number) => {
    const target = clampPosition(next, duration || state.duration);
    adapterNow()?.setTime(target);
    setCurrentTime(target);
    publishSeek(target);
  };

  const seekBy = (delta: number) => {
    const adapter = adapterNow();
    const from = adapter ? adapter.getTime() : state.position;
    seekTo(from + delta);
  };

  const toggleMute = () => {
    const adapter = adapterNow();
    const next = !muted;
    adapter?.setMuted?.(next);
    setMuted(next);
    playHaptic(12);
  };

  const totalDuration = duration || state.duration || 0;
  const progress = totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0;

  return (
    <div className="w-full h-full absolute inset-0 bg-black">
      {/* ---- html5: doğrudan video ---- */}
      {source === 'html5' && (
        <video
          ref={videoRef}
          src={mediaUrl(room.video_url)}
          playsInline
          preload="auto"
          className={`absolute inset-0 w-full h-full object-contain transition-all duration-700 ${
            state.isPlaying ? '' : 'opacity-60 blur-[1px] scale-[1.01]'
          }`}
          muted={muted}
        />
      )}

      {/* ---- YouTube: IFrame Player API kapsayıcısı ---- */}
      {source === 'youtube' && <div ref={embedHostRef} className="absolute inset-0 w-full h-full" />}

      {/* ---- Vimeo: postMessage API'li iframe ---- */}
      {source === 'vimeo' && (
        <iframe
          ref={iframeRef}
          src={vimeoApiUrl(room.embed_url || room.video_url)}
          className="absolute inset-0 w-full h-full border-0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          title={room.title}
        />
      )}

      {/* ---- Bilinmeyen gömme: senkronsuz düz iframe (perde boş kalmasın) ---- */}
      {source === 'unsupported' && (
        <iframe
          src={room.embed_url || room.video_url}
          className="absolute inset-0 w-full h-full border-0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          title={room.title}
        />
      )}

      {!ready && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-cinema-950/70">
          <Loader2 className="w-10 h-10 text-amber-300 animate-spin" />
          <p className="text-amber-100/80 text-xs font-semibold tracking-[0.2em] uppercase">
            Perde hazırlanıyor
          </p>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center px-8">
          <Film className="w-12 h-12 text-rose-300/70" />
          <p className="text-white font-serif text-base">{error}</p>
          <a
            href={room.video_url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 px-3 py-1.5 rounded-full bg-amber-400 text-cinema-950 text-[10px] font-bold"
          >
            Bağlantıda aç ↗
          </a>
        </div>
      )}

      {blockedAutoplay && !error && (
        <button
          onClick={() => {
            const adapter = adapterNow();
            adapter?.setMuted?.(false);
            setMuted(false);
            adapter?.play();
            setBlockedAutoplay(false);
          }}
          className="absolute left-1/2 -translate-x-1/2 top-3 z-30 px-3.5 py-2 rounded-full bg-amber-400 text-cinema-950 text-[11px] font-bold shadow-lg animate-pulse"
        >
          🔇 Sesi aç
        </button>
      )}

      {/* Sinema alt barı */}
      <div className="absolute inset-x-0 bottom-0 z-20 px-4 pb-3 pt-10 bg-gradient-to-t from-black/90 via-black/50 to-transparent">
        <div className="flex items-center gap-3 max-w-3xl mx-auto">
          <button
            onClick={() => {
              playHaptic(18);
              seekBy(-10);
            }}
            className="p-2 rounded-full text-white/85 hover:text-white"
            title="10 saniye geri"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
          <button
            onClick={togglePlay}
            className="w-11 h-11 rounded-full bg-amber-400 text-cinema-950 flex items-center justify-center shadow-lg shadow-amber-400/30 active:scale-95"
            title={state.isPlaying ? 'Duraklat' : 'Oynat'}
          >
            {state.isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </button>
          <button
            onClick={() => {
              playHaptic(18);
              seekBy(10);
            }}
            className="p-2 rounded-full text-white/85 hover:text-white"
            title="10 saniye ileri"
          >
            <SkipForward className="w-4 h-4" />
          </button>

          <span className="text-[10px] text-white/70 font-mono tabular-nums w-9 text-right">
            {formatTime(currentTime)}
          </span>

          <button
            onClick={(e) => {
              const el = e.currentTarget as HTMLElement;
              const rect = el.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              seekTo(ratio * totalDuration);
            }}
            className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden relative"
            title="Sarma"
          >
            <span
              className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-amber-300 to-rose-400"
              style={{ width: `${progress}%` }}
            >
              <span className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white shadow" />
            </span>
          </button>
          <span className="text-[10px] text-white/50 font-mono tabular-nums w-9">
            {formatTime(totalDuration)}
          </span>

          <button
            onClick={toggleMute}
            className="p-2 rounded-full text-white/85 hover:text-white"
            title={muted ? 'Sesi aç' : 'Sesi kapat'}
          >
            {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <button
            onClick={() => {
              playHaptic(18);
              seekTo(0);
            }}
            className="p-2 rounded-full text-white/60 hover:text-white"
            title="Baştan başlat"
          >
            <SkipBack className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CinemaStage;
