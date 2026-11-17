/**
 * Sinema Salonu ortak oynatma çekirdeği (watchparty sync engine)
 * --------------------------------------------------------------
 * İki telefon da aynı "salona" girer; sunucu otoritedir:
 *
 *   position          -> komut verildiği andaki video saniyesi
 *   is_playing        -> o anda oynatılıyor muydu
 *   updated_at        -> sunucunun komutu kaydettiği an
 *
 * İstemci "şu an kaçıncı saniye olmalı" hesabını kendi yapar. Ağ gecikmesi
 * `ping/pong` ile ölçülür ve gelen komutlar RTT/2 kadar ileri alınır; böylece
 * iki taraf ekranda aynı saniyeyi görür.
 *
 * Düzeltme kademelidir (Houdini99/WatchSync yaklaşımı):
 *   |drift| <= settled (0.45s)      -> hiçbir şey yapma
 *   |drift| <= tolerance (1.5s)     -> hiçbir şey yapma (kayan nokta toleransı)
 *   |drift| <= 5s ve nudge mümkün   -> hızı ±%10'a kadar yumuşakça kaydır
 *   değilse ve cooldown geçtiyse    -> seek + 5 sn cooldown
 *
 * Kendi komutumuzun yankısı 2 sn "grace" ile susturulur: kullanıcı oynat/
 * duraklat/sarma yaptıktan hemen sonra motor tekrar düzeltmeye çalışmaz.
 * `isSeeking` sırasında ve `ended` durumda play() çağrılmaz.
 *
 * Bu dosya DOM'a bağımlı DEĞİLDİR: saf hesap + motor. Gerçek oynatıcılar
 * (`PlayerAdapter`) `services/youtubePlayer.ts` içindedir; test edilebilirlik
 * için zamAN kaynağı enjekte edilebilir.
 */

/** Sunucudan/partnerden gelen ortak oynatma durumu. */
export interface PlaybackState {
  position: number;
  isPlaying: boolean;
  duration?: number;
  /** Pozisyonun geçerli olduğu yerel zaman (ms). Yoksa "şimdi" kabul edilir. */
  anchorMs?: number;
  /** Oynatma hızı (1 = normal). Nudge sırasında 0.9 / 1.1 olabilir. */
  rate?: number;
  updatedBy?: string;
}

/** WebSocket `cinema_sync` mesajı (backend ile birebir aynı alanlar). */
export interface SyncMessage {
  room_id: number;
  action: string;
  position: number;
  duration: number;
  is_playing: boolean;
  is_active: boolean;
  updated_by: string;
  updated_at?: string;
  server_time_ms?: number;
}

/* ------------------------------------------------------------------ */
/* Oynatıcı soyutlaması                                                */
/* ------------------------------------------------------------------ */

/**
 * Hem <video> hem HLS (film sitelerinden çözülen akış) hem YouTube IFrame hem de
 * (best-effort) Vimeo oynatıcılarını aynı arayüzle kullanmamızı sağlar.
 * Tüm zamanlar SANİYEDİR.
 */
export interface PlayerAdapter {
  readonly kind: 'html5' | 'hls' | 'youtube' | 'vimeo';
  /** Oynatıcı hazır mı? (YouTube için onReady gelene kadar false) */
  isReady(): boolean;
  getTime(): number;
  getDuration(): number;
  setTime(seconds: number): void;
  play(): void;
  pause(): void;
  getRate(): number;
  setRate(rate: number): void;
  isPaused(): boolean;
  isSeeking(): boolean;
  isEnded(): boolean;
  isBuffering(): boolean;
  /** Yumuşak hız düzeltmesi destekliyor mu? (YouTube'da best-effort) */
  canNudgeRate(): boolean;
  /** Otomatik oynatma engellendiğinde sessize alınmış oynatıcıyı açar. */
  setMuted?(muted: boolean): void;
  isMuted?(): boolean;
  destroy?(): void;
}

/* ------------------------------------------------------------------ */
/* Sabitler                                                            */
/* ------------------------------------------------------------------ */

/** Bu farkın altında oynatıcı "yerinde" sayılır. */
export const SYNC_SETTLED_SECONDS = 0.45;
/** Bu farkın altında düzeltme YAPILMAZ (kayan nokta + codec toleransı). */
export const SYNC_TOLERANCE_SECONDS = 1.5;
/** Seek sonrası bu süre boyunca yeniden seek yapılmaz. */
export const SYNC_SEEK_COOLDOWN_MS = 5000;
/** Kendi komutumuzdan sonra düzeltme yapılmayan pencere. */
export const SYNC_GRACE_MS = 2000;
/** Yumuşak hız düzeltmesinin üst sınırı (saniye). */
export const SYNC_NUDGE_MAX_SECONDS = 5;
/** Maksimum hız kaydırma oranı (±%10). */
export const SYNC_NUDGE_RATIO = 0.1;
/** Oynatma sırasında sunucuya konum bildirme aralığı. */
export const HEARTBEAT_MS = 4000;
/** Partner bu süre boyunca kalp atışı göndermediyse "takıldı" sayılır. */
export const PARTNER_STALL_MS = 9000;
/** Programatik çağrıların yankısını yutma penceresi (ms). */
export const SUPPRESS_ECHO_MS = 400;
/** RTT EMA katsayısı. */
export const LATENCY_EMA_ALPHA = 0.3;

/* ------------------------------------------------------------------ */
/* Saf yardımcılar                                                     */
/* ------------------------------------------------------------------ */

/** Pozisyonu güvenli sınırlara (0..süre) kırpar. */
export const clampPosition = (pos: number, duration?: number): number => {
  if (!Number.isFinite(pos) || pos < 0) return 0;
  if (duration && duration > 0 && pos > duration) return duration;
  return pos;
};

/** Bir durumdan `atMs` anındaki beklenen saniyeyi hesaplar. */
export const expectedPosition = (state: PlaybackState, atMs: number = Date.now()): number => {
  const base = clampPosition(state.position, state.duration);
  if (!state.isPlaying) return base;
  const anchor = state.anchorMs ?? atMs;
  const rate = state.rate && state.rate > 0 ? state.rate : 1;
  const elapsed = Math.max(0, atMs - anchor) / 1000;
  return clampPosition(base + elapsed * rate, state.duration);
};

/** İki taraf arasındaki sapma (pozitif = biz ilerideyiz). */
export const drift = (current: number, expected: number): number => current - expected;

/** Eski API uyumluluğu: sapma toleransın üstünde mi? */
export const shouldCorrect = (current: number, expected: number): boolean =>
  Math.abs(drift(current, expected)) > SYNC_TOLERANCE_SECONDS;

/**
 * Partnerden gelen komutu RTT/2 ile ileri alır.
 *
 * Komut sunucuya gittiğinde kaydedilen `position`, biz mesajı aldığımızda
 * `(rtt/2)` saniyelik yoldan geçmiştir; oynuyorsa bu süre kadar ilerlemiş olur.
 */
export const compensateLatency = (
  state: PlaybackState,
  latencyMs: number,
  atMs: number = Date.now()
): PlaybackState => {
  const half = Math.max(0, latencyMs) / 2 / 1000;
  const rate = state.rate && state.rate > 0 ? state.rate : 1;
  return {
    ...state,
    position: clampPosition(state.position + (state.isPlaying ? half * rate : 0), state.duration),
    anchorMs: atMs,
  };
};

/** Yumuşak hız kaydırma değeri: ilerideyse yavaşlat, gerideyse hızlandır. */
export const nudgeRateFor = (baseRate: number, driftSeconds: number): number => {
  const amount = SYNC_NUDGE_RATIO * Math.min(1, Math.abs(driftSeconds) / SYNC_NUDGE_MAX_SECONDS);
  const rate = driftSeconds > 0 ? baseRate * (1 - amount) : baseRate * (1 + amount);
  return Math.min(2, Math.max(0.25, Number(rate.toFixed(3))));
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

/* ------------------------------------------------------------------ */
/* Ağ gecikmesi ölçümü                                                 */
/* ------------------------------------------------------------------ */

export interface LatencyProbeOptions {
  now?: () => number;
  /** Ölçüm yapılamazsa kullanılacak varsayılan. */
  fallbackMs?: number;
  /** Yanıt gelmezse yeni deneme için beklenecek süre. */
  timeoutMs?: number;
}

/**
 * `{"type":"ping"}` → `{"type":"pong"}` turu ile RTT ölçer.
 * Backend pong'a zaman damgası koymadığı için tek uçuşlu (single-flight)
 * ölçüm yapılır: gönderim anı saklanır, pong gelince fark alınır.
 */
export class LatencyProbe {
  private sentAt = 0;
  private pending = false;
  private now: () => number;

  latencyMs: number;

  constructor(
    private send: (message: unknown) => void,
    options: LatencyProbeOptions = {}
  ) {
    this.now = options.now ?? (() => Date.now());
    this.latencyMs = Math.max(0, options.fallbackMs ?? 150);
    this.timeoutMs = Math.max(500, options.timeoutMs ?? 4000);
  }

  private timeoutMs: number;

  /** Ping gönderir; önceki ping yanıtsız ve zaman aşımındaysa yeniden dener. */
  ping(): boolean {
    if (this.pending && this.now() - this.sentAt < this.timeoutMs) return false;
    this.pending = true;
    this.sentAt = this.now();
    try {
      this.send({ type: 'ping' });
    } catch {
      this.pending = false;
      return false;
    }
    return true;
  }

  /** Pong geldi: RTT'yi EMA ile yumuşatır. Ölçüm geçersizse null döner. */
  pong(): number | null {
    if (!this.pending) return null;
    this.pending = false;
    const rtt = Math.max(0, this.now() - this.sentAt);
    if (!Number.isFinite(rtt) || rtt > this.timeoutMs) return null;
    this.latencyMs = Math.round(
      this.latencyMs * (1 - LATENCY_EMA_ALPHA) + Math.min(rtt, 2000) * LATENCY_EMA_ALPHA
    );
    return rtt;
  }

  reset(): void {
    this.pending = false;
    this.sentAt = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Senkron motoru                                                      */
/* ------------------------------------------------------------------ */

export type SyncAction = 'none' | 'play' | 'pause' | 'nudge' | 'seek' | 'reset-rate';

export interface SyncDecision {
  action: SyncAction;
  /** Anlık sapma (pozitif = biz ilerideyiz). */
  drift: number;
  /** Hedef saniye. */
  target: number;
  /** nudge/reset-rate için uygulanacak hız. */
  rate?: number;
  reason: string;
}

export interface SyncEngineOptions {
  now?: () => number;
  latencyMs?: number;
  settledSeconds?: number;
  toleranceSeconds?: number;
  seekCooldownMs?: number;
  graceMs?: number;
  nudgeMaxSeconds?: number;
}

/**
 * Oynatıcı ile "beklenen" durum arasındaki farkı kademeli kapatır.
 * Durum değiştiğinde `applyState`, periyodik olarak `tick` çağrılır.
 */
export class SyncEngine {
  private state: PlaybackState = { position: 0, isPlaying: false };
  private adapter: PlayerAdapter | null = null;
  private now: () => number;

  private latencyMsValue: number;
  private settledSeconds: number;
  private toleranceSeconds: number;
  private seekCooldownMs: number;
  private graceMs: number;
  private nudgeMaxSeconds: number;

  private lastLocalActionAt = -Infinity;
  private lastSeekAt = -Infinity;
  private nudged = false;
  private baseRate = 1;
  /** Oynatıcı hazır değilken gelen durum burada bekler (late-join). */
  private pendingState: PlaybackState | null = null;
  /** Son karar — test/gözlem için. */
  lastDecision: SyncDecision = { action: 'none', drift: 0, target: 0, reason: 'başlangıç' };
  /** Süre bilgisi (oynatıcıdan). */
  duration = 0;

  constructor(options: SyncEngineOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.latencyMsValue = Math.max(0, options.latencyMs ?? 150);
    this.settledSeconds = options.settledSeconds ?? SYNC_SETTLED_SECONDS;
    this.toleranceSeconds = options.toleranceSeconds ?? SYNC_TOLERANCE_SECONDS;
    this.seekCooldownMs = options.seekCooldownMs ?? SYNC_SEEK_COOLDOWN_MS;
    this.graceMs = options.graceMs ?? SYNC_GRACE_MS;
    this.nudgeMaxSeconds = options.nudgeMaxSeconds ?? SYNC_NUDGE_MAX_SECONDS;
  }

  get latencyMs(): number {
    return this.latencyMsValue;
  }

  setLatency(ms: number): void {
    if (Number.isFinite(ms) && ms >= 0) this.latencyMsValue = Math.min(2000, ms);
  }

  getState(): PlaybackState {
    return this.state;
  }

  getAdapter(): PlayerAdapter | null {
    return this.adapter;
  }

  isNudged(): boolean {
    return this.nudged;
  }

  /**
   * Oynatıcıyı bağlar. Late-join: oynatıcı hazır olmadan gelen durum
   * uygulanmaz, `markReady()` çağrılınca uygulanır.
   */
  attach(adapter: PlayerAdapter): void {
    this.adapter = adapter;
    this.baseRate = adapter.getRate() || 1;
    if (adapter.getDuration() > 0) this.duration = adapter.getDuration();
    if (this.pendingState) {
      const pending = this.pendingState;
      this.pendingState = null;
      this.applyState(pending, { local: false, force: true });
    }
  }

  detach(): void {
    this.adapter = null;
    this.nudged = false;
    this.pendingState = null;
  }

  /** Oynatıcı hazır oldu: bekleyen durumu şimdi uygula (late-join gate). */
  markReady(): void {
    if (!this.adapter) return;
    this.duration = this.adapter.getDuration() || this.duration;
    const pending = this.pendingState;
    this.pendingState = null;
    if (pending) this.applyState(pending, { local: false, force: true });
    else this.applyState(this.state, { local: false, force: true });
  }

  /**
   * Sunucudan/partnerden gelen (ya da kullanıcının kendi verdiği) durumu uygular.
   * `local: true` ise kullanıcı az önce komut verdi → grace başlar.
   */
  applyState(
    next: PlaybackState,
    opts: { local?: boolean; force?: boolean } = {}
  ): void {
    const adapter = this.adapter;
    const merged: PlaybackState = {
      position: clampPosition(next.position, next.duration ?? this.duration),
      isPlaying: Boolean(next.isPlaying),
      duration: next.duration ?? (this.duration || undefined),
      anchorMs: next.anchorMs ?? this.now(),
      rate: next.rate ?? 1,
      updatedBy: next.updatedBy,
    };
    this.state = merged;
    if (opts.local) this.lastLocalActionAt = this.now();

    if (!adapter || !adapter.isReady()) {
      // Late-join: oynatıcı hazır olana kadar durumu beklet.
      this.pendingState = merged;
      return;
    }
    if (merged.duration && merged.duration > 0) this.duration = merged.duration;

    if (!opts.force && opts.local) {
      // Kullanıcı kendi aksiyonunu zaten oynatıcıya uyguladı; yalnızca
      // düzeltme yapmadan bırak (yankı/çift düzeltme olmasın).
      return;
    }

    const target = expectedPosition(merged, this.now());
    const current = adapter.getTime();
    if (Math.abs(drift(current, target)) > 0.05) {
      adapter.setTime(target);
      this.lastSeekAt = this.now();
    }
    if (merged.isPlaying) {
      if (adapter.isPaused() && !adapter.isEnded()) adapter.play();
    } else if (!adapter.isPaused()) {
      adapter.pause();
    }
  }

  /** Kullanıcı aksiyonunu motor açısından işaretle (grace + cooldown). */
  noteLocalAction(seek = false): void {
    this.lastLocalActionAt = this.now();
    if (seek) this.lastSeekAt = this.now();
  }

  /** Hedef saniye (durum + şu an). */
  targetPosition(atMs?: number): number {
    return expectedPosition(this.state, atMs ?? this.now());
  }

  /**
   * Sapmayı değerlendirir; karar verir ama UYGULAMAZ (test edilebilir).
   * `tick()` bunu uygular.
   */
  evaluate(atMs?: number): SyncDecision {
    const now = atMs ?? this.now();
    const adapter = this.adapter;
    const decision = (action: SyncAction, reason: string, target = 0, d = 0, rate?: number): SyncDecision =>
      (this.lastDecision = { action, drift: d, target, rate, reason });

    if (!adapter || !adapter.isReady()) return decision('none', 'oynatıcı hazır değil');

    const state = this.state;
    const target = expectedPosition(state, now);

    // 1) Oynat/duraklat uyuşmazlığı her zaman düzeltilir (seek'ten önce).
    if (state.isPlaying) {
      if (adapter.isEnded()) return decision('none', 'film bitti; play çağrılmaz', target);
      if (adapter.isPaused()) {
        return decision('play', 'beklenen oynuyor, oynatıcı durmuş', target);
      }
    } else if (!adapter.isPaused() && !adapter.isEnded()) {
      return decision('pause', 'beklenen duraklatılmış', target);
    }

    // 2) Duraklatılmışken sarma serbest: kareyi hizala, cooldown yok.
    if (!state.isPlaying) {
      const current = adapter.getTime();
      const d = drift(current, target);
      if (Math.abs(d) > this.settledSeconds) {
        return decision('seek', 'duraklatılmış kare hizalanıyor', target, d);
      }
      return decision('none', 'duraklatılmış ve hizalı', target, d);
    }

    if (adapter.isSeeking()) return decision('none', 'sarma sürüyor', target);
    if (adapter.isBuffering()) return decision('none', 'tampon bekleniyor', target);
    if (now - this.lastLocalActionAt < this.graceMs) {
      return decision('none', 'kendi aksiyonumuzun grace penceresi', target);
    }

    const current = adapter.getTime();
    const d = drift(current, target);
    const abs = Math.abs(d);

    if (abs <= this.settledSeconds) {
      if (this.nudged) return decision('reset-rate', 'yerine oturdu', target, d, this.baseRate);
      return decision('none', 'hizalı', target, d);
    }
    if (abs <= this.toleranceSeconds) {
      if (this.nudged) return decision('reset-rate', 'tolerans içinde', target, d, this.baseRate);
      return decision('none', 'tolerans içinde', target, d);
    }
    if (adapter.canNudgeRate() && abs <= this.nudgeMaxSeconds) {
      return decision('nudge', 'yumuşak hız düzeltmesi', target, d, nudgeRateFor(this.baseRate, d));
    }
    if (now - this.lastSeekAt < this.seekCooldownMs) {
      return decision('none', 'seek cooldown', target, d);
    }
    return decision('seek', 'büyük sapma: sarma', target, d);
  }

  /** Kararı uygular; oynatıcıya programatik çağrı yapar. */
  tick(atMs?: number): SyncDecision {
    const decision = this.evaluate(atMs);
    const adapter = this.adapter;
    if (!adapter) return decision;
    switch (decision.action) {
      case 'play':
        adapter.play();
        break;
      case 'pause':
        adapter.pause();
        break;
      case 'seek':
        adapter.setTime(decision.target);
        this.lastSeekAt = this.now();
        if (this.nudged) {
          this.nudged = false;
          adapter.setRate(this.baseRate);
        }
        break;
      case 'nudge':
        if (decision.rate) {
          adapter.setRate(decision.rate);
          this.nudged = true;
        }
        break;
      case 'reset-rate':
        adapter.setRate(this.baseRate);
        this.nudged = false;
        break;
      default:
        break;
    }
    return decision;
  }

  /** Test/teşhis için: durumu ve sayaçları sıfırla. */
  reset(state?: PlaybackState): void {
    this.state = state ?? { position: 0, isPlaying: false };
    this.lastLocalActionAt = -Infinity;
    this.lastSeekAt = -Infinity;
    this.nudged = false;
    this.pendingState = null;
    this.lastDecision = { action: 'none', drift: 0, target: 0, reason: 'sıfırlandı' };
  }
}

/* ------------------------------------------------------------------ */
/* "Sahneye al" — dış tarayıcıda seçilen videoyu perdeye davranışı      */
/* ------------------------------------------------------------------ */

/**
 * Kullanıcı sitede gezip DOĞRU videoyu kendi açtığında (YouTube uygulamasından
 * "Paylaş → Bağlantıyı kopyala"), uygulamaya dönen adresi yakalar.
 *
 * Yalnızca otomatik oynatma engelini aşan gerçek bir kullanıcı dokunuşuyla
 * perde değiştiği için video kilitlenip "düğmeler çalışmıyor" durumuna
 * düşmez. Başka sitelerin linkleri (reklam, sosyal medya) yok sayılır.
 */
export const YOUTUBE_VIDEO_ID_RE =
  /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export const extractYouTubeVideoId = (text?: string | null): string | null => {
  const match = (text || '').match(YOUTUBE_VIDEO_ID_RE);
  return match ? match[1] : null;
};

/**
 * Metin bir YouTube video adresi mi? İki durumu bilerek ayırır:
 *   - metin yalnızca YouTube adresi (uygulamadan paylaşılan bağlantı),
 *   - site linkinden ÇIKARILAN gömülü adres (sahte doğrulama).
 * `allowEmbedded: false` ile "generic site içindeki gömülü youtube adresi"
 * yakalanmaz; aksi halde film sitesi linki sahte "video bulundu" verirdi.
 */
export const looksLikeYouTubeLink = (
  text?: string | null,
  opts: { allowEmbedded?: boolean } = {}
): boolean => {
  const value = (text || '').trim();
  if (!value) return false;
  if (value.length > 2048) return false;
  const decoded = decodeURIComponent(value);
  if (opts.allowEmbedded !== false && extractYouTubeVideoId(decoded)) return true;
  return /(^|[\s])(https?:\/\/)?(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(decoded);
};

/**
 * Gömülü YouTube oynatıcısında video bitince `pauseVideo()` çoğu durumda
 * yeniden OYNATMAMIZ gerekir (bitmiş videoda playVideo bazen yok sayılır).
 * Bu yüzden bitmiş oynatıcı "baştan" algılanır ve play() önce seekTo(0) yapar.
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

/* ------------------------------------------------------------------ */
/* Salon katılımcıları / ev sahibi / buffering                         */
/* ------------------------------------------------------------------ */

export interface ScreenParticipant {
  userId: string;
  name: string;
  emoji: string;
  /** Salonda mı? (presence / heartbeat) */
  online: boolean;
  /** Oynatıcısı tampon bekliyor mu? */
  buffering: boolean;
  /** Bu turun ev sahibi mi? */
  isHost: boolean;
}

/**
 * Ev sahibi devri: filmi başlatan kişi ev sahibidir; salondan çıkarsa
 * kontrol karşı tarafa geçer. İkisi de yoksa null.
 */
export const resolveHost = (
  startedBy: string | null | undefined,
  muratOnline: boolean,
  selinOnline: boolean
): string | null => {
  if (startedBy && (startedBy === 'murat' ? muratOnline : selinOnline)) return startedBy;
  if (muratOnline) return 'murat';
  if (selinOnline) return 'selin';
  return null;
};

/**
 * Buffering otoritesi: biri tampon bekliyorsa oda duraklatılır.
 * Elle oynat/duraklat auto-pause'u ezer (aksiyon verildiyse dokunma).
 */
export const shouldHoldForBuffering = (
  partnerBuffering: boolean,
  localPlaying: boolean,
  autoPausedBy: 'self' | 'partner' | null
): boolean => {
  if (!localPlaying) return false;
  if (partnerBuffering) return true;
  if (autoPausedBy !== null) return true;
  return false;
};

/** Partner kalp atışı tazeliği: takıldı mı? */
export const isPartnerStalled = (
  lastHeartbeatAt: number | null,
  now: number,
  thresholdMs: number = PARTNER_STALL_MS
): boolean => {
  if (!lastHeartbeatAt) return false;
  return now - lastHeartbeatAt > thresholdMs;
};
