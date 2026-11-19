import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import {
  Play, X, Link2, Film, Popcorn, ChevronRight, Loader2,
  CalendarDays, Ticket, Clapperboard,
} from 'lucide-react';
import { CinemaRoom, UserId, USERS, partnerOf, nameOf, emojiOf, Showtime } from '../types';
import { api, mediaUrl, cinemaVideoUrl } from '../services/api';
import { wsClient } from '../services/websocket';
import { updates } from '../services/updates';
import { playHaptic, soundEngine, HAPTIC_PATTERNS } from '../services/haptics';
import { CinemaCalendar } from './CinemaCalendar';
import { CinemaStage } from './CinemaStage';
import {
  PlaybackState, SyncMessage, isFilmFinished, looksLikeYouTubeLink,
} from '../services/cinemaSync';

const getLivePlayerTime = (fallback = 0): number => {
  const player = (window as { __ahududuCinemaPlayer?: { getTime?: () => number } })
    .__ahududuCinemaPlayer;
  if (player && typeof player.getTime === 'function') {
    const t = player.getTime();
    if (Number.isFinite(t) && t >= 0) return t;
  }
  const video = document.querySelector('video') as HTMLVideoElement | null;
  if (video && Number.isFinite(video.currentTime)) return video.currentTime;
  return fallback;
};

/* ------------------------------------------------------------------ */
/* Yon (yatay) kilidi eklentisi                                       */
/* ------------------------------------------------------------------ */

interface OrientationPlugin {
  lockLandscape(): Promise<{ orientation: string }>;
  unlock(): Promise<{ orientation: string }>;
  getOrientation(): Promise<{ orientation: string }>;
}

const NativeOrientation = registerPlugin<OrientationPlugin>('Orientation');

/** Salonun kendi tam ekran modu (Android WebView Veilsiz tam ekran). */
const enterCinemaFullscreen = async (): Promise<boolean> => {
  try {
    if (Capacitor.isNativePlatform()) {
      await NativeOrientation.lockLandscape();
    }
  } catch (e) {
    console.warn('Yön kilidi uygulanamadı', e);
  }

  // Chrome / WebView tam ekran API'si
  try {
    const el = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (document.fullscreenElement) return true;
    if (el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
      return true;
    }
    if (el.webkitRequestFullscreen) {
      await el.webkitRequestFullscreen();
      return true;
    }
  } catch (e) {
    console.warn('Tam ekran açılamadı', e);
  }
  return false;
};

const exitCinemaFullscreen = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch (e) {
    /* yok say */
  }
  try {
    if (Capacitor.isNativePlatform()) {
      await NativeOrientation.unlock();
    }
  } catch (e) {
    console.warn('Yön kilidi kaldırılamadı', e);
  }
};

/* ------------------------------------------------------------------ */
/* Dekor: sinema salonu sahnesi                                        */
/* ------------------------------------------------------------------ */

const SalonDecor: React.FC<{ playing: boolean }> = ({ playing }) => (
  <>
    {/* Duvar dokusu */}
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(120,30,70,0.5),_transparent_65%)]" />
    <div className="absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.85),rgba(20,5,15,0.6)_45%,rgba(0,0,0,0.9))]" />

    {/* Perdeler (kenarlar) */}
    <div
      className="absolute inset-y-0 left-0 w-[12%] z-10"
      style={{
        background:
          'repeating-linear-gradient(90deg, #7f1030 0px, #a3163f 8px, #5c0a20 18px, #861134 26px)',
        boxShadow: '12px 0 40px rgba(0,0,0,0.8) inset',
      }}
    />
    <div
      className="absolute inset-y-0 right-0 w-[12%] z-10"
      style={{
        background:
          'repeating-linear-gradient(90deg, #861134 0px, #5c0a20 18px, #a3163f 8px, #7f1030 26px)',
        boxShadow: '-12px 0 40px rgba(0,0,0,0.8) inset',
      }}
    />

    {/* Üst perde (açılırken yukarı çekilmiş gibi) */}
    <div
      className="absolute inset-x-0 top-0 h-[10%] z-10"
      style={{
        background: 'repeating-linear-gradient(90deg, #7f1030 0px, #a3163f 10px, #5c0a20 20px)',
        boxShadow: '0 12px 30px rgba(0,0,0,0.7)',
      }}
    />

    {/* Projektör ışığı */}
    <div
      className="absolute left-1/2 top-[-20%] w-[70%] h-[140%] -translate-x-1/2 z-[5] pointer-events-none"
      style={{
        background:
          'conic-gradient(from 180deg at 50% 0%, transparent 0deg, rgba(255,236,190,0.16) 22deg, rgba(255,236,190,0.05) 40deg, transparent 88deg)',
        filter: 'blur(14px)',
        animation: playing ? 'projectorFlicker 6s infinite' : 'none',
        opacity: playing ? 1 : 0.35,
        transition: 'opacity 0.9s ease',
      }}
    />

    {/* Sahne kenarı ışıkları */}
    <div className="absolute inset-x-0 bottom-0 h-16 z-[6] pointer-events-none opacity-70"
      style={{
        background:
          'radial-gradient(ellipse at 25% 120%, rgba(255,190,120,0.35), transparent 60%), radial-gradient(ellipse at 75% 120%, rgba(255,120,170,0.35), transparent 60%)',
      }}
    />

    {/* Koltuklar: alt sıra siluetleri */}
    <div className="absolute inset-x-0 bottom-0 h-[14%] z-[7] pointer-events-none flex items-end justify-center gap-1 px-6">
      {Array.from({ length: 14 }).map((_, i) => (
        <div
          key={i}
          className="flex-1 max-w-[54px] rounded-t-[14px] bg-gradient-to-t from-black via-[#2a0a16] to-[#4a1024] shadow-inner"
          style={{
            height: i % 2 === 0 ? '100%' : '86%',
            animation: 'seatBob 3.4s ease-in-out infinite',
            animationDelay: `${i * 0.14}s`,
          }}
        />
      ))}
    </div>

    {/* Vignette */}
    <div className="absolute inset-0 pointer-events-none z-[8] bg-[radial-gradient(ellipse_at_center,transparent_40%,rgba(0,0,0,0.9)_100%)]" />
  </>
);

/* ------------------------------------------------------------------ */
/* Karakterlerimiz — sinema koltuklarında oturur                       */
/* ------------------------------------------------------------------ */

const CharacterSeat: React.FC<{
  userId: UserId;
  isMe: boolean;
  isWatching: boolean;
  playing: boolean;
  totalPhotos?: number;
}> = ({ userId, isMe, isWatching, playing }) => {
  const user = USERS[userId];
  return (
    <div className={`relative flex flex-col items-center ${isMe ? 'order-1' : 'order-3'}`}>
      {/* Popcorn / içecek */}
      <div className="mb-1 flex items-end gap-1">
        <span
          className="text-lg"
          style={{ animation: playing ? 'popIn 0.6s ease' : undefined }}
          title="Mısır"
        >
          🍿
        </span>
        <span className="text-sm" title="İçecek">🥤</span>
      </div>

      {/* Koltuk + karakter */}
      <div className="relative">
        <div
          className={`absolute -inset-3 rounded-full blur-xl transition-all duration-700 ${
            isWatching ? 'bg-amber-300/40' : 'bg-rose-500/20'
          }`}
          style={{ animation: isWatching ? 'marqueeGlow 3.2s ease-in-out infinite' : undefined }}
        />
        <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-b from-[#4a1024] to-[#1a0510] border-2 border-amber-500/40 flex items-center justify-center text-4xl sm:text-5xl shadow-2xl">
          <span
            style={{
              animation: playing
                ? 'seatBob 2.6s ease-in-out infinite'
                : 'float 4s ease-in-out infinite',
            }}
            className="drop-shadow-lg"
          >
            {user.emoji}
          </span>
          {!isWatching && (
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-stone-600 border-2 border-cinema-950" />
          )}
          {isWatching && (
            <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-cinema-950 animate-pulse" />
          )}
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/50 backdrop-blur-xs">
        <span className="text-[10px] font-bold text-amber-100">
          {user.name}
          {isMe && ' (sen)'}
        </span>
      </div>
      <span className={`text-[8px] mt-0.5 ${isWatching ? 'text-emerald-300' : 'text-white/40'}`}>
        {isWatching ? 'salonda 🍿' : 'salonda değil'}
      </span>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Ana bileşen                                                         */
/* ------------------------------------------------------------------ */

interface CinemaSalonProps {
  currentUserId: UserId;
  /**
   * Android geri tuşu için iç handler. Salon açıkken "geri" tuşu önce filmden
   * çıkarır; App bu fonksiyonu çağırır.
   */
  onBackHandlerReady?: (handler: (() => boolean) | null) => void;
}

export const CinemaSalon: React.FC<CinemaSalonProps> = ({ currentUserId, onBackHandlerReady }) => {
  const partnerId = partnerOf(currentUserId);
  const [rooms, setRooms] = useState<CinemaRoom[]>([]);
  const [activeRoom, setActiveRoom] = useState<CinemaRoom | null>(null);
  const [linkInput, setLinkInput] = useState('');
  const [titleInput, setTitleInput] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLandscape, setIsLandscape] = useState(
    () => typeof window !== 'undefined' && window.innerWidth > window.innerHeight
  );
  const [partnerWatching, setPartnerWatching] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<{ id: number; emoji: string; left: number }[]>([]);
  const [partnerJustJoined, setPartnerJustJoined] = useState(false);
  const [curtainOpen, setCurtainOpen] = useState(false);
  /** Takvim: yalnızca "Takvimi Gör" / "Takvimi Gizle" ile açılıp kapanır.
   *  "Bu ayın perdesi" kartı ise HER ZAMAN görünür (görev 5). */
  const [showCalendar, setShowCalendar] = useState(false);
  /** Salona giriş sürerken çift dokunuşu yut: aynı anda iki "başlat" gitmesin. */
  const enteringRef = useRef(false);
  const startingRoomRef = useRef(false);
  const onBackHandlerReadyRef = useRef(onBackHandlerReady);
  onBackHandlerReadyRef.current = onBackHandlerReady;
  /**
   * SADE MODEL: film yüklendi ama partner de hazır değil; iki cihaz birlikte
   * başlayacak. Bu sırada kullanıcıya "bekleniyor" gösterilir.
   */
  const [waitingPartner, setWaitingPartner] = useState(false);
  /** Bu oturumda uğraştığımız salon: kendiliğinden açılan film kullanıcıyı
   *  tekrar içeri sürüklemesin ("Cars 1 takılı kaldı" hatası). */
  const lastRoomRef = useRef<number | null>(null);
  /** Partner bir film başlattıysa: "Katıl" daveti (zorla giriş yok) */
  const [partnerSession, setPartnerSession] = useState<{
    roomId: number;
    title: string;
    by: string;
  } | null>(null);

  const [playback, setPlayback] = useState<PlaybackState>({
    position: 0,
    isPlaying: false,
    duration: 0,
  });

  const lastSyncRef = useRef<number>(0);
  const roomRef = useRef<CinemaRoom | null>(null);
  roomRef.current = activeRoom;
  const playbackRef = useRef<PlaybackState>(playback);
  playbackRef.current = playback;
  const partnerJoinTimerRef = useRef<number | null>(null);
  const curtainTimerRef = useRef<number | null>(null);
  const emojiTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      if (partnerJoinTimerRef.current !== null) {
        window.clearTimeout(partnerJoinTimerRef.current);
      }
      if (curtainTimerRef.current !== null) {
        window.clearTimeout(curtainTimerRef.current);
      }
      emojiTimersRef.current.forEach((id) => window.clearTimeout(id));
      emojiTimersRef.current = [];
    };
  }, []);

  /* ---------------- Yön algılama ---------------- */
  useEffect(() => {
    const onResize = () => setIsLandscape(window.innerWidth > window.innerHeight);
    let orientTimer: number | null = null;
    const onOrient = () => {
      if (orientTimer !== null) window.clearTimeout(orientTimer);
      orientTimer = window.setTimeout(onResize, 220);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onOrient);
    return () => {
      if (orientTimer !== null) window.clearTimeout(orientTimer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onOrient);
    };
  }, []);

  /* ---------------- Salon aktifken OTA yenilemeyi durdur ---------------- */
  useEffect(() => {
    if (!activeRoom) return;
    updates.setBusy(true);
    return () => updates.setBusy(false);
  }, [activeRoom]);

  /* ---------------- Afiş listesi ---------------- */
  const loadRooms = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await api.listCinemaRooms();
      setRooms(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Salonlar yüklenemedi', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /** Otomatik salona girme YOK (kullanıcı isteğiyle kaldırıldı). */

  useEffect(() => {
    // OTOMATİK SALONA GİRME YOK (bilerek kaldırıldı).
    // Kullanıcı: "film başladığında otomatik salona girme işini iptal edelim.
    // Herkes kendisi salona girsin, kendisi kontrol etsin. Sadece bildirim
    // versek yeter" — bildirim App tarafında yapılıyor.
    loadRooms();
  }, [loadRooms]);

  /* ---------------- WebSocket olayları (SADE MODEL) ---------------- */
  //
  // Oynarken SENKRON YOK. Sunucudan yalnızca sonlu olaylar gelir:
  //   cinema_play  → iki cihaz da hazır: AYNI ANDA başla
  //   cinema_sync  → play / pause / seek komutu
  useEffect(() => {
    const unsubSync = wsClient.on('cinema_sync', (data: SyncMessage) => {
      if (!data) return;
      const room = roomRef.current;

      if (data.action === 'stop') {
        setActiveRoom(null);
        return;
      }

      // Partner salondan çıktı: salon KAPANIR, kimse takılı kalmaz.
      if (data.action === 'leave' && data.is_active === false) {
        if (room && room.id === data.room_id) {
          void leaveRoom(false);
        } else {
          setActiveRoom(null);
        }
        return;
      }

      if (!room || room.id !== data.room_id) {
        if (data.is_active) loadRooms();
        return;
      }

      // ---- SALONA SONRADAN GİREN: TEK SEFERLİK SENKRON ----
      // Murat 11:00'da izliyordu; Selin odaya girdi. Sunucu Murat'ın saniyesini
      // esas aldı: İKİSİ DE o saniyeye hizalanır ve birlikte devam eder.
      if (data.action === 'join_sync') {
        setPlayback((prev) => ({
          ...prev,
          position: data.position,
          isPlaying: true,
          duration: data.duration || prev.duration,
          anchorMs: Date.now(),
          lastAction: 'join_sync',
        }));
        return;
      }

      // ---- Başlatma / oynatma / duraklatma / sarma ----
      if (data.action === 'play' || data.action === 'pause' || data.action === 'seek') {
        if (data.action === 'pause') {
          // Karşı taraf durdurduysa bizde de durdurulur ve durduğumuz saniye sunucuya bildirilir
          if (data.updated_by !== currentUserId) {
            const currentPos = getLivePlayerTime(playbackRef.current.position || 0);
            wsClient.send({
              type: 'cinema_position_reply',
              room_id: data.room_id,
              position: currentPos,
            });
            setPlayback((prev) => ({
              ...prev,
              position: currentPos,
              isPlaying: false,
              duration: data.duration || room.duration || prev.duration || 0,
              anchorMs: Date.now(),
              updatedBy: data.updated_by,
              lastAction: 'pause',
            }));
          } else {
            setPlayback((prev) => ({
              ...prev,
              isPlaying: false,
              anchorMs: Date.now(),
              lastAction: 'pause',
            }));
          }
          return;
        }

        if (data.action === 'play') {
          // Oynat komutu: sunucunun belirlediği saniyeye iki cihaz da hizalanır ve başlar
          setPlayback({
            position: data.position,
            isPlaying: true,
            duration: data.duration || room.duration || 0,
            anchorMs: Date.now(),
            updatedBy: data.updated_by,
            lastAction: 'play',
          });
          return;
        }

        if (data.action === 'seek') {
          if (data.updated_by === currentUserId) return;
          setPlayback({
            position: data.position,
            isPlaying: data.is_playing,
            duration: data.duration || room.duration || 0,
            anchorMs: Date.now(),
            updatedBy: data.updated_by,
            lastAction: 'seek',
          });
          return;
        }
      }

      if (data.updated_by === currentUserId) return;
    });

    // ---- İKİSİ DE HAZIR: film AYNI ANDA başlar ----
    const unsubPlay = wsClient.on('cinema_play', (data: any) => {
      const room = roomRef.current;
      if (!room || room.id !== data?.room_id) return;
      setPlayback((prev) => ({
        position: Number(data.position) || 0,
        isPlaying: true,
        duration: prev.duration || room.duration || 0,
        anchorMs: Date.now(),
        lastAction: 'play',
      }));
      setWaitingPartner(false);
    });

    // Sunucuda bir film "başlatıldı": filmi BEN başlatmadıysam kendiliğinden
    // salona girmem. Otomatik giriş yalnızca sunucu tarafında seansı açan
    // kişi için geçerlidir; karşı taraf "Katıl" davetini görür.
    const unsubStarted = wsClient.on('cinema_started', (data: any) => {
      if (!data?.room) return;
      if (data.started_by === currentUserId) {
        if (
          startingRoomRef.current ||
          enteringRef.current ||
          roomRef.current?.id === data.room.id
        ) {
          return;
        }
        void enterRoom(
          data.room as CinemaRoom,
          {
            position: data.room.position || 0,
            // SADE MODEL: film HENÜZ oynamıyor. İki cihaz da hazır olunca
            // `cinema_play` gelir ve ikisi AYNI ANDA başlar.
            is_playing: false,
            wait_for_ready: true,
            duration: data.room.duration || 0,
          },
          false
        );
        return;
      }
      // Partner film başlattı: SADECE bilgi ver, kullanıcıyı salona sürükleme.
      soundEngine.playLoveChime();
      playHaptic(HAPTIC_PATTERNS.butterfly);
      setPartnerSession({
        roomId: data.room.id,
        title: data.title || data.room.title,
        by: data.started_by || 'calendar',
      });
    });

    const unsubCreated = wsClient.on('cinema_room_created', () => loadRooms());
    const unsubDeleted = wsClient.on('cinema_room_deleted', (data: any) => {
      loadRooms();
      // Silinen film şu an perdedeyse perdeyi kapat: hayalet salon kalmasın.
      if (data?.room_id && roomRef.current?.id === data.room_id) {
        void leaveRoom(false);
      }
    });

    const unsubPresence = wsClient.on('cinema_presence', (data: any) => {
      if (data?.user_id !== partnerId) return;
      const watching = Boolean(data.is_watching);
      setPartnerWatching(watching);
      if (partnerJoinTimerRef.current !== null) {
        window.clearTimeout(partnerJoinTimerRef.current);
        partnerJoinTimerRef.current = null;
      }
      if (watching) {
        setPartnerJustJoined(true);
        partnerJoinTimerRef.current = window.setTimeout(() => {
          partnerJoinTimerRef.current = null;
          setPartnerJustJoined(false);
        }, 4000);
      } else {
        setPartnerJustJoined(false);
      }
    });

    const unsubReaction = wsClient.on('cinema_reaction', (data: any) => {
      if (data?.sender === currentUserId) return;
      addFloatingEmoji(data.emoji || '❤️');
    });

    // ---- Salona biri girdi: CANLI konumumuzu bildir (tek tur) ----
    // Murat 11:00'da izliyor, Selin odaya giriyor. Sunucu Murat'a "şu an
    // kaçıncı saniyedesin?" diye sorar; Murat BİR KEZ cevap verir. Sunucu
    // ikisini de o saniyeye hizalar. Sürekli bildirim YOK.
    const unsubPosReq = wsClient.on('cinema_position_request', (data: any) => {
      const room = roomRef.current;
      if (!room || room.id !== data?.room_id) return;
      const pos = getLivePlayerTime(playbackRef.current.position || 0);
      wsClient.send({
        type: 'cinema_position_reply',
        room_id: room.id,
        position: pos,
      });
    });

    // ---- Partner kalp atışı: SADECE "salonda" rozeti ----
    const unsubHeartbeat = wsClient.on('cinema_heartbeat', (data: any) => {
      if (data?.user_id !== partnerId) return;
      setPartnerWatching(true);
    });

    return () => {
      unsubSync();
      unsubPlay();
      unsubStarted();
      unsubCreated();
      unsubDeleted();
      unsubPresence();
      unsubReaction();
      unsubPosReq();
      unsubHeartbeat();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, partnerId, loadRooms]);

  /* ---------------- Salona gir / çık ---------------- */
  /**
   * Salona girer. İki yerde kullanılır:
   *   - Kullanıcı "Salona Gir"e bastı (startWatch → sunucu oda döndürür),
   *   - partner film başlattı ve "Katıl"a bastı.
   * Geri tuşu handler'ı bu fonksiyonu referans tuttuğu için tanım sırası
   * önemlidir: `leaveRoom` yukarıda, `enterRoom` hemen altında tanımlıdır.
   */
  const enterRoom = async (room: CinemaRoom, state: any, isRemoteStart: boolean) => {
    if (enteringRef.current) return;
    enteringRef.current = true;
    lastRoomRef.current = room.id;
    readySentRef.current = null;
    lastDurationSent.current = 0;

    setActiveRoom(room);
    // SADE MODEL: salon açıldığında film HENÜZ oynamaz (yükleme ekranı).
    // İki cihaz da oynatıcısını hazırlayınca sunucu `cinema_play` yayınlar ve
    // ikisi AYNI ANDA başlar.
    const startsNow =
      Boolean(state?.is_playing ?? room.is_playing) && !Boolean(state?.fresh_start);
    setPlayback({
      position: state?.position ?? room.position ?? 0,
      isPlaying: startsNow,
      duration: state?.duration ?? room.duration ?? 0,
      anchorMs: Date.now(),
      lastAction: startsNow ? 'play' : 'join_sync',
    });
    setWaitingPartner(!startsNow && Boolean(state?.wait_for_ready));
    setCurtainOpen(false);
    if (curtainTimerRef.current !== null) {
      window.clearTimeout(curtainTimerRef.current);
    }
    curtainTimerRef.current = window.setTimeout(() => {
      curtainTimerRef.current = null;
      setCurtainOpen(true);
    }, 60);

    // Yön + tam ekran
    await enterCinemaFullscreen();
    try {
      if (Capacitor.isNativePlatform()) {
        await StatusBar.hide();
      }
    } catch {
      /* yok say */
    }

    wsClient.send({ type: 'cinema_presence', room_id: room.id, is_watching: true, title: room.title });
    // Salona giriş: kendi konumumuzu bildir. Sunucu, salonda ZATEN oynayan
    // tarafın saniyesini esas alıp ikisini de oraya hizalar (tek seferlik).
    api
      .controlCinemaRoom(room.id, {
        user_id: currentUserId,
        action: 'join',
        position: 0,
      })
      .catch(() => {});
    playHaptic(isRemoteStart ? HAPTIC_PATTERNS.attention : 25);
    enteringRef.current = false;
  };

  const leaveRoom = async (broadcastLeave = true) => {
    const room = roomRef.current;
    if (room) lastRoomRef.current = room.id;
    readySentRef.current = null;
    lastDurationSent.current = 0;
    if (curtainTimerRef.current !== null) {
      window.clearTimeout(curtainTimerRef.current);
      curtainTimerRef.current = null;
    }
    setActiveRoom(null);
    setWaitingPartner(false);
    setPlayback({ position: 0, isPlaying: false, duration: 0 });
    setPartnerWatching(false);

    // Salondan çıkışta partnerin ekranı ANINDA güncellensin: WS açık olsun
    // olmasın, HTTP ile de bildir. WS kopsa bile durum takılı kalmasın.
    if (room) {
      wsClient.send({ type: 'cinema_presence', room_id: room.id, is_watching: false });
      if (broadcastLeave) {
        try {
          await api.controlCinemaRoom(room.id, { user_id: currentUserId, action: 'leave' });
        } catch {
          /* yok say */
        }
      }
    }

    await exitCinemaFullscreen();
    try {
      if (Capacitor.isNativePlatform()) {
        await StatusBar.show();
        await StatusBar.setStyle({ style: Style.Light });
      }
    } catch {
      /* yok say */
    }
  };

  // Android geri tuşu: salon açıksa önce filmden çık (App bu fonksiyonu çağırır).
  useEffect(() => {
    onBackHandlerReadyRef.current?.(() => {
      if (!roomRef.current) return false;
      void leaveRoom(true);
      return true;
    });
    return () => onBackHandlerReadyRef.current?.(null);
  }, []);

  /**
   * Bileşen söküldüğünde (sekme değişimi, uygulama kapanışı) salonda kalma
   * durumunu temizle. Aksi halde partner "hâlâ sinemada" görür.
   */
  useEffect(() => {
    return () => {
      const room = roomRef.current;
      if (!room) return;
      wsClient.send({ type: 'cinema_presence', room_id: room.id, is_watching: false });
      api.controlCinemaRoom(room.id, { user_id: currentUserId, action: 'leave' }).catch(() => {});
      roomRef.current = null;
    };
  }, [currentUserId]);

  const startWatch = async (room: CinemaRoom) => {
    if (enteringRef.current || startingRoomRef.current) return;
    startingRoomRef.current = true;
    playHaptic(30);
    try {
      // ---- Salonda ZATEN oynayan bir film var mı? ----
      // Varsa `start` ÇAĞIRMA: `start` filmi sıfırlar ve karşı tarafın
      // filmini durdururdu. Bunun yerine doğrudan salona gir; giriş
      // senkronu (`join`) ikisini de oynayan tarafın saniyesine hizalar.
      const live = await api.getCurrentCinemaRoom();
      const alreadyPlaying = Boolean(
        live && live.id === room.id && live.is_active && live.is_playing
      );

      if (alreadyPlaying && live) {
        await enterRoom(
          live,
          {
            position: live.position || 0,
            is_playing: true,
            duration: live.duration || 0,
          },
          false
        );
        return;
      }

      const started = await api.startCinemaRoom(room.id, currentUserId);
      // SADE MODEL: film HENÜZ başlamaz. İki cihaz da oynatıcısını hazırlar,
      // sonra sunucu `cinema_play` yayınlar ve ikisi AYNI ANDA başlar.
      await enterRoom(started, {
        position: 0,
        is_playing: false,
        wait_for_ready: true,
        duration: 0,
      }, false);
    } catch (e) {
      console.error(e);
    } finally {
      startingRoomRef.current = false;
    }
  };

  /* ---------------- Oynat / duraklat / sarma yayınla ---------------- */
  //
  // SADE MODEL: her komut sunucuya gider.
  //   - `pause`: ikisi de durur.
  //   - `play` : sunucu GERİDE OLANIN saniyesini seçer ve geri gönderir;
  //              iki cihaz da o saniyeye hizalanır.
  const broadcastPlayback = useCallback(
    (next: Partial<PlaybackState>, action: 'play' | 'pause' | 'seek') => {
      const room = roomRef.current;
      if (!room) return;

      const merged: PlaybackState = {
        ...playbackRef.current,
        ...next,
        anchorMs: Date.now(),
        lastAction: action,
      };
      playbackRef.current = merged;
      setPlayback(merged);

      // Sarma için çok hızlı tekrar istekleri birleştir.
      const now = Date.now();
      if (action === 'seek' && now - lastSyncRef.current < 220) return;
      lastSyncRef.current = now;

      api
        .controlCinemaRoom(room.id, {
          user_id: currentUserId,
          action,
          position: merged.position,
          duration: merged.duration && merged.duration > 0 ? merged.duration : undefined,
        })
        .catch(() => {});
    },
    [currentUserId]
  );
  /* ---------------- İlerleme bildirimi (SADE MODEL) ---------------- */
  //
  // Sunucuya periyodik konum YAZILMAZ (checkpoint yok). Burada yalnızca
  // ilerleme çubuğu ve "film bitti" tespiti için yerel durum güncellenir.
  /**
   * Bekleme sırasında yedek kontrol: `cinema_play` WS mesajı kaçarsa da
   * film başlasın. 1.5 saniyede bir oda durumunu sorar.
   */
  useEffect(() => {
    if (!waitingPartner || !activeRoom) return;
    const roomId = activeRoom.id;
    const timer = window.setInterval(async () => {
      try {
        const live = await api.getCurrentCinemaRoom();
        if (live && live.id === roomId && live.is_playing) {
          setWaitingPartner(false);
          setPlayback((prev) => ({
            ...prev,
            position: live.position || 0,
            isPlaying: true,
            duration: live.duration || prev.duration,
            anchorMs: Date.now(),
            lastAction: 'play',
          }));
        }
      } catch {
        /* yok say */
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [waitingPartner, activeRoom?.id]);

  const lastDurationSent = useRef(0);
  const handleVideoState = useCallback(
    (position: number, dur: number) => {
      // Süre: bir kez öğrenilince sunucuya bildir (iki taraf da bilsin).
      if (dur > 0 && Math.abs(dur - lastDurationSent.current) > 0.5) {
        lastDurationSent.current = dur;
        setPlayback((prev) => ({ ...prev, duration: dur }));
        const room = roomRef.current;
        if (room) {
          api
            .controlCinemaRoom(room.id, {
              user_id: currentUserId,
              action: 'duration',
              duration: dur,
            })
            .catch(() => {});
        }
      }

      // Film bitti: yalnızca oynarken ve anlamlı sürede lobiye dön.
      if (
        playbackRef.current.isPlaying &&
        dur > 5 &&
        isFilmFinished(position, lastDurationSent.current || dur)
      ) {
        void leaveRoom(true);
      }
    },
    [currentUserId]
  );

  /* ---------------- HAZIR OLMA KAPISI (SADE MODEL) ---------------- */
  //
  // İki cihaz da yükleyince film AYNI ANDA başlar. Bu yüzden oynatıcı hazır
  // olunca sunucuya "hazırım" deriz; sunucu ikisini görünce cinema_play
  // yayınlar ve ikisi de o saniyeden başlar.
  const readySentRef = useRef<number | null>(null);
  const handlePlayerReady = useCallback(
    (duration: number) => {
      const room = roomRef.current;
      if (!room) return;
      if (duration > 0) {
        setPlayback((prev) => ({ ...prev, duration: duration || prev.duration }));
      }
      if (readySentRef.current === room.id) return;
      readySentRef.current = room.id;

      api
        .markCinemaReady(room.id, currentUserId, 0)
        .then((res: any) => {
          if (res?.started) {
            // İki cihaz da hazır: film ŞİMDİ başlıyor. WS mesajını beklemeye
            // gerek yok (yarış durumu olabilir); doğrudan başlat.
            setWaitingPartner(false);
            setPlayback((prev) => ({
              position: Number(res.position) || 0,
              isPlaying: true,
              duration: duration || prev.duration || roomRef.current?.duration || 0,
              anchorMs: Date.now(),
              lastAction: 'play',
            }));
          } else if (res?.waiting_for_partner) {
            setWaitingPartner(true);
          }
        })
        .catch(() => setWaitingPartner(false));
    },
    [currentUserId]
  );

  const handleForceStart = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;
    playHaptic(20);
    api
      .markCinemaReady(room.id, currentUserId, 0, true)
      .then((res: any) => {
        if (res?.started) {
          setWaitingPartner(false);
          setPlayback((prev) => ({
            ...prev,
            position: Number(res.position) || 0,
            isPlaying: true,
            duration: prev.duration || roomRef.current?.duration || 0,
            anchorMs: Date.now(),
            lastAction: 'play',
          }));
        }
      })
      .catch(() => setWaitingPartner(false));
  }, [currentUserId]);

  /* ---------------- Yanıp sönen tepkiler ---------------- */
  const addFloatingEmoji = (emoji: string) => {
    const id = Date.now() + Math.random();
    setFloatingEmojis((prev) => [...prev, { id, emoji, left: 10 + Math.random() * 80 }]);
    const timer = window.setTimeout(() => {
      emojiTimersRef.current = emojiTimersRef.current.filter((t) => t !== timer);
      setFloatingEmojis((prev) => prev.filter((e) => e.id !== id));
    }, 2400);
    emojiTimersRef.current.push(timer);
  };

  const sendReaction = async (emoji: string) => {
    const room = roomRef.current;
    if (!room) return;
    addFloatingEmoji(emoji);
    playHaptic(15);
    api.reactInCinema(room.id, currentUserId, emoji).catch(() => {});
  };

  /* ---------------- Yeni video ekle ---------------- */
  const openRoom = async (room: CinemaRoom) => {
    setRooms((prev) => [room, ...prev.filter((r) => r.id !== room.id)]);
    setLinkInput('');
    setTitleInput('');
    await startWatch(room);
  };

  const handleAddVideo = async () => {
    const url = linkInput.trim();
    if (!url) {
      setAddError('Bir video bağlantısı yapıştır 🔗');
      return;
    }
    setIsAdding(true);
    setAddError(null);
    playHaptic(20);

    try {
      const resolved = await api.resolveCinemaLink(url);
      // Film sitesi ise sayfa başlığını film adı olarak kullan
      const autoTitle =
        titleInput.trim() ||
        (resolved.page_title
          ? resolved.page_title.replace(/\s*[-|].*$/, '').trim()
          : resolved.source.charAt(0).toUpperCase() + resolved.source.slice(1) + ' videosu');

      const room = await api.createCinemaRoom({
        title: autoTitle,
        video_url: cinemaVideoUrl(resolved.video_url || url),
        created_by: currentUserId,
        kind: resolved.kind,
        poster_url: resolved.poster_url || undefined,
        // Sunucunun bulduğu GERÇEK oynatıcı adresi (YouTube/player) mutlaka
        // gönderilir. Gönderilmezse sunucu film sitesinin kendi HTML sayfasını
        // iframe'e gömüyordu: site çerçeve içinde açılmadığı için perde sonsuz
        // "Perde hazırlanıyor" ekranında kalıyordu.
        embed_url: resolved.embed_url || undefined,
        // Film sitesinden çözülen GERÇEK akış. Sayfa adresi yerine bu gelirse
        // perde kendi oynatıcısında oynar: "kara ekran" sorunu biter.
        stream_url: resolved.stream_url || undefined,
        stream_referer: resolved.stream_referer || undefined,
        source: resolved.source,
      });

      // Gömme (YouTube, Vimeo...) sitede, video dosyası doğrudan perdede oynar.
      await openRoom(room);
    } catch (e) {
      console.error(e);
      setAddError('Bu sayfada oynatılabilir film bulamadım. Filmin kendi izleme sayfasının adresini dene 🎬');
    } finally {
      setIsAdding(false);
    }
  };

  /* Telefondaki bir video dosyasını doğrudan salona yükle */
  const handleUploadVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsAdding(true);
    setAddError(null);
    playHaptic(25);

    try {
      const upload = await api.uploadMedia(file, 'cinema');
      const room = await api.createCinemaRoom({
        title: titleInput.trim() || file.name.replace(/\.[^.]+$/, '') || 'Bizim Filmimiz 🍿',
        video_url: cinemaVideoUrl(upload.url),
        created_by: currentUserId,
        kind: 'file',
      });
      await openRoom(room);
    } catch (err) {
      console.error(err);
      setAddError('Video yüklenemedi, tekrar dener misin?');
    } finally {
      setIsAdding(false);
    }
  };

  /* ---------------- Durum makinesi: salon mu, lobi mi? ---------------- */

  if (activeRoom) {
    return (
      <CinemaTheater
        room={activeRoom}
        currentUserId={currentUserId}
        partnerId={partnerId}
        playback={playback}
        partnerWatching={partnerWatching}
        partnerJustJoined={partnerJustJoined}
        isLandscape={isLandscape}
        curtainOpen={curtainOpen}
        floatingEmojis={floatingEmojis}
        onVideoState={handleVideoState}
        onUserPlayPause={(shouldPlay, atPosition) =>
          broadcastPlayback(
            { position: atPosition, isPlaying: shouldPlay },
            shouldPlay ? 'play' : 'pause'
          )
        }
        onUserSeek={(position) =>
          broadcastPlayback({ position, isPlaying: playbackRef.current.isPlaying }, 'seek')
        }
        onEnded={() => void leaveRoom(true)}
        onReady={handlePlayerReady}
        onForceStart={handleForceStart}
        waiting={waitingPartner}
        onReaction={sendReaction}
        onLeave={() => leaveRoom(true)}
        onEnterFullscreen={() => enterCinemaFullscreen()}
        onRoomChanged={(next) => {
          // Sahneye alınan yeni video: salon kaydı güncellendi. Oynatıcı
          // yeniden kurulur; yine "hazır ol" kapısından geçer.
          lastRoomRef.current = next.id;
          readySentRef.current = null;
          lastDurationSent.current = 0;
          setPlayback({ position: 0, isPlaying: false, duration: 0 });
          setWaitingPartner(true);
          setActiveRoom(next);
          setRooms((prev) => [next, ...prev.filter((r) => r.id !== next.id)]);
        }}
      />
    );
  }

  const currentPoster = rooms[0];

  /** Takvimden bir filme basılınca: sunucunun açtığı salonu perdeye koy. */
  const watchShowtime = async (showtime: Showtime) => {
    if (enteringRef.current) return;
    try {
      const current = await api.getCurrentCinemaRoom();
      const live =
        (current && (!showtime.room_id || current.id === showtime.room_id) ? current : null) ||
        (await api.listCinemaRooms()).find((r) =>
          showtime.room_id ? r.id === showtime.room_id : r.title === showtime.title
        ) ||
        current ||
        null;
      if (!live) return;
      const playing = Boolean(live.is_playing ?? true);
      await enterRoom(
        live,
        { position: live.position || 0, is_playing: playing, duration: live.duration || 0 },
        false
      );
    } catch (e) {
      console.error('Salona girilemedi', e);
    }
  };

  return (
    <div className="flex flex-col space-y-4">
      {/* ---- Partner film başlattı: katılmak ister misin? ---- */}
      {partnerSession && (
        <div className="relative overflow-hidden rounded-3xl border border-emerald-400/40 bg-gradient-to-r from-emerald-900/95 to-[#123a2c] p-3.5 shadow-lg animate-[popIn_0.3s_ease-out]">
          <div className="flex items-center gap-3">
            <span className="text-2xl animate-float">{emojiOf(partnerSession.by)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold tracking-[0.2em] text-emerald-300 uppercase">
                Sinema daveti
              </p>
              <p className="font-serif text-sm font-bold text-white truncate">
                {nameOf(partnerSession.by)} "{partnerSession.title}" izliyor
              </p>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <button
                onClick={async () => {
                  playHaptic(30);
                  try {
                    const live =
                      (await api.getCurrentCinemaRoom()) ||
                      (await api.listCinemaRooms()).find((r) => r.id === partnerSession.roomId) ||
                      null;
                    if (live) {
                      await enterRoom(
                        live,
                        {
                          position: live.position || 0,
                          is_playing: true,
                          duration: live.duration || 0,
                        },
                        true
                      );
                      setPartnerSession(null);
                    }
                  } catch (e) {
                    console.error(e);
                  }
                }}
                className="px-3 py-1.5 rounded-xl bg-emerald-400 text-emerald-950 text-[10px] font-bold active:scale-95"
              >
                Katıl
              </button>
              <button
                onClick={() => setPartnerSession(null)}
                className="px-3 py-1 rounded-xl bg-white/10 text-white/70 text-[10px] font-semibold"
              >
                Sonra
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Ana sahne: film seç, salonda izle ---- */}
      <HeroMoviePicker onWatch={startWatch} rooms={rooms} isLoading={isLoading} />

      {/* ---- "BU AYIN PERDESİ" — HER ZAMAN GÖRÜNÜR ----
          Takvim kutusu ile perde kartı AYRI tutulur: burası sadece seansları
          gösterir; takvim açılıp kapandığında bu kart yerinden oynamaz. */}
      <PeriodCurtain
        currentUserId={currentUserId}
        isCalendarOpen={showCalendar}
        onToggleCalendar={() => {
          setShowCalendar((open) => !open);
          playHaptic(18);
        }}
        onWatchShowtime={watchShowtime}
      />

      {/* ---- Sinema Takvimi: YALNIZCA açılıp kapanan kutu ---- */}
      {showCalendar && (
        <div className="animate-[fadeIn_0.25s_ease-out]">
          <CinemaCalendar
            currentUserId={currentUserId}
            onWatch={watchShowtime}
          />
        </div>
      )}

      {/* ---- Partner salonda mı? ---- */}
      <div className="rounded-3xl bg-white/85 backdrop-blur-md border border-amber-200/70 shadow-sm p-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Popcorn className="w-4 h-4 text-amber-500" />
            <h3 className="font-serif text-sm font-bold text-berry-950">Salon Durumu</h3>
          </div>
          <span
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold ${
              partnerWatching
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-stone-100 text-stone-500'
            }`}
          >
            {partnerWatching ? '●' : '○'} {nameOf(partnerId)} {partnerWatching ? 'salonda' : 'salonda değil'}
          </span>
        </div>
      </div>

      {/* ---- Hızlı link ile izleme (takvimde olmayan video) ---- */}
      <details className="rounded-3xl bg-white/85 backdrop-blur-md border border-amber-200/70 shadow-sm overflow-hidden">
        <summary className="cursor-pointer list-none p-3.5 flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <Link2 className="w-4 h-4 text-berry-600" />
            <span className="font-serif text-sm font-bold text-berry-950">
              Takvimsiz Hızlı İzle
            </span>
          </span>
          <ChevronRight className="w-4 h-4 text-stone-400" />
        </summary>
        <div className="px-3.5 pb-3.5 space-y-2">
          <textarea
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            rows={2}
            placeholder="Film bağlantısı"
            className="w-full px-3 py-2 rounded-xl border border-amber-200 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <input
            type="text"
            value={titleInput}
            onChange={(e) => setTitleInput(e.target.value)}
            placeholder="Film adı (isteğe bağlı)"
            className="w-full px-3 py-2 rounded-xl border border-amber-200 text-xs focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          {addError && <p className="text-[11px] text-rose-600 font-medium">{addError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleAddVideo}
              disabled={isAdding}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-gradient-to-r from-[#7f1030] to-berry-600 text-white text-xs font-bold shadow-md active:scale-[0.98] disabled:opacity-60"
            >
              {isAdding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isAdding ? 'Salon hazırlanıyor…' : 'Hemen İzle 🎬'}
            </button>
            <label className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-2xl bg-amber-50 border border-amber-300 text-berry-800 text-xs font-bold cursor-pointer active:scale-95">
              📁 Dosya
              <input
                type="file"
                accept="video/*"
                onChange={handleUploadVideo}
                disabled={isAdding}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </details>

      {currentPoster && currentPoster.is_active && (
        <button
          onClick={() => startWatch(currentPoster)}
          className="fixed bottom-24 right-4 z-30 flex items-center gap-2 px-4 py-2.5 rounded-full bg-amber-400 text-[#2a0713] text-xs font-bold shadow-xl shadow-amber-500/25 border border-amber-200/40 animate-bounce"
        >
          <Play className="w-4 h-4" />
          Sahnedeki Filme Dön
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Ana sahne: film afişleri yatay şeritte, tek dokunuşla salona gir    */
/* ------------------------------------------------------------------ */

const HeroMoviePicker: React.FC<{
  rooms: CinemaRoom[];
  isLoading: boolean;
  onWatch: (room: CinemaRoom) => void;
}> = ({ rooms, isLoading, onWatch }) => {
  const [index, setIndex] = useState(0);
  const safeIndex = Math.min(index, Math.max(0, rooms.length - 1));
  const room = rooms[safeIndex];
  const poster = room ? mediaUrl(room.poster_url) : '';

  if (isLoading) {
    return (
      <div className="rounded-3xl bg-[#2a0713] h-56 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-amber-300 animate-spin" />
      </div>
    );
  }

  if (!room) {
    return (
      <div
        className="relative rounded-3xl overflow-hidden border border-amber-400/25 p-6 text-center"
        style={{ background: 'linear-gradient(135deg, #2a0713 0%, #5c0a20 60%, #7f1030 100%)' }}
      >
        <div className="text-5xl mb-2 animate-float">🎬</div>
        <h3 className="font-serif text-base font-bold text-white">Salon hazır</h3>
        <p className="text-[11px] text-white/70 mt-1 max-w-[240px] mx-auto">
          Aşağıya bir film bağlantısı yapıştır, salonu birlikte açalım 🍿
        </p>
      </div>
    );
  }

  return (
    <div className="relative rounded-3xl overflow-hidden border border-amber-400/25 shadow-xl shadow-berry-900/25">
      {/* Afiş arka planı */}
      <div className="absolute inset-0 bg-[#1a0510]">
        {poster && (
          <img
            src={poster}
            alt=""
            className="w-full h-full object-cover opacity-45"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#1a0510] via-[#1a0510]/85 to-[#1a0510]/30" />
      </div>

      <div className="relative p-4">
        <div className="flex items-start justify-between">
          <span className="text-[9px] font-bold tracking-[0.28em] text-amber-300/85 uppercase">
            Şimdi sahnede
          </span>
          {room.is_active && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-400 text-[#2a0713]">
              OYNUYOR
            </span>
          )}
        </div>

        <div className="mt-6">
          <h3 className="font-serif text-xl font-bold text-white leading-tight line-clamp-2 drop-shadow">
            {room.title}
          </h3>
          <p className="text-[10px] text-white/55 mt-1">
            {emojiOf(room.created_by)} {nameOf(room.created_by)} ekledi
            {room.duration ? ` · ${Math.round(room.duration / 60)} dk` : ''}
          </p>
        </div>

        <button
          onClick={() => {
            playHaptic(25);
            onWatch(room);
          }}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl bg-gradient-to-r from-amber-400 to-rose-400 text-[#2a0713] text-xs font-bold shadow-lg active:scale-[0.98]"
        >
          <Play className="w-4 h-4" />
          Salona Gir
        </button>

        {/* Diğer filmler: küçük afiş şeridi */}
        {rooms.length > 1 && (
          <div className="flex gap-1.5 mt-3 overflow-x-auto no-scrollbar">
            {rooms.map((r, i) => (
              <button
                key={r.id}
                onClick={() => {
                  setIndex(i);
                  playHaptic(12);
                }}
                className={`shrink-0 w-12 h-16 rounded-lg overflow-hidden border-2 transition-all ${
                  i === safeIndex ? 'border-amber-400 scale-105' : 'border-white/15 opacity-65'
                }`}
              >
                {r.poster_url ? (
                  <img src={mediaUrl(r.poster_url)} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="w-full h-full flex items-center justify-center bg-black/60">
                    <Film className="w-4 h-4 text-amber-300/70" />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* "Bu ayın perdesi" kartı — HER ZAMAN GÖRÜNÜR
 *
 * Takvimden BAĞIMSIZ çalışır:
 *   - Bu ayın seanslarını kendi yükler (takvim açık da olsa kapalı da olsa),
 *   - "Takvimi Gör / Gizle" yalnızca TAKVİM kutusunu açar-kapatır,
 *     bu kart yerinden oynamaz ve kaybolmaz.
 * ------------------------------------------------------------------ */

const MONTHS_TR = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const shortDateTR = (iso: string): string => {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS_TR[(month || 1) - 1]}`;
};

const PeriodCurtain: React.FC<{
  currentUserId: UserId;
  isCalendarOpen: boolean;
  onToggleCalendar: () => void;
  onWatchShowtime: (show: Showtime) => void;
}> = ({ currentUserId, isCalendarOpen, onToggleCalendar, onWatchShowtime }) => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const today = isoDate(now);

  const [shows, setShows] = useState<Showtime[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tabsOpen, setTabsOpen] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.listShowtimes(month, currentUserId);
      setShows(data);
    } catch (e) {
      console.error('Bu ayın perdesi yüklenemedi', e);
    } finally {
      setIsLoading(false);
    }
  }, [month, currentUserId]);

  useEffect(() => {
    load();
    // Takvimdeki her değişiklik bu kartı da tazeler (iki ayrı kutu, tek kaynak).
    const unsubAdded = wsClient.on('cinema_showtime_added', load);
    const unsubUpdated = wsClient.on('cinema_showtime_updated', load);
    const unsubDeleted = wsClient.on('cinema_showtime_deleted', load);
    const unsubImport = wsClient.on('cinema_calendar_updated', load);
    const unsubTicket = wsClient.on('cinema_ticket_booked', load);
    const unsubTicketCancel = wsClient.on('cinema_ticket_cancelled', load);
    return () => {
      unsubAdded();
      unsubUpdated();
      unsubDeleted();
      unsubImport();
      unsubTicket();
      unsubTicketCancel();
    };
  }, [load]);

  const upcoming = useMemo(
    () =>
      shows
        .filter((s) => s.show_date >= today)
        .sort((a, b) => (a.show_date + a.show_time).localeCompare(b.show_date + b.show_time)),
    [shows, today]
  );
  const tonight = shows
    .filter((s) => s.show_date === today)
    .sort((a, b) => a.show_time.localeCompare(b.show_time))[0];
  const next = upcoming[0];
  const myTickets = shows.filter((s) => s.my_ticket).length;
  const preview = upcoming.slice(0, 4);

  /** Premiere: biletini al ve perdeyi aç. Takvimi açmaya gerek yok. */
  const handlePremiere = async (show: Showtime) => {
    if (busyId !== null) return;
    setBusyId(show.id);
    try {
      let current = show;
      if (!current.my_ticket) {
        current = await api.bookTicket(show.id, currentUserId);
        soundEngine.playLoveChime();
      }
      const opened = await api.openShowtime(current.id, currentUserId);
      onWatchShowtime(opened);
    } catch (e: any) {
      console.error('Perde açılamadı', e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="relative overflow-hidden rounded-3xl text-white shadow-xl shadow-berry-900/30 border border-amber-400/25"
      style={{ background: 'linear-gradient(135deg, #2a0713 0%, #4a0f24 55%, #7f1030 100%)' }}
    >
      {/* perde ışığı */}
      <div
        className="absolute inset-0 opacity-40 pointer-events-none animate-[lightsSweep_9s_ease-in-out_infinite]"
        style={{
          background:
            'conic-gradient(from 205deg at 18% 0%, rgba(255,225,170,0.5), transparent 38%), conic-gradient(from -25deg at 82% 0%, rgba(255,120,170,0.42), transparent 38%)',
        }}
      />

      <div className="relative px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[9px] font-bold tracking-[0.28em] text-amber-300/85 uppercase">
              Bu ayın perdesi
            </p>
            <h2 className="font-serif text-xl font-bold tracking-wide mt-0.5">
              {MONTHS_TR[now.getMonth()]} {now.getFullYear()} 🎬
            </h2>
            <p className="text-[11px] text-white/70 mt-0.5">
              {isLoading
                ? 'Perde hazırlanıyor…'
                : `${shows.length} seans · ${myTickets} biletin var`}
            </p>
          </div>
          <button
            onClick={onToggleCalendar}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-bold shadow-md active:scale-95 transition-all ${
              isCalendarOpen ? 'bg-white/15 text-white border border-white/25' : 'bg-white/95 text-berry-700'
            }`}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            {isCalendarOpen ? 'Takvimi Gizle' : 'Takvimi Gör'}
          </button>
        </div>

        {/* Mini özet: bu akşam + sıradaki */}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <div className="rounded-2xl bg-white/12 backdrop-blur-xs px-3 py-2 border border-white/10">
            <div className="flex items-center gap-1.5 text-[9px] text-amber-200/90 font-semibold uppercase tracking-wide">
              <Popcorn className="w-3 h-3" />
              Bu akşam
            </div>
            <p className="font-serif text-xs font-bold mt-0.5 truncate">
              {tonight ? `${tonight.show_time} · ${tonight.title}` : 'Seans yok'}
            </p>
          </div>
          <div className="rounded-2xl bg-white/12 backdrop-blur-xs px-3 py-2 border border-white/10">
            <div className="flex items-center gap-1.5 text-[9px] text-rose-200/90 font-semibold uppercase tracking-wide">
              <Ticket className="w-3 h-3" />
              Sıradaki
            </div>
            <p className="font-serif text-xs font-bold mt-0.5 truncate">
              {next ? `${shortDateTR(next.show_date)} · ${next.title}` : 'Takvim boş'}
            </p>
          </div>
        </div>

        {/* Öne çıkan seans — tek dokunuşla perde */}
        {next ? (
          <div className="mt-3 rounded-2xl bg-black/25 border border-white/10 p-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-16 rounded-xl overflow-hidden shrink-0 bg-black/60 flex items-center justify-center">
                {next.poster_url ? (
                  <img
                    src={mediaUrl(next.poster_url)}
                    alt=""
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                ) : (
                  <Film className="w-5 h-5 text-amber-300/70" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-serif text-sm font-bold truncate">{next.title}</p>
                <p className="text-[10px] text-white/65 mt-0.5 truncate">
                  {shortDateTR(next.show_date)} · {next.show_time} · {next.hall}
                </p>
                <p className="text-[9px] text-white/50 mt-0.5">
                  {next.booked_count}/{next.seats} bilet ·{' '}
                  {next.my_ticket ? 'biletin hazır 🎟️' : 'bilet almadan izleyemezsin'}
                </p>
              </div>
              <button
                onClick={() => handlePremiere(next)}
                disabled={busyId !== null}
                className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-xl bg-gradient-to-r from-amber-400 to-rose-400 text-[#2a0713] text-[10px] font-bold active:scale-95 disabled:opacity-60"
              >
                {busyId === next.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Play className="w-3.5 h-3.5" />
                )}
                Perdeyi Aç
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 rounded-2xl bg-black/25 border border-dashed border-white/15 p-3 text-center">
            <p className="text-[11px] text-white/70">
              {isLoading ? 'Perde hazırlanıyor…' : 'Bu ay için seans yok'}
            </p>
            <p className="text-[10px] text-white/45 mt-0.5">
              Film eklemek için takvimi aç
            </p>
          </div>
        )}

        {/* Yaklaşan seanslar — kart İÇİNDE, her zaman görünür */}
        {preview.length > 0 && (
          <div className="mt-3">
            <button
              onClick={() => {
                setTabsOpen((open) => !open);
                playHaptic(12);
              }}
              className="w-full flex items-center justify-between text-[10px] font-bold text-amber-100/85"
            >
              <span className="flex items-center gap-1.5">
                <Clapperboard className="w-3 h-3" />
                Bu ayın filmleri
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform ${tabsOpen ? 'rotate-90' : ''}`}
              />
            </button>

            <div className={`${tabsOpen ? 'grid' : 'flex'} gap-1.5 mt-1.5 overflow-x-auto no-scrollbar ${
              tabsOpen ? 'grid-cols-2' : ''
            }`}>
              {preview.map((show) => (
                <button
                  key={show.id}
                  onClick={() => handlePremiere(show)}
                  disabled={busyId !== null}
                  className="shrink-0 text-left rounded-xl bg-white/10 border border-white/10 px-2.5 py-1.5 active:scale-[0.98] disabled:opacity-60"
                >
                  <span className="block text-[10px] font-bold text-white truncate">
                    {show.title}
                  </span>
                  <span className="block text-[9px] text-white/55 truncate">
                    {shortDateTR(show.show_date)} · {show.show_time}
                    {show.my_ticket ? ' · 🎟️' : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Sinema şeridi */}
      <div className="relative h-3 flex justify-around items-center bg-black/50">
        {Array.from({ length: 22 }).map((_, i) => (
          <span key={i} className="w-1.5 h-1.5 rounded-[1px] bg-amber-200/55" />
        ))}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Sinema salonu (tam ekran perde)                                     */
/* ------------------------------------------------------------------ */

const CinemaTheater: React.FC<{
  room: CinemaRoom;
  currentUserId: UserId;
  partnerId: UserId;
  playback: PlaybackState;
  partnerWatching: boolean;
  partnerJustJoined: boolean;
  isLandscape: boolean;
  curtainOpen: boolean;
  floatingEmojis: { id: number; emoji: string; left: number }[];
  onVideoState: (position: number, duration: number) => void;
  onUserPlayPause: (shouldPlay: boolean, atPosition: number) => void;
  onUserSeek: (position: number) => void;
  onEnded?: () => void;
  onReady: (duration: number) => void;
  onForceStart?: () => void;
  /** SADE MODEL: iki cihaz da hazır olana kadar bekleme göstergesi. */
  waiting: boolean;
  onReaction: (emoji: string) => void;
  onLeave: () => void;
  onEnterFullscreen: () => void;
  /** Kullanıcı sahneye yeni bir video aldı: salon kaydı güncellendi. */
  onRoomChanged?: (next: CinemaRoom) => void;
}> = ({
  room,
  partnerId,
  playback,
  partnerWatching,
  partnerJustJoined,
  isLandscape,
  curtainOpen,
  floatingEmojis,
  onVideoState,
  onUserPlayPause,
  onUserSeek,
  onEnded,
  onReady,
  onForceStart,
  waiting,
  onReaction,
  onLeave,
  onEnterFullscreen,
  onRoomChanged,
}) => {
  /* Geri tuşu / Android geri = salonu kapat */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  const isWebSite =
    room.kind === 'embed' &&
    (room.source === 'unsupported' || !looksLikeYouTubeLink(room.video_url || ''));

  return (
    <div
      className="fixed inset-0 z-[90] bg-black overflow-hidden select-none animate-[fadeIn_0.4s_ease-out]"
      style={{ colorScheme: 'dark' }}
    >
      {/* Duvarlar, perdeler, projektör */}
      <SalonDecor playing={playback.isPlaying} />

      {/* Perde / ekran çerçevesi */}
      <div
        className="absolute z-[16] rounded-[14px] overflow-hidden select-auto"
        style={{
          left: !isLandscape || isWebSite ? '3%' : '11.5%',
          right: !isLandscape || isWebSite ? '3%' : '11.5%',
          top: isWebSite ? '8%' : isLandscape ? '11%' : '13%',
          bottom: isWebSite ? '10%' : isLandscape ? '11%' : '19%',
          boxShadow:
            '0 0 0 4px rgba(212,175,105,0.35), 0 0 0 10px rgba(40,8,18,0.9), 0 0 70px rgba(255,210,150,0.22), inset 0 0 40px rgba(0,0,0,0.8)',
          background: '#050505',
        }}
      >
        <CinemaStage
          room={room}
          state={playback}
          onProgress={onVideoState}
          onUserPlayPause={onUserPlayPause}
          onUserSeek={onUserSeek}
          onEnded={onEnded}
          onReady={onReady}
          onRoomChanged={onRoomChanged}
        />

        {/* ---- SADE MODEL: iki cihaz da hazır olana kadar bekle ---- */}
        {waiting && !playback.isPlaying && (
          <div className="absolute inset-0 z-[17] flex flex-col items-center justify-center gap-3 bg-black/85 text-center px-8">
            <Loader2 className="w-9 h-9 text-amber-300 animate-spin" />
            <p className="text-amber-100 font-serif text-sm font-bold">
              İki cihaz da hazırlanınca başlayacak 🎬
            </p>
            <p className="text-white/50 text-[11px] max-w-xs leading-snug">
              Sen ve {nameOf(partnerId)} aynı anda başlamak için bekleniyorsunuz.
            </p>
            {onForceStart && (
              <button
                onClick={onForceStart}
                className="mt-1 px-4 py-2 rounded-full bg-amber-400 text-cinema-950 text-xs font-bold shadow-lg active:scale-95"
              >
                Tek Başına Başlat ▶
              </button>
            )}
          </div>
        )}

        {/* Kayan yıldız animasyonu (film başlarken) */}
        {!curtainOpen && <div className="absolute inset-0 bg-black" />}
      </div>

      {/* İçerik: başlık + kontroller */}
      <div className="absolute inset-x-0 top-0 z-[12] flex items-start justify-between px-4 pt-3 pointer-events-none">
        <div className="pointer-events-auto">
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold tracking-[0.25em] text-amber-300/80 uppercase animate-[cinematicIn_1.2s_ease-out]">
              Ahududu Sinema Salonu
            </span>
          </div>
          <h2 className="font-serif text-sm sm:text-base font-bold text-white/95 mt-0.5 max-w-[52vw] truncate">
            {room.title}
          </h2>
        </div>

        <div className="flex items-center gap-1.5 pointer-events-auto">
          <button
            onClick={onEnterFullscreen}
            className="px-2.5 py-1.5 rounded-full bg-white/10 backdrop-blur-xs text-[10px] font-bold text-white/85 hover:bg-white/20"
            title="Tam ekranı aç"
          >
            ⤢ Tam ekran
          </button>
          <button
            onClick={onLeave}
            className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-rose-600/90 backdrop-blur-xs text-[10px] font-bold text-white shadow-lg active:scale-95"
          >
            <X className="w-3.5 h-3.5" />
            Salondan Çık
          </button>
        </div>
      </div>

      {isLandscape ? (
        <>
          {/* Karakterlerimiz (yatayda perdenin sol yanında) */}
          <div className="absolute inset-y-0 left-0 w-[11.5%] z-[11] flex items-center justify-center pointer-events-none">
            <CharacterSeat
              userId={partnerId}
              isMe={false}
              isWatching={partnerWatching}
              playing={playback.isPlaying}
            />
          </div>

          {/* Sağ taraf: tepkiler */}
          <div className="absolute inset-y-0 right-0 w-[11.5%] z-[11] flex flex-col items-center justify-center gap-1.5 pointer-events-auto pr-1">
            {['❤️', '😂', '😱', '😍', '🍿'].map((e) => (
              <button
                key={e}
                onClick={() => onReaction(e)}
                className="w-9 h-9 rounded-full bg-white/10 backdrop-blur-xs flex items-center justify-center text-base hover:bg-white/25 active:scale-90 transition-all"
              >
                {e}
              </button>
            ))}
          </div>
        </>
      ) : (
        /* Dikey mod: koltuk rozeti + tepkiler perdenin altındaki boşlukta */
        <div className="absolute inset-x-3 bottom-3 z-[12] flex items-center justify-between gap-2 pointer-events-auto">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/70 border border-white/10 backdrop-blur-xs">
            <span className="text-lg">{emojiOf(partnerId)}</span>
            <span className="text-[11px] font-semibold text-amber-100">{nameOf(partnerId)}</span>
            <span
              className={`w-2 h-2 rounded-full ${
                partnerWatching ? 'bg-emerald-400 animate-pulse' : 'bg-stone-500'
              }`}
            />
          </div>
          <div className="flex items-center gap-1">
            {['❤️', '😂', '😱', '😍', '🍿'].map((e) => (
              <button
                key={e}
                onClick={() => onReaction(e)}
                className="w-9 h-9 rounded-full bg-white/10 backdrop-blur-xs flex items-center justify-center text-base hover:bg-white/25 active:scale-90 transition-all"
              >
                {e}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Partner katılım bildirimi */}
      {partnerJustJoined && (
        <div className="absolute left-1/2 -translate-x-1/2 top-14 z-[14] px-4 py-2 rounded-2xl bg-amber-400 text-cinema-950 text-xs font-bold shadow-xl animate-[popIn_0.4s_ease-out]">
          {emojiOf(partnerId)} {nameOf(partnerId)} sinemaya katıldı! 🍿
        </div>
      )}

      {/* Salonda ikiniz yokken ipucu */}
      {!partnerWatching && isLandscape && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[6%] z-[13] px-3.5 py-1.5 rounded-full bg-black/60 backdrop-blur-xs text-[10px] text-white/70 flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          {nameOf(partnerId)} bekleniyor… filmi başlatabilirsin
        </div>
      )}

      {/* Uçan tepkiler */}
      <div className="pointer-events-none absolute inset-0 z-[15] overflow-hidden">
        {floatingEmojis.map((f) => (
          <span
            key={f.id}
            className="absolute bottom-[18%] text-3xl animate-[floatUp_2.4s_ease-out_forwards]"
            style={{ left: `${f.left}%` }}
          >
            {f.emoji}
          </span>
        ))}
      </div>
    </div>
  );
};

export default CinemaSalon;
