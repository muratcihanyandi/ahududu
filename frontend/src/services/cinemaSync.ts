/**
 * Sinema Salonu mimarisi
 * ----------------------
 * - İki telefon da aynı "salona" girer, telefon otomatik yatay moda geçer.
 * - Video, salonun KENDİ perdesinde oynar (bizim tarafımızdan çizilen sinema
 *   salonu sahnesi: kırmızı koltuklar, perdeler, projektör ışığı).
 * - Oynat / duraklat / sarma komutları sunucuya gider, sunucu WebSocket ile
 *   partnerin ekranına anında iletir. Böylece iki taraf aynı saniyeyi görür.
 * - Sunucu sadece zaman damgası + pozisyon tutar; herkes kendi tarafında
 *   "şu an kaçıncı saniye olmalı" hesabını yapar (komut gecikmesi telafi edilir).
 *
 * Zaman modeli:
 *   position          -> komut verildiği andaki video saniyesi
 *   is_playing        -> o anda oynatılıyor muydu
 *   server_time_ms    -> sunucunun komutu kaydettiği an
 *   Beklenen saniye   = position + (şimdi - server_time_ms) / 1000  (oynatılıyorsa)
 */

export interface PlaybackState {
  position: number;
  isPlaying: boolean;
  duration?: number;
  anchorMs?: number;
  updatedBy?: string;
}

export interface SyncMessage {
  room_id: number;
  action: string;
  position: number;
  duration: number;
  is_playing: boolean;
  is_active: boolean;
  updated_by: string;
  server_time_ms?: number;
}

/** Bir komut anındaki oynatma durumundan beklenen saniyeyi hesaplar. */
export const expectedPosition = (state: PlaybackState, atMs: number = Date.now()): number => {
  if (!state.isPlaying) return Math.max(0, state.position);
  const anchor = state.anchorMs ?? atMs;
  const elapsed = Math.max(0, atMs - anchor) / 1000;
  const pos = state.position + elapsed;
  if (state.duration && state.duration > 0) return Math.min(pos, state.duration);
  return pos;
};

/** Pozisyonu güvenli sınırlara (0..süre) kırpar. */
export const clampPosition = (pos: number, duration?: number): number => {
  if (!Number.isFinite(pos) || pos < 0) return 0;
  if (duration && duration > 0 && pos > duration) return duration;
  return pos;
};

/** Video tarafının "kayan nokta" toleransı: bu farkın altında düzeltme yapmayız. */
export const SYNC_TOLERANCE_SECONDS = 0.75;

/** İki taraf arasında ne kadar sapma olduğunu bulur. */
export const drift = (current: number, expected: number): number => current - expected;

export const shouldCorrect = (current: number, expected: number): boolean =>
  Math.abs(drift(current, expected)) > SYNC_TOLERANCE_SECONDS;

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
