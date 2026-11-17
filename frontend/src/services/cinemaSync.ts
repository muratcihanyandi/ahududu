/**
 * Sinema Salonu oynatma çekirdeği — SADE MODEL
 * --------------------------------------------
 * Murat'ın isteği net: "sürekli checkpoint, drift düzeltmesi, kalp atışı
 * istemiyorum. Sadece şu olsun:"
 *
 *   1. Film başlatılınca İKİ CİHAZ DA yükleme ekranında bekler; ikisi de
 *      hazır olunca AYNI ANDA başlar.
 *   2. Oynarken SENKRON YOK. Biri 20:11'de, diğeri 20:22'de olabilir.
 *      (Biri takılırsa/tampon beklerse kimse kimseyi geri çekmez.)
 *   3. Biri DURDURURSA ikisi de durur (kaldıkları yerde).
 *   4. Biri OYNATIRSA: GERİDE OLANIN saniyesi esas alınır; iki cihaz da o
 *      saniyeye sarılır ve birlikte devam eder.
 *
 * Bu dosya artık yalnızca YARDIMCI HESAPLAR içerir (saf fonksiyonlar).
 * Periyodik düzeltme motoru (SyncEngine), nudge, drift, EMA, heartbeat
 * YOKTUR — bilerek kaldırıldı.
 */

/** Sunucudan/partnerden gelen ortak oynatma durumu. */
export interface PlaybackState {
  position: number;
  isPlaying: boolean;
  duration?: number;
  /** Pozisyonun geçerli olduğu yerel zaman (ms). */
  anchorMs?: number;
  updatedBy?: string;
}

/** WebSocket `cinema_sync` mesajı (backend ile birebir aynı alanlar). */
export interface SyncMessage {
  room_id: number;
  /** `join_sync`: salona biri girdi, tek seferlik hizalama. */
  action: 'play' | 'pause' | 'seek' | 'join' | 'join_sync' | 'adopt' | 'leave' | 'stop' | string;
  position: number;
  duration: number;
  is_playing: boolean;
  is_active: boolean;
  updated_by: string;
  updated_at?: string;
  server_time_ms?: number;
  /** `play`/`join_sync` ise: hangi tarafın saniyesi esas alındı. */
  behind_by?: string;
}

/* ------------------------------------------------------------------ */
/* Oynatıcı soyutlaması                                                */
/* ------------------------------------------------------------------ */

/**
 * Hem <video> hem HLS (film sitelerinden çözülen akış) hem YouTube IFrame hem
 * de (best-effort) Vimeo oynatıcılarını aynı arayüzle kullanmamızı sağlar.
 * Tüm zamanlar SANİYEDİR.
 */
export interface PlayerAdapter {
  readonly kind: 'html5' | 'hls' | 'youtube' | 'vimeo';
  isReady(): boolean;
  getTime(): number;
  getDuration(): number;
  setTime(seconds: number): void;
  play(): void;
  pause(): void;
  isPaused(): boolean;
  isSeeking(): boolean;
  isEnded(): boolean;
  isBuffering(): boolean;
  setMuted?(muted: boolean): void;
  isMuted?(): boolean;
  setVolume?(volume: number): void;
  getVolume?(): number;
  destroy?(): void;
}

/* ------------------------------------------------------------------ */
/* Sabitler                                                            */
/* ------------------------------------------------------------------ */

/** Programatik çağrıların yankısını yutma penceresi (ms). */
export const SUPPRESS_ECHO_MS = 400;
/** Oyuncu hazır olduktan sonra bu kadar bekleyip başla (ikisi de yetişsin). */
export const READY_GRACE_MS = 600;

/* ------------------------------------------------------------------ */
/* Saf yardımcılar                                                     */
/* ------------------------------------------------------------------ */

/** Pozisyonu güvenli sınırlara (0..süre) kırpar. */
export const clampPosition = (pos: number, duration?: number): number => {
  if (!Number.isFinite(pos) || pos < 0) return 0;
  if (duration && duration > 0 && pos > duration) return duration;
  return pos;
};

/** Saniyeyi 1:23:45 / 12:30 biçimine çevirir. */
export const formatTime = (seconds?: number): string => {
  if (!seconds || !Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
};

/**
 * İki cihazdan HANGİSİ geride? (Senkron noktası = geride olanın saniyesi.)
 *
 * Murat 20:11, Selin 20:22 ise geride olan Murat'tır → ikisi de 20:11'den
 * devam eder. Eşitse (ya da biri bilinmiyorsa) mevcut saniye kullanılır.
 */
export const earlierPosition = (a: number, b: number): number => {
  const va = Number.isFinite(a) ? a : 0;
  const vb = Number.isFinite(b) ? b : 0;
  if (va <= 0 && vb <= 0) return 0;
  if (va <= 0) return vb;
  if (vb <= 0) return va;
  return Math.min(va, vb);
};

/**
 * Film gerçekten bitti mi? (Yalnızca sona çok yaklaşınca true.)
 *
 * Süre bilinmiyorsa bitmiş sayılmaz: yanlış "bitti" salonu erken kapatıyordu.
 */
export const isFilmFinished = (position: number, duration: number): boolean => {
  if (!(duration > 0) || !Number.isFinite(position)) return false;
  const tail = Math.min(2, Math.max(1, duration * 0.001));
  return position >= duration - tail;
};

/**
 * YouTube gömülü oynatıcısında bitmiş videoda `playVideo()` çoğu durumda
 * yok sayılır; önce başa sarmak gerekir.
 */
export const shouldRestartBeforePlay = (
  ended: boolean,
  currentTime: number,
  duration: number
): boolean => {
  if (!ended) return false;
  if (!(duration > 0)) return true;
  return currentTime >= duration - 0.75;
};

/** YouTube video kimliğini metinden çıkarır. */
export const YOUTUBE_VIDEO_ID_RE =
  /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export const extractYouTubeVideoId = (text?: string | null): string | null => {
  const match = (text || '').match(YOUTUBE_VIDEO_ID_RE);
  return match ? match[1] : null;
};

/** Metin bir YouTube video adresi mi? */
export const looksLikeYouTubeLink = (
  text?: string | null,
  opts: { allowEmbedded?: boolean } = {}
): boolean => {
  const value = (text || '').trim();
  if (!value || value.length > 2048) return false;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    /* yok say */
  }
  if (opts.allowEmbedded !== false && extractYouTubeVideoId(decoded)) return true;
  return /(^|[\s])(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(decoded);
};

/* ------------------------------------------------------------------ */
/* Oynatma durumu makinesi (saf)                                       */
/* ------------------------------------------------------------------ */

/**
 * Salonun anlık oynatma durumunu tutar. Ağ/oynatıcı yan etkisi YOKTUR;
 * yalnızca "ne olmalı" sorusunun cevabını üretir.
 *
 * Kullanım:
 *   const store = new PlaybackStore();
 *   store.sync({ isPlaying: false, position: 320 });   // duraklat
 *   store.sync({ isPlaying: true, position: 315 });    // geride olandan devam
 */
export class PlaybackStore {
  private state: PlaybackState = { position: 0, isPlaying: false };

  constructor(initial?: Partial<PlaybackState>) {
    if (initial) this.state = { ...this.state, ...initial };
  }

  getState(): PlaybackState {
    return this.state;
  }

  isPlaying(): boolean {
    return Boolean(this.state.isPlaying);
  }

  position(): number {
    return this.state.position || 0;
  }

  /** Durumu doğrudan kur (oynatıcıya dokunmaz). */
  set(next: Partial<PlaybackState>): PlaybackState {
    this.state = {
      ...this.state,
      ...next,
      position: clampPosition(
        next.position ?? this.state.position,
        next.duration ?? this.state.duration
      ),
      anchorMs: Date.now(),
    };
    return this.state;
  }

  /**
   * Oynat/duraklat/sarma komutunu uygula.
   *
   * Oyundayen gelen "play" komutunda konum `earlierPosition` ile çözülür:
   * geride olan cihazın saniyesi herkes için geçerli olur.
   */
  apply(command: {
    isPlaying: boolean;
    position?: number;
    duration?: number;
    earlierThan?: number;
  }): PlaybackState {
    const position =
      command.position === undefined
        ? this.state.position
        : command.isPlaying && command.earlierThan !== undefined
          ? earlierPosition(command.position, command.earlierThan)
          : command.position;
    return this.set({
      isPlaying: command.isPlaying,
      position,
      duration: command.duration ?? this.state.duration,
    });
  }

  reset(position = 0): void {
    this.state = { position, isPlaying: false, anchorMs: Date.now() };
  }
}
