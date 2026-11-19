/**
 * Sinema Salonu oynatıcı adaptörleri
 * ----------------------------------
 * Üç kaynak tek arayüzle (`PlayerAdapter`) yönetilir:
 *
 *   1. HTML5  → doğrudan mp4 / medya kütüphanesi linki (tam senkron)
 *   2. HLS    → film sitelerinden çözülen akış (hls.js veya yerleşik HLS)
 *   3. YouTube→ IFrame Player API (https://www.youtube.com/iframe_api, YT.Player)
 *   4. Vimeo  → player.js postMessage API (best-effort, YouTube öncelikli)
 *
 * YouTube akışı (WatchSync yaklaşımı):
 *   - `onReady`  → son state uygulanır (late-join ready-gate)
 *   - `onStateChange` → kullanıcı aksiyonunu yayınla; programatik çağrıların
 *     yankısı `suppressUntil` (400ms) penceresiyle yutulur.
 *   - getCurrentTime() 250 ms'de bir okunur; seekTo(t, true) / playVideo() /
 *     pauseVideo() programatik çağrılar.
 *   - Autoplay engellenirse `mute()` + play + "🔇 Sesi aç" overlay'i (olay:
 *     `onAutoplayBlocked`).
 *
 * API yüklenemezse/iframe yasaklıysa adaptör `onError` verir; ekran düz iframe
 * (senkronsuz) görüntülemeye düşer — salon boş kalmaz.
 */

import { SUPPRESS_ECHO_MS, shouldRestartBeforePlay, type PlayerAdapter } from './cinemaSync';

export type { PlayerAdapter } from './cinemaSync';

/* ------------------------------------------------------------------ */
/* Ortak olay sözleşmesi                                               */
/* ------------------------------------------------------------------ */

export interface AdapterEvents {
  /** Oynatıcı hazır (late-join kapısı açıldı). */
  onReady?: (duration: number) => void;
  /** Kullanıcı oynattı (programatik değil). */
  onUserPlay?: () => void;
  /** Kullanıcı duraklattı (programatik değil). */
  onUserPause?: () => void;
  /** Kullanıcı sardı (programatik değil). */
  onUserSeek?: (position: number) => void;
  /** Film bitti. */
  onEnded?: () => void;
  /** Tampon durumu değişti. */
  onBuffering?: (buffering: boolean) => void;
  /** Süre öğrenildi/güncellendi. */
  onDuration?: (duration: number) => void;
  /** Autoplay engellendi: sesi aç overlay'i göster. */
  onAutoplayBlocked?: () => void;
  /** Oynatıcı kurulamadı / hata verdi. */
  onError?: (message: string) => void;
}

/** Programatik çağrıların yankısını susturma penceresi. */
const SUPPRESS_MS = SUPPRESS_ECHO_MS;

const nowMs = () => Date.now();

abstract class BaseAdapter {
  protected suppressUntil = 0;

  /** Programatik çağrı öncesi yankı yutma penceresini açar. */
  protected suppress(ms: number = SUPPRESS_MS): void {
    this.suppressUntil = Math.max(this.suppressUntil, nowMs() + ms);
  }

  protected isSuppressed(): boolean {
    return nowMs() < this.suppressUntil;
  }

  /** Dışarıdan (senkron motoru) programatik işlem öncesi çağrılabilir. */
  suppressEcho(ms: number = SUPPRESS_MS): void {
    this.suppress(ms);
  }
}

/* ------------------------------------------------------------------ */
/* 1) HTML5 <video> adaptörü                                           */
/* ------------------------------------------------------------------ */

export class HTML5PlayerAdapter extends BaseAdapter implements PlayerAdapter {
  readonly kind: PlayerAdapter['kind'] = 'html5';

  private ready = false;
  private seeking = false;
  private buffering = false;
  private ended = false;
  private muteFallbackTried = false;
  private duration = 0;
  private seekedTimer: number | null = null;
  private userWantsPlay = false;

  constructor(
    private video: HTMLVideoElement,
    private events: AdapterEvents
  ) {
    super();
    this.bind();
  }

  private bind(): void {
    const v = this.video;

    v.addEventListener('loadedmetadata', this.onLoadedMetadata);
    v.addEventListener('loadeddata', this.onLoadedData);
    v.addEventListener('canplay', this.onCanPlay);
    v.addEventListener('play', this.onPlay);
    v.addEventListener('pause', this.onPause);
    v.addEventListener('seeking', this.onSeeking);
    v.addEventListener('seeked', this.onSeeked);
    v.addEventListener('timeupdate', this.onTimeUpdate);
    v.addEventListener('waiting', this.onWaiting);
    v.addEventListener('stalled', this.onWaiting);
    v.addEventListener('playing', this.onPlaying);
    v.addEventListener('ended', this.onEnded);
    v.addEventListener('error', this.onError);
  }

  private onLoadedMetadata = (): void => {
    this.duration = Number.isFinite(this.video.duration) ? this.video.duration : 0;
    this.ready = true;
    // Safari/Chrome: metadata hazır ama autoplay engellenebilir.
    if (this.duration > 0) this.events.onDuration?.(this.duration);
    this.events.onReady?.(this.duration);
  };

  private onLoadedData = (): void => {
    if (!this.ready) {
      this.ready = true;
      this.events.onReady?.(Number.isFinite(this.video.duration) ? this.video.duration : 0);
    }
  };

  private onCanPlay = (): void => {
    if (this.buffering) {
      this.buffering = false;
      this.events.onBuffering?.(false);
    }
  };

  private onPlay = (): void => {
    this.ended = false;
    if (this.isSuppressed()) return;
    this.events.onUserPlay?.();
  };

  private onPause = (): void => {
    if (this.ended) return;
    if (this.isSuppressed()) return;
    this.events.onUserPause?.();
  };

  private onSeeking = (): void => {
    this.seeking = true;
  };

  private onSeeked = (): void => {
    this.seeking = false;
    if (this.seekedTimer) window.clearTimeout(this.seekedTimer);
    // Programatik seek'in yankısını yut; kullanıcı seek'i (native controls
    // olmadığı için bizim UI'dan gelir) yine de yayınlanır.
    if (this.isSuppressed()) return;
    this.events.onUserSeek?.(this.video.currentTime);
  };

  private onTimeUpdate = (): void => {
    const dur = this.video.duration;
    if (Number.isFinite(dur) && dur > 0 && Math.abs(dur - this.duration) > 0.2) {
      this.duration = dur;
      this.events.onDuration?.(dur);
    }
  };

  private onWaiting = (): void => {
    if (this.ended) return;
    if (!this.buffering) {
      this.buffering = true;
      this.events.onBuffering?.(true);
    }
  };

  private onPlaying = (): void => {
    this.ready = true;
    this.ended = false;
    if (this.buffering) {
      this.buffering = false;
      this.events.onBuffering?.(false);
    }
  };

  private onEnded = (): void => {
    this.ended = true;
    this.seeking = false;
    this.buffering = false;
    this.events.onEnded?.();
  };

  private onError = (): void => {
    this.events.onError?.('Bu video salonun perdesinde açılamadı 🎬');
  };

  isReady(): boolean {
    return this.ready;
  }

  getTime(): number {
    return this.video.currentTime || 0;
  }

  getDuration(): number {
    const d = this.video.duration;
    return Number.isFinite(d) ? d : this.duration;
  }

  setTime(seconds: number): void {
    this.suppress();
    this.seeking = true;
    try {
      this.video.currentTime = Math.max(0, seconds);
    } catch {
      /* metadata henüz yoksa yok say */
    }
    if (this.seekedTimer) window.clearTimeout(this.seekedTimer);
    this.seekedTimer = window.setTimeout(() => {
      this.seeking = false;
    }, 1200);
  }

  play(): void {
    this.suppress();
    this.userWantsPlay = true;
    const result = this.video.play();
    if (result && typeof result.catch === 'function') {
      result.catch((err: any) => {
        // Durdurma komutu geldiyse veya istek pause ile bölündüyse autoplay deneme
        if (!this.userWantsPlay) return;
        if (err && (err.name === 'AbortError' || String(err).includes('interrupted'))) return;

        // Gerçek Autoplay engellendi: sessize alıp dene, kullanıcıya "sesi aç" göster.
        if (this.muteFallbackTried) {
          this.events.onAutoplayBlocked?.();
          return;
        }
        this.muteFallbackTried = true;
        this.video.muted = true;
        this.suppress(800);
        this.video
          .play()
          .then(() => {
            if (!this.userWantsPlay) {
              this.video.pause();
            } else {
              this.events.onAutoplayBlocked?.();
            }
          })
          .catch(() => {
            if (this.userWantsPlay) this.events.onAutoplayBlocked?.();
          });
      });
    }
  }

  pause(): void {
    this.suppress();
    this.userWantsPlay = false;
    this.video.pause();
  }

  getRate(): number {
    return this.video.playbackRate || 1;
  }

  setRate(rate: number): void {
    this.suppress();
    try {
      this.video.playbackRate = Math.min(2, Math.max(0.25, rate));
    } catch {
      /* yok say */
    }
  }

  isPaused(): boolean {
    return this.video.paused;
  }

  isSeeking(): boolean {
    return this.seeking;
  }

  isEnded(): boolean {
    return this.ended || this.video.ended;
  }

  isBuffering(): boolean {
    return this.buffering;
  }

  canNudgeRate(): boolean {
    return true;
  }

  setMuted(muted: boolean): void {
    this.video.muted = muted;
    this.muteFallbackTried = false;
  }

  isMuted(): boolean {
    return this.video.muted;
  }

  setVolume(vol: number): void {
    const clamped = Math.max(0, Math.min(1, vol));
    this.video.volume = clamped;
    if (clamped > 0 && this.video.muted) {
      this.video.muted = false;
    }
  }

  getVolume(): number {
    return this.video.volume;
  }

  destroy(): void {
    const v = this.video;
    v.removeEventListener('loadedmetadata', this.onLoadedMetadata);
    v.removeEventListener('loadeddata', this.onLoadedData);
    v.removeEventListener('canplay', this.onCanPlay);
    v.removeEventListener('play', this.onPlay);
    v.removeEventListener('pause', this.onPause);
    v.removeEventListener('seeking', this.onSeeking);
    v.removeEventListener('seeked', this.onSeeked);
    v.removeEventListener('timeupdate', this.onTimeUpdate);
    v.removeEventListener('waiting', this.onWaiting);
    v.removeEventListener('stalled', this.onWaiting);
    v.removeEventListener('playing', this.onPlaying);
    v.removeEventListener('ended', this.onEnded);
    v.removeEventListener('error', this.onError);
    if (this.seekedTimer) window.clearTimeout(this.seekedTimer);
  }
}

/* ------------------------------------------------------------------ */
/* YouTube IFrame Player API                                           */
/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YT_SCRIPT_ID = 'youtube-iframe-api';
const YT_API_TIMEOUT_MS = 9000;

let ytApiPromise: Promise<any> | null = null;

/**
 * YouTube IFrame API'sini bir kez dinamik yükler.
 * Headless/tests ortamında ağ yoksa zaman aşımına düşer ve REDDEDİLİR; çağıran
 * taraf düz iframe'e düşer.
 */
export const loadYouTubeApi = (): Promise<any> => {
  if (typeof window === 'undefined') return Promise.reject(new Error('tarayıcı yok'));
  if (window.YT && typeof window.YT.Player === 'function') return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<any>((resolve, reject) => {
    let settled = false;
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      ytApiPromise = null;
      reject(new Error(reason));
    };

    const timer = window.setTimeout(() => fail('YouTube IFrame API zaman aşımı'), YT_API_TIMEOUT_MS);

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      try {
        previousReady?.();
      } catch {
        /* yok say */
      }
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (window.YT && typeof window.YT.Player === 'function') resolve(window.YT);
      else fail('YouTube IFrame API yüklendi ama YT.Player yok');
    };

    const existing = document.getElementById(YT_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      // Script zaten eklenmiş ama API henüz hazır değil: hazır olmasını bekle.
      existing.addEventListener('error', () => fail('YouTube IFrame API betiği yüklenemedi'));
      return;
    }

    const script = document.createElement('script');
    script.id = YT_SCRIPT_ID;
    script.async = true;
    script.src = 'https://www.youtube.com/iframe_api';
    script.addEventListener('error', () => fail('YouTube IFrame API betiği yüklenemedi'));
    document.head.appendChild(script);
  });

  return ytApiPromise;
};

/** YouTube video kimliğini watch / embed / shorts / youtu.be adreslerinden çıkarır. */
export const extractYouTubeId = (url?: string | null): string | null => {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?[^#]*?\bv=)([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{6,})/,
    /youtube\.com\/live\/([A-Za-z0-9_-]{6,})/,
    /youtu\.be\/([A-Za-z0-9_-]{6,})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
};

/** YouTube embed adresindeki `start` saniyesini okur (varsa). */
export const extractYouTubeStart = (url?: string | null): number => {
  if (!url) return 0;
  const match = url.match(/[?&](?:start|t)=(\d+)/);
  if (!match) return 0;
  return Math.max(0, parseInt(match[1], 10) || 0);
};

export interface YouTubeAdapterOptions {
  videoId: string;
  /** YouTube iframe'inin yükleneceği kapsayıcı (API bunu iframe ile değiştirir). */
  container: HTMLElement;
  events: AdapterEvents;
  /** Sunucudan gelen başlangıç saniyesi (oda kurulurken embed'de vardı). */
  startSeconds?: number;
}

export class YouTubePlayerAdapter extends BaseAdapter implements PlayerAdapter {
  readonly kind = 'youtube' as const;

  /** Sahne değişince oynatıcıyı yeniden kurmak için güncel video kimliği. */
  videoId: string;

  private player: any = null;
  private ready = false;
  private buffering = false;
  private ended = false;
  private seeking = false;
  private seekingUntil = 0;
  private duration = 0;
  private rate = 1;
  private nudgeSupported = true;
  private muted = false;
  private autoplayCheckTimer: number | null = null;
  private verifyTimer: number | null = null;
  private userWantsPlay = false;
  private destroyed = false;
  /** Oynat komutu işe yaramazsa kaç kez yeniden denendi (sonsuz döngü olmasın). */
  private playRetries = 0;

  constructor(private options: YouTubeAdapterOptions) {
    super();
    this.videoId = options.videoId;
  }

  /** Olay köprüsü: adaptörün dışarıya bildirimleri. */
  private get events(): AdapterEvents {
    return this.options.events;
  }

  async init(): Promise<void> {
    const YT = await loadYouTubeApi();
    if (this.destroyed) return;
    this.options.container.innerHTML = '';
    this.player = new YT.Player(this.options.container, {
      videoId: this.options.videoId,
      playerVars: {
        autoplay: 0,
        controls: 0,
        enablejsapi: 1,
        playsinline: 1,
        rel: 0,
        modestbranding: 1,
        origin: window.location.origin,
        start: Math.max(0, Math.floor(this.options.startSeconds || 0)),
      },
      events: {
        onReady: (event: any) => this.handleReady(event),
        onStateChange: (event: any) => this.handleStateChange(event),
        onError: (event: any) => this.handleError(event),
      },
    });
  }

  private handleReady(_event: any): void {
    this.ready = true;
    this.suppress(600);
    try {
      this.duration = this.player.getDuration() || 0;
    } catch {
      this.duration = 0;
    }
    this.events.onDuration?.(this.duration);
    this.events.onReady?.(this.duration);
    if (this.userWantsPlay) {
      this.scheduleAutoplayCheck();
    }
  }

  /** Autoplay engellendiyse sessize alıp yeniden dene ve sesi açmayı öner. */
  private scheduleAutoplayCheck(): void {
    if (this.autoplayCheckTimer) window.clearTimeout(this.autoplayCheckTimer);
    this.autoplayCheckTimer = window.setTimeout(() => {
      if (!this.userWantsPlay || this.destroyed) return;
      try {
        const state = this.player?.getPlayerState?.();
        const playing = state === 1 || state === 3;
        if (!playing) {
          this.suppress(900);
          this.player?.mute?.();
          this.muted = true;
          this.player?.playVideo?.();
          this.events.onAutoplayBlocked?.();
        }
      } catch {
        /* yok say */
      }
    }, 1500);
  }

  /**
   * OYNAT komutu geldi ama oynatıcı bir işe yaramadıysa en fazla 3 kez dener.
   *
   * "Düğme çalışmıyor" şikayetinin sesli nedeni: otomatik oynatma engellendi,
   * sesi açtıktan sonraki programatik playVideo() yine susturuldu (tarayıcı
   * kullanıcı hareketi istiyor). O durumda düğme "oynat" gösterir; play() çoğu
   * kez dokunuşun içinde çağrıldığı için bu denemeler genellikle başarılıdır.
   */
  private verifyPlaying(): void {
    if (this.destroyed || !this.userWantsPlay) return;
    const state = this.stateValue();
    if (state === 1 || state === 3) {
      this.playRetries = 0;
      return;
    }
    if (this.playRetries >= 3) {
      this.playRetries = 0;
      // Son çare: oynatıcı hâlâ duruyorsa kullanıcıya "dokunarak başlat" sun.
      if (this.stateValue() !== 1) this.events.onAutoplayBlocked?.();
      return;
    }
    this.playRetries += 1;
    this.suppress(500);
    try {
      this.player?.playVideo?.();
    } catch {
      /* yok say */
    }
    if (this.verifyTimer) window.clearTimeout(this.verifyTimer);
    this.verifyTimer = window.setTimeout(() => this.verifyPlaying(), 700);
  }

  private handleStateChange(event: any): void {
    const state = event?.data;
    if (state === 1) {
      // PLAYING
      this.ended = false;
      this.seeking = false;
      this.playRetries = 0;
      if (this.buffering) {
        this.buffering = false;
        this.events.onBuffering?.(false);
      }
      if (!this.isSuppressed()) this.events.onUserPlay?.();
    } else if (state === 2) {
      // PAUSED
      if (!this.isSuppressed() && !this.ended) this.events.onUserPause?.();
    } else if (state === 3) {
      // BUFFERING — bu da "oynuyor" sayılır; düğme duraklat göstermeli.
      this.ended = false;
      this.playRetries = 0;
      if (!this.buffering) {
        this.buffering = true;
        this.events.onBuffering?.(true);
      }
    } else if (state === 0) {
      // ENDED
      this.ended = true;
      this.seeking = false;
      this.buffering = false;
      this.events.onEnded?.();
    }
    this.syncDuration();
  }

  private handleError(event: any): void {
    const code = event?.data;
    const messages: Record<number, string> = {
      2: 'YouTube video kimliği geçersiz',
      5: 'YouTube bu videoyu tarayıcıda oynatamıyor',
      100: 'Video bulunamadı ya da gizli',
      101: 'Videonun sahibi gömülü oynatmayı kapatmış',
      150: 'Videonun sahibi gömülü oynatmayı kapatmış',
    };
    this.events.onError?.(messages[code] || 'YouTube videosu açılamadı 🎬');
  }

  private syncDuration(): void {
    try {
      const dur = this.player?.getDuration?.();
      if (Number.isFinite(dur) && dur > 0 && Math.abs(dur - this.duration) > 0.2) {
        this.duration = dur;
        this.events.onDuration?.(dur);
      }
    } catch {
      /* yok say */
    }
  }

  private stateValue(): number {
    try {
      return this.player?.getPlayerState?.() ?? -1;
    } catch {
      return -1;
    }
  }

  isReady(): boolean {
    return this.ready && Boolean(this.player);
  }

  getTime(): number {
    try {
      const t = this.player?.getCurrentTime?.();
      return Number.isFinite(t) ? Math.max(0, t) : 0;
    } catch {
      return 0;
    }
  }

  getDuration(): number {
    this.syncDuration();
    return this.duration;
  }

  setTime(seconds: number): void {
    if (!this.player) return;
    this.suppress(650);
    this.seeking = true;
    this.seekingUntil = nowMs() + 1200;
    try {
      this.player.seekTo(Math.max(0, seconds), true);
    } catch {
      /* yok say */
    }
  }

  play(): void {
    if (!this.player) return;
    this.userWantsPlay = true;
    this.suppress();
    this.playRetries = 0;
    try {
      // Bitmiş videoda playVideo() bazen hiçbir şey yapmaz: önce başa sar.
      if (shouldRestartBeforePlay(this.ended || this.stateValue() === 0, this.getTime(), this.duration)) {
        this.ended = false;
        this.player.seekTo(0, true);
      }
      this.player.playVideo();
      if (this.verifyTimer) window.clearTimeout(this.verifyTimer);
      this.verifyTimer = window.setTimeout(() => this.verifyPlaying(), 800);
    } catch {
      /* yok say */
    }
  }

  pause(): void {
    if (!this.player) return;
    this.userWantsPlay = false;
    if (this.autoplayCheckTimer) {
      window.clearTimeout(this.autoplayCheckTimer);
      this.autoplayCheckTimer = null;
    }
    if (this.verifyTimer) {
      window.clearTimeout(this.verifyTimer);
      this.verifyTimer = null;
    }
    this.suppress();
    try {
      this.player.pauseVideo();
    } catch {
      /* yok say */
    }
  }

  getRate(): number {
    return this.rate;
  }

  setRate(rate: number): void {
    if (!this.nudgeSupported) return;
    this.suppress(600);
    try {
      this.player.setPlaybackRate(Math.min(2, Math.max(0.25, rate)));
      this.rate = rate;
    } catch {
      // Bazı videolarda hız değiştirilemez: bir daha denemeyip seek'e düş.
      this.nudgeSupported = false;
    }
  }

  isPaused(): boolean {
    const state = this.stateValue();
    // 2 = paused, 0 = ended, -1 = unstarted, 5 = cued; 1 ve 3 oynuyor sayılır.
    return state === 2 || state === 0 || state === -1 || state === 5;
  }

  isSeeking(): boolean {
    if (this.seeking && nowMs() > this.seekingUntil) this.seeking = false;
    return this.seeking;
  }

  isEnded(): boolean {
    return this.ended || this.stateValue() === 0;
  }

  isBuffering(): boolean {
    return this.buffering || this.stateValue() === 3;
  }

  canNudgeRate(): boolean {
    return this.nudgeSupported;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.suppress(600);
    try {
      if (muted) this.player?.mute?.();
      else this.player?.unMute?.();
    } catch {
      /* yok say */
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setVolume(vol: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(vol * 100)));
    try {
      this.player?.setVolume?.(clamped);
      if (clamped > 0 && this.muted) {
        this.player?.unMute?.();
        this.muted = false;
      }
    } catch {
      /* yok say */
    }
  }

  getVolume(): number {
    try {
      const v = this.player?.getVolume?.();
      return typeof v === 'number' ? v / 100 : 1;
    } catch {
      return 1;
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.userWantsPlay = false;
    if (this.autoplayCheckTimer) window.clearTimeout(this.autoplayCheckTimer);
    if (this.verifyTimer) window.clearTimeout(this.verifyTimer);
    try {
      this.player?.destroy?.();
    } catch {
      /* yok say */
    }
    this.player = null;
    this.ready = false;
  }
}

/* ------------------------------------------------------------------ */
/* 2) HLS adaptörü (film sitelerinden çözülen akış)                    */
/* ------------------------------------------------------------------ */

/**
 * HLS akışını `<video>` üstünde oynatır.
 *
 * Neden ayrı bir adaptör?
 * -----------------------
 * Film sitelerinin akışı ikiye ayrılıyor:
 *   - Safari/iOS'un kendi HLS desteği (video.src = m3u8 yeterli),
 *   - Android WebView / Chrome: yerleşik HLS yok, `hls.js` şart.
 *
 * Senkron davranışı (oynat/duraklat/sarma/hız) HTML5 adaptörüyle aynıdır;
 * bu yüzden `HTML5PlayerAdapter`'ı genişletiyoruz — sadece kaynağı biz
 * bağlıyoruz. Böylece `SyncEngine` hiçbir değişiklik görmez.
 */
export class HLSPlayerAdapter extends HTML5PlayerAdapter {
  readonly kind = 'hls' as const;
  private hls: any = null;
  private disposed = false;
  /** Oynatmak istiyoruz mu? (sarma/tampon sonrası kendiliğinden devam için) */
  private resumeWanted = false;
  private resumeAttempts = 0;
  /** Yeniden kurulum sonrası başlanacak saniye (>=0 ise uygulanır). */
  private pendingStartTime = -1;
  private pollTimer: number | null = null;
  private resumeTimer: number | null = null;
  private onPendingEvent: (() => void) | null = null;
  private onVideoSeeked: (() => void) | null = null;
  private networkRetries = 0;
  private mediaRetries = 0;
  /** Olay köprüsü (yeniden kurulumda da gerekli). */
  private readonly adapterEvents: AdapterEvents;

  constructor(
    private videoEl: HTMLVideoElement,
    private src: string,
    events: AdapterEvents
  ) {
    super(videoEl, events);
    this.adapterEvents = events;
    void this.attachSource(events);
  }

  private cleanupSourceListeners(): void {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.resumeTimer) {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    if (this.onPendingEvent) {
      this.videoEl.removeEventListener('loadedmetadata', this.onPendingEvent);
      this.videoEl.removeEventListener('canplay', this.onPendingEvent);
      this.onPendingEvent = null;
    }
    if (this.onVideoSeeked) {
      this.videoEl.removeEventListener('seeked', this.onVideoSeeked);
      this.onVideoSeeked = null;
    }
  }

  private async attachSource(events: AdapterEvents): Promise<void> {
    this.cleanupSourceListeners();
    this.networkRetries = 0;
    this.mediaRetries = 0;
    const video = this.videoEl;

    // 1) Yerleşik HLS (iOS/Safari): doğrudan kaynak yeterli.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = this.src;
      return;
    }

    // 2) hls.js (Android WebView, Chrome, Windows). Paket ayrı yüklensin:
    //    yalnızca gerektiğinde indirilir, ilk açılışı yavaşlatmaz.
    try {
      const mod: any = await import('hls.js');
      const Hls = mod?.default ?? mod?.Hls ?? mod;
      if (this.disposed) return;
      if (!Hls || typeof Hls.isSupported !== 'function' || !Hls.isSupported()) {
        // Son çare: tarayıcıya doğrudan ver (bazı durumlarda kendi çözer).
        video.src = this.src;
        return;
      }

      const hls = new Hls({
        // Yeniden kurulumda hedef saniye: hls.js bunu kendisi uygular
        // (currentTime ataması MediaSource tarafından yutulabiliyor).
        startPosition: this.pendingStartTime > 0 ? this.pendingStartTime : -1,
        // ---- Tampon: MOBİL İÇİN DAYANIKLI ----
        maxBufferLength: 12,
        maxMaxBufferLength: 24,
        maxBufferSize: 24 * 1000 * 1000,
        backBufferLength: 30,
        // ABR: yavaş ağda hemen düşük kaliteye insin, tamponu besleyebilsin.
        abrEwmaDefaultEstimate: 800_000,
        abrBandWidthFactor: 0.8,
        abrBandWidthUpFactor: 0.6,
        startLevel: -1, // otomatik: ağa göre en uygun kaliteden başla
        enableWorker: true,
        lowLatencyMode: false,
        // Hatalarda birkaç kez kendini toparlasın (CDN dalgalanmaları).
        manifestLoadingMaxRetry: 4,
        levelLoadingMaxRetry: 4,
        fragLoadingMaxRetry: 6,
        // Segment yüklemesi takılırsa hızla yeniden dene.
        fragLoadingTimeOut: 20_000,
        manifestLoadingTimeOut: 15_000,
        levelLoadingTimeOut: 15_000,
      });
      this.hls = hls;

      hls.on(Hls.Events.FRAG_LOADED, () => {
        this.networkRetries = 0;
        this.mediaRetries = 0;
      });

      hls.on(Hls.Events.ERROR, (_evt: unknown, data: any) => {
        if (!data) return;
        if (data.fatal) {
          // Ölümcül hata: sınırlı sayıda kurtarmayı dene, olmuyorsa kullanıcıya söyle.
          if (data.type === 'networkError' && this.networkRetries < 3) {
            this.networkRetries += 1;
            try { hls.startLoad(); return; } catch { /* yok say */ }
          } else if (data.type === 'mediaError' && this.mediaRetries < 2) {
            this.mediaRetries += 1;
            try { hls.recoverMediaError(); return; } catch { /* yok say */ }
          }
          events.onError?.('Film akışı yüklenemedi. Bağlantıyı kontrol edip tekrar dene 🎬');
        }
      });

      // Süre öğrenildiğinde perde ilerleme çubuğu dolsun.
      hls.on(Hls.Events.LEVEL_LOADED, () => {
        const dur = video.duration;
        if (Number.isFinite(dur) && dur > 0) events.onDuration?.(dur);
      });

      // Yeniden kurulum sonrası hedef saniyeye atla (sarma takılması kurtarma).
      const applyPendingStart = () => {
        if (this.pendingStartTime < 0) return;
        if (this.videoEl.readyState < 1) return;
        const t = this.pendingStartTime;
        this.pendingStartTime = -1;
        try {
          this.videoEl.currentTime = t;
          hls.startLoad(t);
          if (this.resumeWanted) void this.videoEl.play().catch(() => {});
        } catch {
          /* yok say */
        }
      };
      this.onPendingEvent = applyPendingStart;
      video.addEventListener('loadedmetadata', applyPendingStart);
      video.addEventListener('canplay', applyPendingStart);
      // Emniyet: olaylar kaçarsa kısa aralıklarla dene (en fazla 10 sn).
      let tries = 0;
      this.pollTimer = window.setInterval(() => {
        tries += 1;
        applyPendingStart();
        if (this.pendingStartTime < 0 || tries > 40 || this.disposed) {
          if (this.pollTimer) {
            window.clearInterval(this.pollTimer);
            this.pollTimer = null;
          }
        }
      }, 250);

      // ---- Sarma sonrası oynatma güvencesi ----
      hls.on(Hls.Events.FRAG_CHANGED, () => {
        if (this.resumeWanted && video.paused && !video.ended) {
          this.tryResume();
        }
      });
      this.onVideoSeeked = () => {
        if (this.resumeWanted && video.paused && !video.ended) {
          this.tryResume();
        }
      };
      video.addEventListener('seeked', this.onVideoSeeked);

      hls.loadSource(this.src);
      hls.attachMedia(video);
      if (this.pendingStartTime > 0) {
        try {
          hls.startLoad(this.pendingStartTime);
        } catch {
          /* yok say */
        }
      }
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (this.pendingStartTime > 0) {
          try {
            hls.stopLoad();
            hls.startLoad(this.pendingStartTime);
          } catch {
            /* yok say */
          }
        }
      });
    } catch (err) {
      console.error('hls.js yüklenemedi', err);
      events.onError?.('Film akışı oynatılamadı 🎬');
    }
  }

  /** Oynatmak istiyoruz ama oynatıcı durdu: yeniden dene (sınırlı sayıda). */
  private tryResume(): void {
    if (this.disposed || !this.resumeWanted || this.resumeAttempts >= 6) return;
    this.resumeAttempts += 1;
    const video = this.videoEl;
    try {
      const p = video.play();
      if (p && typeof p.catch === 'function') {
        p.catch((err: any) => {
          // Durdurulmuşsa veya pause ile kesildiyse asla sessize alıp oynatma!
          if (!this.resumeWanted || this.disposed) return;
          if (err && (err.name === 'AbortError' || String(err).includes('interrupted'))) return;
          try {
            video.muted = true;
            this.adapterEvents.onAutoplayBlocked?.();
            video.play().catch(() => {});
          } catch {
            /* yok say */
          }
        });
      }
    } catch {
      /* yok say */
    }
    if (this.resumeTimer) window.clearTimeout(this.resumeTimer);
    this.resumeTimer = window.setTimeout(() => {
      if (this.disposed) return;
      if (this.resumeWanted && video.paused && !video.ended) this.tryResume();
    }, 900);
  }

  /** Oynatmayı "sürdür" niyetini ayarla (sarma/duraklat sonrası). */
  setResumeWanted(wanted: boolean): void {
    this.resumeWanted = Boolean(wanted);
    this.resumeAttempts = 0;
  }

  /**
   * Oynatıcıyı verilen saniyeden TAMAMEN yeniden kur.
   */
  restartAt(seconds: number): void {
    const video = this.videoEl;
    const resume = this.resumeWanted;
    console.warn('[cinema] oynatıcı yeniden kuruluyor:', seconds);
    this.cleanupSourceListeners();
    try {
      this.hls?.destroy?.();
    } catch {
      /* yok say */
    }
    this.hls = null;
    try {
      video.removeAttribute('src');
      video.load();
    } catch {
      /* yok say */
    }
    this.resumeWanted = resume;
    this.resumeAttempts = 0;
    this.pendingStartTime = Math.max(0, seconds);
    void this.attachSource(this.adapterEvents);
  }

  play(): void {
    this.setResumeWanted(true);
    super.play();
  }

  pause(): void {
    this.setResumeWanted(false);
    this.resumeAttempts = 999;
    if (this.resumeTimer) {
      window.clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
    }
    super.pause();
  }

  setTime(seconds: number): void {
    // Yeniden kurulum sürüyorsa sarma yutulur: hedef saniye olarak saklanır ve
    // oynatıcı hazır olunca uygulanır (aksi halde video 0'dan başlıyordu).
    if (this.pendingStartTime >= 0) {
      this.pendingStartTime = Math.max(0, seconds);
      return;
    }
    super.setTime(seconds);
    // Sarma sonrası oynatmak istiyorsak veri gelince devam et.
    if (this.resumeWanted) {
      this.tryResume();
    }
  }

  getSrc(): string {
    return this.src;
  }

  destroy(): void {
    this.disposed = true;
    this.cleanupSourceListeners();
    try {
      this.hls?.destroy?.();
    } catch {
      /* yok say */
    }
    this.hls = null;
    // Üst sınıfın olay dinleyicilerini çöz.
    super.destroy();
    try {
      this.videoEl.removeAttribute('src');
      this.videoEl.load();
    } catch {
      /* yok say */
    }
  }
}

/* ------------------------------------------------------------------ */
/* 3) Vimeo (best-effort, postMessage)                                 */
/* ------------------------------------------------------------------ */

export const VIMEO_ORIGIN = 'https://player.vimeo.com';
const VIMEO_READY_TIMEOUT_MS = 6000;

export class VimeoPlayerAdapter extends BaseAdapter implements PlayerAdapter {
  readonly kind = 'vimeo' as const;

  private ready = false;
  private time = 0;
  private duration = 0;
  private paused = true;
  private seeking = false;
  private ended = false;
  private buffering = false;
  private rate = 1;
  private pollTimer: number | null = null;
  private readyTimer: number | null = null;
  private onIframeLoad: (() => void) | null = null;

  constructor(
    private iframe: HTMLIFrameElement,
    private events: AdapterEvents
  ) {
    super();
    window.addEventListener('message', this.onMessage);
    this.bindIframeLoad();
  }

  private bindIframeLoad(): void {
    // Vimeo player'ı iframe src'sine api=1 eklenmiş olarak yükleriz.
    const markReady = () => {
      if (this.ready) return;
      this.ready = true;
      if (this.readyTimer) window.clearTimeout(this.readyTimer);
      this.send('addEventListener', 'play');
      this.send('addEventListener', 'pause');
      this.send('addEventListener', 'seeked');
      this.send('addEventListener', 'ended');
      this.send('addEventListener', 'bufferstart');
      this.send('addEventListener', 'bufferend');
      this.send('getDuration');
      this.send('getPaused');
      this.events.onReady?.(this.duration);
      this.startPolling();
    };
    this.onIframeLoad = markReady;
    if (this.iframe.contentDocument?.readyState === 'complete') markReady();
    this.iframe.addEventListener('load', markReady);
    this.readyTimer = window.setTimeout(() => {
      // API yanıt vermediyse senkronsuz kabul et: çağıran düz iframe'e düşer.
      if (!this.ready) this.events.onError?.('Vimeo oynatıcısı senkronu desteklemedi');
    }, VIMEO_READY_TIMEOUT_MS);
  }

  private startPolling(): void {
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    this.pollTimer = window.setInterval(() => {
      this.send('getCurrentTime');
      this.send('getPaused');
      this.send('getDuration');
    }, 250);
  }

  private send(method: string, value?: unknown): void {
    try {
      this.iframe.contentWindow?.postMessage(JSON.stringify({ method, value }), VIMEO_ORIGIN);
    } catch {
      /* yok say */
    }
  }

  private onMessage = (event: MessageEvent): void => {
    if (event.origin !== VIMEO_ORIGIN) return;
    let data: any = event.data;
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data);
      } catch {
        return;
      }
    }
    if (!data || typeof data !== 'object') return;

    if (data.event === 'ready') {
      if (!this.ready) {
        this.ready = true;
        if (this.readyTimer) window.clearTimeout(this.readyTimer);
        this.send('addEventListener', 'play');
        this.send('addEventListener', 'pause');
        this.send('addEventListener', 'seeked');
        this.send('addEventListener', 'ended');
        this.send('addEventListener', 'bufferstart');
        this.send('addEventListener', 'bufferend');
        this.events.onReady?.(this.duration);
        this.startPolling();
      }
      return;
    }
    if (data.event === 'play') {
      this.paused = false;
      this.ended = false;
      if (!this.isSuppressed()) this.events.onUserPlay?.();
      return;
    }
    if (data.event === 'pause') {
      this.paused = true;
      if (!this.isSuppressed() && !this.ended) this.events.onUserPause?.();
      return;
    }
    if (data.event === 'seeked') {
      this.seeking = false;
      const t = Number(data.data?.seconds);
      if (Number.isFinite(t)) {
        this.time = t;
        if (!this.isSuppressed()) this.events.onUserSeek?.(t);
      }
      return;
    }
    if (data.event === 'ended') {
      this.ended = true;
      this.paused = true;
      this.events.onEnded?.();
      return;
    }
    if (data.event === 'bufferstart') {
      this.buffering = true;
      this.events.onBuffering?.(true);
      return;
    }
    if (data.event === 'bufferend') {
      this.buffering = false;
      this.events.onBuffering?.(false);
      return;
    }
    if (data.method === 'getCurrentTime' && Number.isFinite(Number(data.value))) {
      this.time = Number(data.value);
      return;
    }
    if (data.method === 'getPaused') {
      this.paused = Boolean(data.value);
      return;
    }
    if (data.method === 'getDuration' && Number.isFinite(Number(data.value))) {
      const dur = Number(data.value);
      if (dur > 0 && Math.abs(dur - this.duration) > 0.2) {
        this.duration = dur;
        this.events.onDuration?.(dur);
      }
      return;
    }
  };

  isReady(): boolean {
    return this.ready;
  }

  getTime(): number {
    return this.time;
  }

  getDuration(): number {
    return this.duration;
  }

  setTime(seconds: number): void {
    this.suppress(650);
    this.seeking = true;
    this.time = Math.max(0, seconds);
    this.send('setCurrentTime', this.time);
  }

  play(): void {
    this.suppress();
    this.send('play');
  }

  pause(): void {
    this.suppress();
    this.send('pause');
  }

  getRate(): number {
    return this.rate;
  }

  setRate(rate: number): void {
    this.rate = rate;
    this.suppress(600);
    this.send('setPlaybackRate', rate);
  }

  isPaused(): boolean {
    return this.paused;
  }

  isSeeking(): boolean {
    return this.seeking;
  }

  isEnded(): boolean {
    return this.ended;
  }

  isBuffering(): boolean {
    return this.buffering;
  }

  canNudgeRate(): boolean {
    return false;
  }

  destroy(): void {
    window.removeEventListener('message', this.onMessage);
    if (this.onIframeLoad) {
      this.iframe.removeEventListener('load', this.onIframeLoad);
      this.onIframeLoad = null;
    }
    if (this.pollTimer) window.clearInterval(this.pollTimer);
    if (this.readyTimer) window.clearTimeout(this.readyTimer);
  }
}

/* ------------------------------------------------------------------ */
/* Kaynak seçimi / fabrika                                             */
/* ------------------------------------------------------------------ */

export type PlayerSourceKind = 'html5' | 'hls' | 'youtube' | 'vimeo' | 'unsupported';

export interface RoomSource {
  video_url?: string | null;
  embed_url?: string | null;
  /** Film sitelerinden çözülen GERÇEK akış (HLS) — varsa her zaman öncelikli. */
  stream_url?: string | null;
  source?: string | null;
  kind?: string | null;
}

/**
 * Adres, tarayıcının doğrudan oynatabileceği bir MEDYA dosyası mı?
 *
 * ÖNEMLİ: Film sitelerinin sayfa adresleri (ör.
 * `https://www.fullhdfilmizlesene.now/film/arabalar/`) video DEĞİLDİR. Bu
 * adresi `<video src>` yapmak kara ekran bırakır. Bu yüzden yalnızca uzantısı
 * belli dosyalar ve medya kütüphanesi yolları "dosya" sayılır.
 */
export const looksLikePlayableFile = (url?: string | null): boolean => {
  const clean = (url || '').trim();
  if (!clean) return false;
  if (clean.startsWith('blob:') || clean.startsWith('data:video/')) return true;
  if (clean.includes('/api/media/file/') || clean.includes('/api/media/')) return true;
  const path = clean.split('#')[0].split('?')[0];
  return /\.(mp4|webm|m4v|mov|ogv|ogg|mkv|m3u8|ts|mpd)$/i.test(path);
};

/** Odanın hangi oynatıcıyla açılacağını belirler (saf fonksiyon). */
export const detectPlayerSource = (room: RoomSource): PlayerSourceKind => {
  const videoUrl = room.video_url || '';
  const embed = room.embed_url || '';
  const stream = (room.stream_url || '').trim();
  const source = (room.source || '').toLowerCase();

  // 0) Film sitesinden çözülen gerçek akış veya doğrudan m3u8 adresi: hls.js ile aç.
  if (stream) return 'hls';
  const cleanPath = videoUrl.trim().split('#')[0].split('?')[0].toLowerCase();
  if (cleanPath.endsWith('.m3u8')) return 'hls';

  const isFileUrl =
    looksLikePlayableFile(videoUrl) || room.kind === 'file';

  // 1) Doğrudan oynatılabilen dosya her zaman kazanır (mp4, m3u8, yükleme).
  if (isFileUrl) return 'html5';

  // 2) YouTube: gömme adresinde ya da kaynak etiketinde video kimliği varsa.
  if (embed && extractYouTubeId(embed)) return 'youtube';
  if (source === 'youtube' && extractYouTubeId(videoUrl)) return 'youtube';

  // 3) Vimeo postMessage API'si (best-effort).
  if (embed.toLowerCase().includes('player.vimeo.com')) return 'vimeo';

  // 4) Gömülebilir oynatıcı adresi: senkron yok, düz gömme gösterilir.
  //    Yalnızca GERÇEKTEN gömülebilir oynatıcılar buraya gelir; film sitesinin
  //    sayfası asla iframe'e konmaz (frame içinde açılmaz → kara ekran).
  if (embed && isPlayableEmbedUrl(embed)) return 'unsupported';

  // 5) YouTube/vimeo SAYFA adresi (gömme adresi değil) → tanınan oynatıcı.
  if (extractYouTubeId(videoUrl)) return 'youtube';
  if (videoUrl.toLowerCase().includes('vimeo.com/')) return 'vimeo';

  return 'unsupported';
};

/** Vimeo iframe adresine `api=1` (postMessage API) ekler. */
export const vimeoApiUrl = (embedUrl: string): string => {
  if (!embedUrl) return '';
  const separator = embedUrl.includes('?') ? '&' : '?';
  return embedUrl.includes('api=1') ? embedUrl : `${embedUrl}${separator}api=1`;
};

/**
 * Adres, çerçeve (iframe) içinde açılabilen bir OYNATICI mı?
 *
 * Film siteleri kendi HTML sayfalarını `X-Frame-Options: DENY` /
 * `frame-ancestors` ile çerçeve içinde açmaya izin vermez. Böyle bir adresi
 * iframe'e koymak boş, sonsuza kadar "yükleniyor" görünen bir perde bırakır.
 * Bu yüzden gömme kararını bu liste belirler: yalnızca bilinen oynatıcı
 * adresleri perdeye konur, geri kalanı "dışarıda aç" olarak sunulur.
 */
export const PLAYABLE_EMBED_HOSTS = [
  'youtube.com/embed/',
  'youtube-nocookie.com/embed/',
  'player.vimeo.com/',
  'dailymotion.com/embed/',
  'player.bilibili.com/',
  'ok.ru/videoembed/',
  'streamable.com/e/',
  'player.twitch.tv/',
  'clips.twitch.tv/',
  'facebook.com/plugins/',
  'instagram.com/',
];

export const isPlayableEmbedUrl = (url?: string | null): boolean => {
  const low = (url || '').toLowerCase();
  if (!low) return false;
  return PLAYABLE_EMBED_HOSTS.some((host) => low.includes(host));
};
