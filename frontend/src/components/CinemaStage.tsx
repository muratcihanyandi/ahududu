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
  SyncEngine,
  clampPosition,
  compensateLatency,
  expectedPosition,
  formatTime,
  looksLikeYouTubeLink,
} from '../services/cinemaSync';
import {
  AdapterEvents,
  HLSPlayerAdapter,
  HTML5PlayerAdapter,
  PlayerAdapter,
  VimeoPlayerAdapter,
  YouTubePlayerAdapter,
  detectPlayerSource,
  extractYouTubeId,
  extractYouTubeStart,
  isPlayableEmbedUrl,
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
 * Film siteleri (fullhdfilmizlesene gibi) kendi sayfalarını çerçeve içinde
 * açmaz. Bu yüzden onlar için "sahne" akışı vardır: kullanıcı siteyi kendi
 * tarayıcısında gezip DOĞRU videoyu açar, paylaştığı adresi "Sahneye al" ile
 * perdeye koyar. Tek dokunuş olduğu için video kilitlenmez.
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
  /** Kullanıcının sahneye aldığı yeni video: salon kaydı güncellendiğinde. */
  onRoomChanged?: (room: CinemaRoom) => void;
}

const TICK_MS = 1000;
/** iframe kaynaklarında perdenin "hazırlanıyor"da takılma emniyeti (ms). */
const FRAME_LOAD_TIMEOUT_MS = 8000;

export const CinemaStage: React.FC<CinemaStageProps> = ({
  room,
  state,
  onStateChange,
  onUserPlayPause,
  onUserSeek,
  onReady,
  latencyMs = 120,
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

  /**
   * Film sitesinden çözülen akış, sunucu proxy'sinden geçirilir.
   * CDN'ler CORS başlığı vermediği ve Referer istediği için zorunlu.
   */
  const hlsSrc = useMemo(
    () => (room.stream_url ? cinemaHlsUrl(room.stream_url, room.stream_referer) : ''),
    [room.stream_url, room.stream_referer]
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const embedHostRef = useRef<HTMLDivElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const engineRef = useRef<SyncEngine | null>(null);
  /** Tam ekrana alınacak kapsayıcı (perde alanı): video/iframe ile aynı kutu. */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(room.duration || 0);
  const [blockedAutoplay, setBlockedAutoplay] = useState(false);
  /**
   * iframe tabanlı kaynaklar (Vimeo, senkronsuz gömme) `onReady` bildirmez.
   * Bu yüzden iframe'in `load` olayını kendimiz dinliyoruz; aksi halde
   * "Perde hazırlanıyor" perdesi yüklenmiş videonun ÜSTÜNDE sonsuza kadar
   * kalıyordu (ekran yükleniyor'da takılı görünüyordu).
   */
  const [frameLoaded, setFrameLoaded] = useState(false);
  /** Site çerçeve içinde açılmayı reddediyorsa kullanıcıya çıkış yolu sunulur. */
  const [frameStuck, setFrameStuck] = useState(false);
  const [loadingFaded, setLoadingFaded] = useState(false);
  const [stageDrawerOpen, setStageDrawerOpen] = useState(false);

  /* ------------------------------------------------------------------ */
  /* Eksik akışı kendiliğinden onar                                      */
  /* ------------------------------------------------------------------ */
  /**
   * Film sitesi odalarında gerçek akış (`stream_url`) yoksa salon siteyi
   * gösterip "kara ekran"a düşüyordu. Eski sürümden kalmış odalar ve akışı
   * çözülememiş kayıtlar bu durumda kalıyor.
   *
   * Burada bir kez sunucudan akışı yeniden çözmesini isteyip odayı güncelliyoruz.
   * Kullanıcı hiçbir şey yapmak zorunda kalmadan perde açılıyor.
   */
  const repairTriedRef = useRef(false);
  const [repairing, setRepairing] = useState(false);

  useEffect(() => {
    repairTriedRef.current = false;
  }, [room.id]);

  useEffect(() => {
    // Yalnızca: film sitesi kaydı, akış yok, onarım denenmemiş.
    if (source !== 'unsupported' || room.stream_url || repairTriedRef.current) return;
    if (!room.video_url || !/^https?:\/\//i.test(room.video_url)) return;
    repairTriedRef.current = true;
    setRepairing(true);

    let cancelled = false;
    (async () => {
      try {
        const resolved = await api.resolveCinemaLink(room.video_url);
        if (cancelled) return;
        if (!resolved?.stream_url) {
          setRepairing(false);
          return;
        }
        // Sunucu odayı günceller; akışla birlikte yeni kayıt gelir.
        const updated = await api.createCinemaRoom({
          title: room.title,
          video_url: resolved.video_url || room.video_url,
          created_by: room.created_by,
          kind: resolved.kind,
          stream_url: resolved.stream_url,
          stream_referer: resolved.stream_referer || undefined,
          source: resolved.source,
        });
        if (cancelled || !updated?.id) {
          setRepairing(false);
          return;
        }
        onRoomChanged?.(updated);
      } catch (e) {
        console.error('Akış onarılamadı', e);
      } finally {
        if (!cancelled) setRepairing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, room.id, room.video_url, room.stream_url, room.title, room.created_by, onRoomChanged]);

  const isFrameSource = source === 'vimeo' || source === 'unsupported';
  /** Perdeye konabilecek adres */
  const frameUrl = room.embed_url || room.video_url || '';
  const playableFrame = isPlayableEmbedUrl(frameUrl);

  /** Film siteleri (X-Frame-Options engelleyen siteler) sunucu proxy'si ile açılır */
  const finalFrameUrl = useMemo(() => {
    if (!frameUrl) return '';
    if (source === 'vimeo') return vimeoApiUrl(frameUrl);
    if (playableFrame) return frameUrl;
    return cinemaProxyUrl(frameUrl);
  }, [frameUrl, source, playableFrame]);

  useEffect(() => {
    setLoadingFaded(false);
    // İframe yüklenmesi gecikse bile 1.5 sn sonra loading perdesini kaldır:
    // Kullanıcı arkadaki sayfayı hemen görsün, donup kalmasın ve rahatça aşağı kaydırabilsin.
    const t = window.setTimeout(() => setLoadingFaded(true), 1500);
    return () => window.clearTimeout(t);
  }, [room.id, frameUrl]);

  /** Sitenin kendi HTML sayfası olduğunda sahne rehberi üstte yardımcı çubuk olarak sunulur */
  const isGenericSite = source === 'unsupported';

  /* ------------------------------------------------------------------ */
  /* "Sahne": siteyi tarayıcıda gez, doğru videoyu seç, perdeye al       */
  /* ------------------------------------------------------------------ */
  const [stageInput, setStageInput] = useState('');
  const [stageBusy, setStageBusy] = useState(false);
  const [stageNote, setStageNote] = useState<string | null>(null);

  /**
   * Kullanıcı bu sahnede videoyu DEĞİŞTİRDİYSE oynatıcıya "başka biri
   * dokunmadı" bilgisini vermeliyiz: yeni oynatıcı hazır olurken gelen eski
   * duraklatma/gizli komutlar aksi halde kontrolü ele geçirebilir.
   */
  const stagedRef = useRef(false);
  /** Kullanıcının seçtiği sahne: oynatıcı hazır olunca çalışacak başlatıcı. */
  const pendingStartRef = useRef<(() => void) | null>(null);
  /** Sahne yeni değişti: ilk durum çeki (0 saniye, oynuyor) uygulanacak. */
  const freshSceneRef = useRef(false);
  /** Otomatik oynatma engellendi mi? (interval yankısız okusun)
   *  Not: tick bu bayrağa göre atlanmaz — sesi açık oynatma yalnızca kullanıcı
   *  dokunuşunda yapılır; burada durum yalnızca izlenir. */
  const blockedAutoplayRef = useRef(false);
  blockedAutoplayRef.current = blockedAutoplay;
  /** Tick içinden güncel durum okunabilsin (kapanışta eski değer kalmasın). */
  const stateRef = useRef(state);
  stateRef.current = state;

  /**
   * Kullanıcının yapıştırdığı linki perdeye koyar.
   *
   * Tek dokunuşla çalıştığı için (kullanıcı da tıkladı) tarayıcının otomatik
   * oynatma engeli aşılmış olur; oynat/duraklat düğmeleri normal çalışır.
   */
  const handleStageVideo = async (raw: string = stageInput) => {
    const text = (raw || '').trim();
    if (!text || stageBusy) return;
    // Film sitesi linki (sayfa adresi) perdeye doğrudan konamaz: kullanıcıya
    // "siteyi aç, doğru videoyu bul" yolu gösterilir. Sahte "bulundu" olmasın.
    if (!looksLikeYouTubeLink(text)) {
      setStageNote('Bu bir site linki. Önce siteyi açıp filmi başlat, sonra videosunun bağlantısını paylaş.');
      return;
    }
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
        source: resolved.source,
      });
      stagedRef.current = true;
      freshSceneRef.current = true;
      setStageInput('');
      // Sunucu kaydı bu sahneye geçti: perde yeni video ile kurulur (room.id
      // değişir → oynatıcı yeniden bağlanır ve kullanıcı dokunuşunun içinde
      // oynatma başlatılır).
      if (room2 && room2.id) {
        onRoomChanged?.(room2);
      } else {
        setStageNote('Sahne güncellenemedi. Lütfen tekrar dene.');
      }
      playHaptic(30);
    } catch (e) {
      console.error('Sahne alınamadı', e);
      setStageNote('Bağlantı okunamadı. Videoyu tarayıcıda açıp adres çubuğundan kopyala.');
    } finally {
      setStageBusy(false);
    }
  };

  /** Tarayıcıda siteyi/doğru videoyu aç: film siteleri iframe içinde açılmaz. */
  const openOutside = (url: string) => {
    if (!url) return;
    playHaptic(15);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

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
        // Kullanıcının seçtiği sahne: oynatıcı hazır olur olmaz başlat.
        const start = pendingStartRef.current;
        if (start) {
          pendingStartRef.current = null;
          start();
        }
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

    // eventOnly: film oynarken hız kaydırma/sarma YAPILMAZ (mikro takılma
    // olmasın). Hizalama yalnızca oynat/duraklat/sarma komutlarında olur.
    const engine = new SyncEngine({ latencyMs, eventOnly: true });
    engineRef.current = engine;

    const attach = (created: PlayerAdapter) => {
      if (destroyed) {
        created.destroy?.();
        return;
      }
      adapter = created;
      engine.attach(created);
      // Teşhis kancası: sahne sahibi oynatıcıya erişebilsin (test/geliştirme).
      (window as any).__ahududuCinemaPlayer = created;
      if (created.isReady()) engine.markReady();

      // Kullanıcı bu video sahnesini kendisi seçtiyse (dokunuşun içindeyiz):
      // video otomatik oynatma engeline düşmeden başlasın, düğmeler çalışsın.
      if (stagedRef.current) {
        stagedRef.current = false;
        const start = () => {
          publishPlayPause(true);
          if (created.kind === 'html5' || created.kind === 'hls') {
            const video = videoRef.current;
            if (video) video.play().catch(() => setMuted(true));
          } else if (created.kind === 'youtube') {
            const yt = created as YouTubePlayerAdapter;
            yt.setMuted(false);
            setMuted(false);
            yt.play();
          }
        };
        if (created.isReady()) start();
        else pendingStartRef.current = start;
      } else if (pendingStartRef.current) {
        // Önceki deneme sahnesinde oynatıcı henüz kurulmadan geldi: şimdi.
        const start = pendingStartRef.current;
        pendingStartRef.current = null;
        start();
      }
    };

    if (source === 'html5' && videoRef.current) {
      attach(new HTML5PlayerAdapter(videoRef.current, events));
    } else if (source === 'hls' && videoRef.current) {
      // Film sitesinden çözülen akış: hls.js / yerleşik HLS ile oynat.
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

    return () => {      destroyed = true;
      engine.detach();
      adapter?.destroy?.();
      if ((window as any).__ahududuCinemaPlayer === adapter) {
        (window as any).__ahududuCinemaPlayer = null;
      }
      if (engineRef.current === engine) engineRef.current = null;
      setReady(false);
      setError(null);
      setBlockedAutoplay(false);
      setFrameLoaded(false);
      setFrameStuck(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, room.id, hlsSrc]);

  /* ------------------------------------------------------------------ */
  /* iframe kaynakları: yükleme takılı kalmasın                          */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    setFrameLoaded(false);
    setFrameStuck(false);
    if (!isFrameSource) return;
    // Bazı siteler çerçeveyi reddederken `load` bile vermez: perde sonsuza
    // kadar "hazırlanıyor" kalmasın diye emniyet süresi koyuyoruz.
    const timer = window.setTimeout(() => setFrameStuck(true), FRAME_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [isFrameSource, frameUrl]);

  /** iframe yüklendi: "Perde hazırlanıyor" perdesini kaldır. */
  const handleFrameLoad = () => {
    setFrameLoaded(true);
    setFrameStuck(false);
  };

  /* ------------------------------------------------------------------ */
  /* Sunucu/partner durumu değişti → motora ver                          */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setLatency(latencyMs);
    // Sahne değiştiyse durum SIFIRDAN başlar: eski filmin saniyesi yenisine
    // uygulanırsa video ortadan başlar ya da anında "bitti" görünür.
    const fresh = freshSceneRef.current;
    if (fresh) freshSceneRef.current = false;
    engine.applyState(
      compensateLatency(
        {
          position: fresh ? 0 : state.position,
          isPlaying: fresh ? true : state.isPlaying,
          duration: fresh ? undefined : state.duration || duration || undefined,
        },
        fresh ? 0 : latencyMs
      )
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.position, state.isPlaying, state.anchorMs, latencyMs]);

  /* ------------------------------------------------------------------ */
  /* Periyodik düzeltme + zaman göstergesi                               */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    // Otomatik oynatma engellendiyse 1 sn'lik denetim sürekli play deneyip
    // deneyip sessizce bozmasın: düğme "oynat" gösterir, kullanıcı dokunur.
    //
    // NOT: Bu döngü yalnızca DURUMU İZLER. Film oynarken oynatıcıya hız
    // kaydırma/sarma yapılmaz (mikro takılmaların kaynağıydı); hizalama
    // sadece oynat/duraklat/sarma komutlarında olur.
    const timer = window.setInterval(() => {
      const engine = engineRef.current;
      if (!engine) return;
      if (blockedAutoplayRef.current && stateRef.current.isPlaying) {
        // Otomatik oynatma engellendi: düğme "oynat" göstersin; sekme sessizce
        // oynamaya çalışıp durumu bozmasın. Duraklat/sarma yine çalışır.
        // YouTube'da yeşil "sesi aç" düğmesi zaten doğru yolu sunuyor.
        const adapter = engine.getAdapter();
        if (adapter && adapter.kind !== 'youtube') {
          adapter.pause();
          publishPlayPause(false);
        } else {
          engine.tick();
        }
      } else if (!stagedRef.current) {
        engine.tick();
      }
      const adapter = engine.getAdapter();
      if (adapter) {
        // Yalnızca ilerleme çubuğu için okunur; sunucuya durum YAZILMAZ.
        const t = adapter.getTime();
        setCurrentTime(t);
        const dur = adapter.getDuration();
        if (dur > 0 && Math.abs(dur - duration) > 0.5) setDuration(dur);
        // NOT: Burada `onStateChange` çağrılmıyor. Her saniye konum yazmak
        // salonun anchor'ını bozup iki tarafı birbirine çekiyordu.
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [duration, onStateChange]);

  /* ------------------------------------------------------------------ */
  /* Kontroller                                                          */
  /* ------------------------------------------------------------------ */
  const adapterNow = () => engineRef.current?.getAdapter() ?? null;

  /**
   * VİDEOYU tam ekraan al.
   *
   * ÖNEMLİ: Film sitesinden gelen HLS akışında `<video>` bizim elimizde
   * olduğu için önce onu tam ekrana alıyoruz (en geniş görüntü, harici
   * kuşak yok). Tarayıcı reddederse perde kapsayıcısına düşüyoruz.
   * YouTube/Vimeo iframe'lerinde video üstünde kontrolümüz yok; onlarda
   * kapsayıcı tam ekrana alınır.
   */
  const toggleFullscreen = async () => {
    playHaptic(15);
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void>;
    };
    const video = videoRef.current;
    const box = containerRef.current;
    const current = document.fullscreenElement || doc.webkitFullscreenElement || null;

    // Zaten VİDEO tam ekrandaysa → çık.
    if (current && video && current === video) {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
      } catch (e) {
        console.warn('Tam ekrandan çıkılamadı', e);
      }
      return;
    }

    // Sayfa (<html>) tam ekrandaysa ama video değilse: ÖNCE ondan çık,
    // sonra videoyu tam ekrana al. Aksi halde "tam ekran" düğmesi yalnızca
    // sayfa modunu kapatıyor, video hiç tam ekran olmuyordu.
    if (current && current !== video) {
      try {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
        // Tarayıcının mod değişimini işlemesi için kısa bekleme.
        await new Promise((r) => window.setTimeout(r, 120));
      } catch (e) {
        console.warn('Tam ekrandan çıkılamadı', e);
      }
    }

    const target = (video || box) as (HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
      webkitEnterFullscreen?: () => void; // iOS Safari <video>
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
      // Video tam ekranı reddedilirse perde kapsayıcısını dene.
      try {
        if (box && !document.fullscreenElement) await box.requestFullscreen();
      } catch {
        /* yok say */
      }
    }
  };

  /** Tam ekran durumunu izle (ESC / geri tuşu ile çıkışta düğme güncellensin). */
  useEffect(() => {
    const onChange = () => {
      // Yalnızca VİDEO tam ekrandaysa "çık" düğmesi gösterilsin. Sayfanın
      // (<html>) tam ekran olması videoyu tam ekran yapmış sayılmaz.
      setIsFullscreen(Boolean(videoRef.current && document.fullscreenElement === videoRef.current));
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const togglePlay = () => {
    const playing = !state.isPlaying;
    const adapter = adapterNow();
    if (adapter) {
      if (playing) {
        adapter.play();
        // Oynatma engelliyse "sesi aç" düğmesi referansı kaybolmasın.
        setBlockedAutoplay(false);
      } else {
        adapter.pause();
      }
    }
    publishPlayPause(playing);
  };

  /** Perde yüzeyine dokunuş: tek dokunuşla oynat / duraklat. */
  const handleSurfaceTap = () => {
    playHaptic(12);
    togglePlay();
  };

  /**
   * YouTube'un kendi gömülü oynatıcısı her tıklamayı kendisi de işler
   * (kendi play/pause düğmesi, videonun kendisi). Üstüne bir de bizim
   * saydam "dokun → oynat/duraklat" katmanımız binince tek dokunuş iki kez
   * uygulanıyor ve birbirini iptal ediyordu: "videoyu başlatıyorum ama
   * oynamıyor". Bu yüzden YouTube'da perde yüzeyine dokunma katmanı
   * kaldırıldı; kontrol alt bardan ve YouTube'un kendi düğmelerinden yapılır.
   */

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

      {/* ---- HLS: film sitesinden çözülen akış (hls.js kaynağı kendisi bağlar) ---- */}
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

      {/* ---- YouTube: IFrame Player API kapsayıcısı ---- */}
      {source === 'youtube' && <div ref={embedHostRef} className="absolute inset-0 w-full h-full" />}

      {/* ---- Vimeo: postMessage API'li iframe ---- */}
      {source === 'vimeo' && playableFrame && (
        <div
          className="absolute inset-0 w-full h-full overflow-y-auto overscroll-contain select-auto touch-pan-y"
          style={{ WebkitOverflowScrolling: 'touch', overflowY: 'auto' }}
        >
          <iframe
            ref={iframeRef}
            src={vimeoApiUrl(frameUrl)}
            className="w-full h-full border-0 select-auto touch-pan-y"
            style={{
              width: '100%',
              height: '100%',
              minHeight: '100%',
              border: 0,
              overflow: 'auto',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
            }}
            scrolling="yes"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            onLoad={handleFrameLoad}
            title={room.title}
          />
        </div>
      )}

      {/* ---- Web sitesi / genel gömme: kullanıcının sitede rahatça gezinmesi ve aşağı kaydırması için ---- */}
      {source === 'unsupported' && (
        <div
          className="absolute inset-0 w-full h-full overflow-y-auto overscroll-contain select-auto touch-pan-y"
          style={{ WebkitOverflowScrolling: 'touch', overflowY: 'auto' }}
        >
          <iframe
            ref={iframeRef}
            src={finalFrameUrl}
            className="w-full h-full border-0 select-auto touch-pan-y"
            style={{
              width: '100%',
              height: '100%',
              minHeight: '100%',
              border: 0,
              overflow: 'auto',
              WebkitOverflowScrolling: 'touch',
              touchAction: 'pan-y',
            }}
            scrolling="yes"
            allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
            allowFullScreen
            onLoad={handleFrameLoad}
            title={room.title}
          />
        </div>
      )}

      {/* ---- Perde yüzeyi: dokun - oynat / duraklat ---- */}
      {(source === 'html5' || source === 'hls') && (
        <button
          type="button"
          aria-label={state.isPlaying ? 'Duraklat' : 'Oynat'}
          onClick={handleSurfaceTap}
          className="absolute inset-0 z-10 bg-transparent"
        />
      )}

      {/* Yükleme perdesi: videonun ÜSTÜNDE takılı kalmasın.
          pointer-events-none sayesinde kullanıcı arkadaki siteyi gördüğü an hemen dokunabilir ve kaydırabilir. */}
      {!ready && !error && !(isFrameSource && frameLoaded) && !loadingFaded && (
        <div className="absolute inset-0 z-[15] pointer-events-none flex flex-col items-center justify-center gap-3 bg-cinema-950/70 transition-opacity duration-500">
          <Loader2 className="w-10 h-10 text-amber-300 animate-spin" />
          <p className="text-amber-100/80 text-xs font-semibold tracking-[0.2em] uppercase">
            Perde hazırlanıyor
          </p>
        </div>
      )}

      {/* ---- SAHNE: siteyi tarayıcıda gez, doğru videoyu seç, perdeye al ----
           Kullanıcının sitede gezinmesini ve aşağı kaydırmasını engellemez.
           Üstte kompakt bir yardımcı çubuk ve sahne kutusu olarak durur. */}
      {isGenericSite && repairing && !error && (
        <div className="absolute inset-0 z-[18] flex flex-col items-center justify-center gap-3 bg-cinema-950/95 text-center px-8">
          <Loader2 className="w-10 h-10 text-amber-300 animate-spin" />
          <p className="text-amber-100 font-serif text-sm font-bold">Film perdeye hazırlanıyor…</p>
          <p className="text-amber-100/60 text-[11px] max-w-xs leading-snug">
            Sitedeki gerçek video akışı aranıyor. Birkaç saniye sürebilir 🎬
          </p>
        </div>
      )}

      {isGenericSite && !repairing && !error && (
        <div className="absolute top-2 inset-x-2 z-20 flex flex-col items-center gap-1.5 pointer-events-none">
          <div className="w-full max-w-xl flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 rounded-2xl bg-cinema-950/85 backdrop-blur-md border border-amber-300/30 text-white shadow-xl pointer-events-auto">
            <div className="flex items-center gap-1.5 min-w-0">
              <Clapperboard className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="text-[10px] font-medium text-amber-100 truncate">
                Önce sitede gez, doğru videoyu bul 🎬
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => openOutside(room.video_url)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-400 text-cinema-950 text-[10px] font-bold active:scale-95"
              >
                <ExternalLink className="w-3 h-3" />
                Siteyi tarayıcıda aç
              </button>
            </div>
          </div>

          <div className="w-full max-w-xl px-3 py-2 rounded-2xl bg-cinema-950/90 backdrop-blur-md border border-amber-300/20 text-white shadow-xl pointer-events-auto flex items-center gap-2">
            <textarea
              value={stageInput}
              onChange={(e) => setStageInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleStageVideo();
              }}
              rows={1}
              placeholder="https://www.youtube.com/watch?v=..."
              className="flex-1 px-3 py-1.5 rounded-xl bg-white/10 border border-amber-200/30 text-white text-[11px] resize-none focus:outline-none focus:ring-1 focus:ring-amber-400 placeholder:text-white/40"
            />
            <button
              onClick={() => handleStageVideo()}
              disabled={stageBusy}
              className="flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-rose-400 text-cinema-950 text-[11px] font-bold disabled:opacity-60 active:scale-95 shrink-0"
            >
              {stageBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
              {stageBusy ? 'Sahneye alınıyor…' : 'Sahneye al 🎬'}
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

      {/* Sinema alt barı (YouTube'da gizli: kendi kontrol çubuğu var) */}
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
          {/* Video tam ekran: YouTube'un kendi düğmesi var, orada gizli. */}
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
