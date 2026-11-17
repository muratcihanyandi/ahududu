import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, RotateCcw, Loader2, Film,
  Clapperboard, ExternalLink, Maximize, Minimize,
} from 'lucide-react';
import { CinemaRoom } from '../types';
import { api, mediaUrl, cinemaProxyUrl, cinemaHlsUrl } from '../services/api';
import { playHaptic } from '../services/haptics';
import {
  PlaybackState,
  PlayerAdapter,
  clampPosition,
  formatTime,
  isFilmFinished,
} from '../services/cinemaSync';
import {
  AdapterEvents,
  HLSPlayerAdapter,
  HTML5PlayerAdapter,
  VimeoPlayerAdapter,
  YouTubePlayerAdapter,
  detectPlayerSource,
  extractYouTubeId,
  extractYouTubeStart,
  isPlayableEmbedUrl,
  vimeoApiUrl,
} from '../services/youtubePlayer';

/**
 * Sinema perdesindeki OYNATICI — SADE MODEL.
 *
 * Burada senkron mantığı YOKTUR (bilerek):
 *   - Periyodik düzeltme, drift, nudge, RTT telafisi, heartbeat YOK.
 *   - Oynarken oynatıcıya asla dokunulmaz.
 *
 * Yalnızca üç olay sunucuya bildirilir:
 *   - `ready`  → oynatıcı yüklendi (ikisi de hazır olunca film başlar)
 *   - `pause`  → kullanıcı durdurdu
 *   - `play`   → kullanıcı oynattı (salon "geride olan" saniyesine hizalar)
 *   - `seek`   → kullanıcı sardı
 *
 * Film siteleri (fullhdfilmizlesene gibi) kendi sayfalarını çerçeve içinde
 * açmaz. Onlar için gerçek HLS akışı sunucuda çözülür ve perdeye konur.
 */
export interface CinemaStageProps {
  room: CinemaRoom;
  state: PlaybackState;
  /** Oynatıcı hazır: cihaz "hazırım" bildirir (film ikisi de hazırken başlar). */
  onReady?: (duration: number) => void;
  /** Kullanıcı oynat/duraklat düğmesine bastı. */
  onUserPlayPause: (shouldPlay: boolean, atPosition: number) => void;
  /** Kullanıcı sardı. */
  onUserSeek: (position: number) => void;
  /** Oynatıcının kendi ilerleme bildirimi (yalnızca ilerleme çubuğu için). */
  onProgress?: (position: number, duration: number) => void;
  /** Kullanıcının sahneye aldığı yeni video: salon kaydı güncellendiğinde. */
  onRoomChanged?: (room: CinemaRoom) => void;
}

const TICK_MS = 500;
/** iframe kaynaklarında perdenin "hazırlanıyor"da takılma emniyeti (ms). */
const FRAME_LOAD_TIMEOUT_MS = 8000;

export const CinemaStage: React.FC<CinemaStageProps> = ({
  room,
  state,
  onReady,
  onUserPlayPause,
  onUserSeek,
  onProgress,
  onRoomChanged,
}) => {
  const source = useMemo(
    () =>
      detectPlayerSource({
        video_url: room.video_url,
        embed_url: room.embed_url,
        stream_url: room.stream_url,
        source: room.source,
        kind: room.kind,
      }),
    [room.video_url, room.embed_url, room.stream_url, room.source, room.kind]
  );

  /** Film sitesinden çözülen akış, sunucu proxy'sinden geçirilir. */
  const hlsSrc = useMemo(
    () => (room.stream_url ? cinemaHlsUrl(room.stream_url, room.stream_referer) : ''),
    [room.stream_url, room.stream_referer]
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const embedHostRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const adapterRef = useRef<PlayerAdapter | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(room.duration || 0);
  const [blockedAutoplay, setBlockedAutoplay] = useState(false);
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [loadingFaded, setLoadingFaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [scrubPreview, setScrubPreview] = useState<number | null>(null);

  const isFrameSource = source === 'vimeo' || source === 'unsupported';
  const frameUrl = room.embed_url || room.video_url || '';
  const playableFrame = isPlayableEmbedUrl(frameUrl);
  const isGenericSite = source === 'unsupported';

  const finalFrameUrl = useMemo(() => {
    if (!frameUrl) return '';
    if (source === 'vimeo') return vimeoApiUrl(frameUrl);
    if (playableFrame) return frameUrl;
    return cinemaProxyUrl(frameUrl);
  }, [frameUrl, source, playableFrame]);

  useEffect(() => {
    setLoadingFaded(false);
    const t = window.setTimeout(() => setLoadingFaded(true), 1500);
    return () => window.clearTimeout(t);
  }, [room.id, frameUrl]);

  /* ---------------------------------------------------------------- */
  /* "Sahne": film sitesi linkini perdeye al                          */
  /* ---------------------------------------------------------------- */
  const [stageInput, setStageInput] = useState('');
  const [stageBusy, setStageBusy] = useState(false);
  const [stageNote, setStageNote] = useState<string | null>(null);

  const handleStageVideo = async (raw: string = stageInput) => {
    const text = (raw || '').trim();
    if (!text || stageBusy) return;
    setStageBusy(true);
    setStageNote(null);
    playHaptic(20);
    try {
      const resolved = await api.resolveCinemaLink(text);
      const room2 = await api.createCinemaRoom({
        title: room.title,
        video_url: resolved.video_url || text,
        created_by: room.created_by,
        kind: resolved.kind,
        embed_url: resolved.embed_url || undefined,
        stream_url: resolved.stream_url || undefined,
        stream_referer: resolved.stream_referer || undefined,
        source: resolved.source,
      });
      setStageInput('');
      if (room2 && room2.id) {
        onRoomChanged?.(room2);
      } else {
        setStageNote('Sahne güncellenemedi. Lütfen tekrar dene.');
      }
    } catch (e) {
      console.error('Sahne alınamadı', e);
      setStageNote('Bağlantı okunamadı. Videoyu tarayıcıda açıp adres çubuğundan kopyala.');
    } finally {
      setStageBusy(false);
    }
  };

  const openOutside = (url: string) => {
    if (!url) return;
    playHaptic(15);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  /* ---------------------------------------------------------------- */
  /* Oynatıcı olayları                                                */
  /* ---------------------------------------------------------------- */
  const events: AdapterEvents = useMemo(
    () => ({
      onReady: (dur) => {
        setReady(true);
        if (dur > 0) setDuration(dur);
        onReady?.(dur);
      },
      onDuration: (dur) => {
        if (dur > 0) setDuration(dur);
      },
      onAutoplayBlocked: () => setBlockedAutoplay(true),
      onError: (message) => setError(message),
    }),
    [onReady]
  );

  /* ---------------------------------------------------------------- */
  /* Oynatıcıyı kur                                                   */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    let adapter: PlayerAdapter | null = null;
    let destroyed = false;

    const attach = (created: PlayerAdapter) => {
      if (destroyed) {
        created.destroy?.();
        return;
      }
      adapter = created;
      adapterRef.current = created;
      (window as any).__ahududuCinemaPlayer = created;
    };

    if (source === 'html5' && videoRef.current) {
      attach(new HTML5PlayerAdapter(videoRef.current, events));
    } else if (source === 'hls' && videoRef.current) {
      attach(new HLSPlayerAdapter(videoRef.current, hlsSrc, events));
    } else if (source === 'youtube') {
      const videoId =
        extractYouTubeId(room.embed_url || '') || extractYouTubeId(room.video_url || '');
      const host = embedHostRef.current;
      if (videoId && host) {
        const yt = new YouTubePlayerAdapter({
          videoId,
          container: host,
          events,
          startSeconds: extractYouTubeStart(room.video_url) || 0,
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
      adapter?.destroy?.();
      if ((window as any).__ahududuCinemaPlayer === adapter) {
        (window as any).__ahududuCinemaPlayer = null;
      }
      if (adapterRef.current === adapter) adapterRef.current = null;
      setReady(false);
      setError(null);
      setBlockedAutoplay(false);
      setFrameLoaded(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, room.id, hlsSrc]);

  /* iframe kaynakları: yükleme takılı kalmasın */
  useEffect(() => {
    setFrameLoaded(false);
    if (!isFrameSource) return;
    const timer = window.setTimeout(() => setFrameLoaded(true), FRAME_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isFrameSource, frameUrl]);

  /* ---------------------------------------------------------------- */
  /* Sunucudan gelen OYNAT/DURAKLAT komutunu uygula                    */
  /* ---------------------------------------------------------------- */
  //
  // SADE MODEL: Sunucu yalnızca ÜÇ olayda komut yayınlar (play/pause/seek).
  // Oynarken hiçbir komut gelmez; oynatıcıya dokunulmaz.
  // Komut, `state.position` + `state.isPlaying` olarak gelir.
  const appliedRef = useRef<{ isPlaying: boolean; position: number }>({
    isPlaying: false,
    position: -1,
  });

  useEffect(() => {
    const adapter = adapterRef.current;
    if (!adapter) return;

    const wantPlaying = Boolean(state.isPlaying);
    const target = clampPosition(state.position, state.duration || duration || undefined);

    // Aynı komut tekrar geldiyse (render döngüsü) dokunma.
    const prev = appliedRef.current;
    const sameCommand =
      prev.isPlaying === wantPlaying && Math.abs(prev.position - target) < 0.5;
    if (sameCommand) return;
    appliedRef.current = { isPlaying: wantPlaying, position: target };

    // Konumu yalnızca komut anında hizala.
    if (adapter.kind === 'youtube') {
      if (Math.abs(adapter.getTime() - target) > 0.8) adapter.setTime(target);
    } else if (adapter.getTime() > 0 || target > 0) {
      if (Math.abs(adapter.getTime() - target) > 0.5) adapter.setTime(target);
    }

    if (wantPlaying) {
      if (adapter.isPaused() && !adapter.isEnded()) adapter.play();
    } else if (!adapter.isPaused()) {
      adapter.pause();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isPlaying, state.position, state.anchorMs]);

  /* ---------------------------------------------------------------- */
  /* Periyodik okuma — YALNIZCA ilerleme çubuğu için                   */
  /* ---------------------------------------------------------------- */
  //
  // Burada oynatıcıya HİÇBİR komut verilmez. Sunucuya konum yazılmaz.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const adapter = adapterRef.current;
      if (!adapter) return;
      const t = adapter.getTime();
      setCurrentTime(t);
      const dur = adapter.getDuration();
      if (dur > 0 && Math.abs(dur - duration) > 0.5) setDuration(dur);
      onProgress?.(t, dur);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [duration, onProgress]);

  /* ---------------------------------------------------------------- */
  /* Tam ekran                                                        */
  /* ---------------------------------------------------------------- */
  const toggleFullscreen = async () => {
    playHaptic(15);
    const video = videoRef.current;
    const box = containerRef.current;
    const current = document.fullscreenElement;

    if (current && video && current === video) {
      try {
        await document.exitFullscreen();
      } catch {
        /* yok say */
      }
      return;
    }

    // Sayfa tam ekrandaysa önce ondan çık, sonra videoyu tam ekran yap.
    if (current && current !== video) {
      try {
        await document.exitFullscreen();
        await new Promise((r) => window.setTimeout(r, 120));
      } catch {
        /* yok say */
      }
    }

    const target = (video || box) as (HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      webkitEnterFullscreen?: () => void;
    }) | null;
    if (!target) return;
    try {
      if (target.requestFullscreen) {
        await target.requestFullscreen({ navigationUI: 'hide' } as FullscreenOptions);
      } else if (target.webkitRequestFullscreen) {
        await target.webkitRequestFullscreen();
      } else if (target.webkitEnterFullscreen) {
        target.webkitEnterFullscreen();
      }
    } catch (e) {
      console.warn('Video tam ekranı reddedildi, perde deneniyor', e);
      try {
        if (box && !document.fullscreenElement) await box.requestFullscreen();
      } catch {
        /* yok say */
      }
    }
  };

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(Boolean(videoRef.current && document.fullscreenElement === videoRef.current));
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  /* ---------------------------------------------------------------- */
  /* Kontroller                                                       */
  /* ---------------------------------------------------------------- */
  const adapterNow = () => adapterRef.current;

  const togglePlay = () => {
    playHaptic(12);
    const adapter = adapterNow();
    const playing = !state.isPlaying;
    if (adapter) {
      if (playing) {
        adapter.play();
        setBlockedAutoplay(false);
      } else {
        adapter.pause();
      }
    }
    // Sunucuya olayı bildir: karşı taraf da aynı şeyi yapar.
    const at = adapter ? adapter.getTime() : state.position;
    onUserPlayPause(playing, at);
  };

  const seekTo = (next: number) => {
    const target = clampPosition(next, duration || state.duration);
    adapterNow()?.setTime(target);
    setCurrentTime(target);
    appliedRef.current = { isPlaying: state.isPlaying, position: target };
    onUserSeek(target);
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

  /* Sarma çubuğu: sürükleyerek hassas sarma */
  const scrubRectRef = useRef<DOMRect | null>(null);
  const scrubMovedRef = useRef(false);
  const scrubTargetRef = useRef(0);

  const ratioFromEvent = (e: React.PointerEvent, rect: DOMRect): number => {
    const x = e.clientX - rect.left;
    return Math.min(1, Math.max(0, x / rect.width));
  };

  const startScrubbing = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    scrubRectRef.current = rect;
    scrubMovedRef.current = false;
    const ratio = ratioFromEvent(e, rect);
    scrubTargetRef.current = ratio * totalDuration;
    setScrubPreview(ratio * 100);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* yok say */
    }
  };

  const moveScrubbing = (e: React.PointerEvent) => {
    const rect = scrubRectRef.current;
    if (!rect) return;
    scrubMovedRef.current = true;
    const ratio = ratioFromEvent(e, rect);
    scrubTargetRef.current = ratio * totalDuration;
    setScrubPreview(ratio * 100);
  };

  const endScrubbing = (e: React.PointerEvent) => {
    const rect = scrubRectRef.current;
    if (!rect) return;
    const ratio = ratioFromEvent(e, rect);
    const target = scrubMovedRef.current ? scrubTargetRef.current : ratio * totalDuration;
    scrubRectRef.current = null;
    setScrubPreview(null);
    seekTo(target);
  };

  const cancelScrubbing = () => {
    scrubRectRef.current = null;
    scrubMovedRef.current = false;
    setScrubPreview(null);
  };

  const totalDuration = duration || state.duration || 0;
  const progress = totalDuration > 0 ? Math.min(100, (currentTime / totalDuration) * 100) : 0;

  return (
    <div ref={containerRef} className="w-full h-full absolute inset-0 bg-black">
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

      {/* ---- HLS: film sitesinden çözülen akış ---- */}
      {source === 'hls' && (
        <video
          ref={videoRef}
          playsInline
          preload="auto"
          className={`absolute inset-0 w-full h-full object-contain transition-all duration-700 ${
            state.isPlaying ? '' : 'opacity-60 blur-[1px] scale-[1.01]'
          }`}
          muted={muted}
        />
      )}

      {/* ---- YouTube ---- */}
      {source === 'youtube' && <div ref={embedHostRef} className="absolute inset-0 w-full h-full" />}

      {/* ---- Vimeo ---- */}
      {source === 'vimeo' && playableFrame && (
        <div
          className="absolute inset-0 w-full h-full overflow-y-auto overscroll-contain select-auto touch-pan-y"
          style={{ WebkitOverflowScrolling: 'touch', overflowY: 'auto' }}
        >
          <iframe
            ref={iframeRef}
            src={vimeoApiUrl(frameUrl)}
            className="w-full h-full border-0 select-auto touch-pan-y"
            style={{ width: '100%', height: '100%', minHeight: '100%', border: 0 }}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            onLoad={() => setFrameLoaded(true)}
            title={room.title}
          />
        </div>
      )}

      {/* ---- Web sitesi / genel gömme ---- */}
      {source === 'unsupported' && (
        <div
          className="absolute inset-0 w-full h-full overflow-y-auto overscroll-contain select-auto touch-pan-y"
          style={{ WebkitOverflowScrolling: 'touch', overflowY: 'auto' }}
        >
          <iframe
            ref={iframeRef}
            src={finalFrameUrl}
            className="w-full h-full border-0 select-auto touch-pan-y"
            style={{ width: '100%', height: '100%', minHeight: '100%', border: 0 }}
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            onLoad={() => setFrameLoaded(true)}
            title={room.title}
          />
        </div>
      )}

      {/* ---- Perde yüzeyi: dokun - oynat / duraklat ---- */}
      {(source === 'html5' || source === 'hls') && (
        <button
          type="button"
          aria-label={state.isPlaying ? 'Duraklat' : 'Oynat'}
          onClick={togglePlay}
          className="absolute inset-0 z-10 bg-transparent"
        />
      )}

      {/* Yükleme perdesi */}
      {!ready && !error && !(isFrameSource && frameLoaded) && !loadingFaded && (
        <div className="absolute inset-0 z-[15] pointer-events-none flex flex-col items-center justify-center gap-3 bg-cinema-950/70 transition-opacity duration-500">
          <Loader2 className="w-10 h-10 text-amber-300 animate-spin" />
          <p className="text-amber-100/80 text-xs font-semibold tracking-[0.2em] uppercase">
            Perde hazırlanıyor
          </p>
        </div>
      )}

      {/* Film sitesi sahnesi */}
      {isGenericSite && !error && (
        <div className="absolute top-2 inset-x-2 z-20 flex flex-col items-center gap-1.5 pointer-events-none">
          <div className="w-full max-w-xl flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-2xl bg-cinema-950/85 backdrop-blur-md border border-amber-300/30 text-white shadow-xl pointer-events-auto">
            <div className="flex items-center gap-1.5 min-w-0">
              <Clapperboard className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="text-[10px] font-medium text-amber-100 truncate">
                Video adresini yapıştır, perdeye alalım 🎬
              </span>
            </div>
            <button
              onClick={() => openOutside(room.video_url)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-400 text-cinema-950 text-[10px] font-bold active:scale-95"
            >
              <ExternalLink className="w-3 h-3" />
              Siteyi tarayıcıda aç
            </button>
          </div>

          <div className="w-full max-w-xl px-3 py-2 rounded-2xl bg-cinema-950/90 backdrop-blur-md border border-amber-300/20 text-white shadow-xl pointer-events-auto flex items-center gap-2">
            <textarea
              value={stageInput}
              onChange={(e) => setStageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleStageVideo();
              }}
              rows={1}
              placeholder="https://www.fullhdfilmizlesene.now/film/..."
              className="flex-1 px-3 py-1.5 rounded-xl bg-white/10 border border-amber-200/30 text-white text-[11px] resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-white/40"
            />
            <button
              onClick={() => handleStageVideo()}
              disabled={stageBusy}
              className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-rose-400 text-cinema-950 text-[11px] font-bold disabled:opacity-60 active:scale-95 shrink-0"
            >
              {stageBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {stageBusy ? 'Alınıyor…' : 'Perdeye al 🎬'}
            </button>
          </div>
          {stageNote && (
            <div className="px-3 py-1 rounded-xl bg-cinema-950/95 border border-amber-300/30 pointer-events-auto">
              <p className="text-[10px] leading-snug text-amber-200/90">{stageNote}</p>
            </div>
          )}
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
      <div
        className={`absolute inset-x-0 bottom-0 z-20 px-4 pb-3 pt-10 bg-gradient-to-t from-black/90 via-black/50 to-transparent ${
          source === 'youtube' ? 'hidden' : ''
        }`}
      >
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

          {scrubPreview !== null && (
            <span className="absolute left-1/2 -translate-x-1/2 -top-1 px-2 py-0.5 rounded-full bg-amber-400 text-cinema-950 text-[10px] font-bold tabular-nums shadow-lg pointer-events-none">
              {formatTime(scrubTargetRef.current)}
            </span>
          )}

          <button
            onClick={(e) => {
              const el = e.currentTarget as HTMLElement;
              const rect = el.getBoundingClientRect();
              const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
              seekTo(ratio * totalDuration);
            }}
            onPointerDown={startScrubbing}
            onPointerMove={moveScrubbing}
            onPointerUp={endScrubbing}
            onPointerCancel={cancelScrubbing}
            className="flex-1 h-1.5 rounded-full bg-white/20 overflow-hidden relative touch-none"
            style={{ touchAction: 'none' }}
            title="Sarma"
          >
            <span
              className="absolute left-0 top-0 h-full rounded-full bg-gradient-to-r from-amber-300 to-rose-400"
              style={{ width: `${scrubPreview !== null ? scrubPreview : progress}%` }}
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
          {source !== 'youtube' && (
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-full text-white/85 hover:text-white"
              title={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
              aria-label={isFullscreen ? 'Tam ekrandan çık' : 'Tam ekran'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default CinemaStage;
