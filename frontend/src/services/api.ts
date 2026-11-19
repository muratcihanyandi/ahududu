import {
  UserProfile, LoveLetter, ChatMessage, GalleryItem,
  SharedNote, CoupleStatus, UserId,
  SnapStory, SnapFeed, DiaryEntry, DiaryStats,
  Pet, PetPhoto, PetWithPhotos, CinemaRoom, Showtime,
} from '../types';

export const getServerBaseUrl = (): string => {
  if (typeof window === 'undefined') return 'https://ahududu.fakeyol.com';
  
  // If running inside Capacitor Native Android App (where origin is https://localhost)
  if (window.location.hostname === 'localhost' && window.location.port !== '33470' && window.location.port !== '5173') {
    const saved = localStorage.getItem('ahududu_server_url');
    return (saved || 'https://ahududu.fakeyol.com').replace(/\/+$/, '');
  }
  
  // Normal browser or PWA loaded from Pi or Cloudflare
  return '';
};

const BASE_URL = getServerBaseUrl();

async function requestJson<T>(
  url: string,
  init?: RequestInit,
  fallbackError = 'Sunucu hatası'
): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed: any = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const detail = parsed && typeof parsed === 'object' && parsed.detail ? String(parsed.detail) : '';
    throw new Error(detail || `${fallbackError} (${res.status})`);
  }
  return parsed as T;
}

/**
 * Sunucunun döndürdüğü göreli medya yollarını (/api/media/file/...) tarayıcının
 * doğru sunucuya istek atacağı tam adrese çevirir.
 *
 * Native (Capacitor) kabuğunda sayfa https://localhost üzerinden açılsa da
 * görseller Pi'de (192.168.2.170:33470) durur; bu yüzden medya yolları mutlaka
 * sunucu tabanına göre çözülür. Uzaktan gelen http(s) adresleri olduğu gibi kalır.
 */
export const mediaUrl = (url?: string | null): string => {
  if (!url) return '';
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  if (url.startsWith('/api/media/')) return `${BASE_URL}${url}`;
  return url;
};

/**
 * Salona kaydedilecek video adresi.
 *
 * Sunucunun döndürdüğü `/api/media/file/...` yolu göreli kalırsa, sunucu onu
 * tekrar çözerken bozulur; bu yüzden medya kütüphanesine ait yollar mutlaka
 * `mediaUrl` ile tam adrese çevrilerek kaydedilir.
 */
export const cinemaVideoUrl = (url: string): string => {
  const clean = (url || '').trim();
  if (clean.startsWith('/api/')) return mediaUrl(clean);
  if (clean.startsWith('api/')) return mediaUrl('/' + clean);
  return clean;
};

/**
 * Film siteleri iframe içinde X-Frame-Options engeli koyduğunda
 * sunucu proxy'si üzerinden sayfayı açar. YouTube / Vimeo zaten gömülebildiği
 * için doğrudan kullanılır.
 */
export const cinemaProxyUrl = (url?: string | null): string => {
  if (!url) return '';
  const clean = url.trim();
  if (
    clean.includes('youtube.com/embed/') ||
    clean.includes('youtube-nocookie.com/embed/') ||
    clean.includes('player.vimeo.com/') ||
    clean.includes('dailymotion.com/embed/') ||
    clean.includes('player.bilibili.com/') ||
    clean.includes('ok.ru/videoembed/') ||
    clean.includes('streamable.com/e/')
  ) {
    return clean;
  }
  return `${BASE_URL}/api/cinema/proxy?url=${encodeURIComponent(clean)}`;
};

/**
 * Film sitelerinden çözülen HLS akışını sunucu üzerinden oynatılabilir adrese
 * çevirir.
 *
 * CDN'ler tarayıcıya CORS başlığı vermiyor ve Referer istiyor; ayrıca segmentler
 * `.jpg` kılığında geliyor. Bu yüzden master/alt playlist/segmentlerin hepsi
 * `/api/cinema/hls` üzerinden geçer. Sunucu m3u8 içindeki alt adresleri de bu
 * proxy'ye çevirir, böylece perde kendi oynatıcısında (senkron) oynatabilir.
 */
export const cinemaHlsUrl = (
  streamUrl?: string | null,
  referer?: string | null
): string => {
  if (!streamUrl) return '';
  const clean = streamUrl.trim();
  // Zaten proxy'lenmiş adres: dokunma (çift sarmalamayı önler).
  if (clean.includes('/api/cinema/hls?')) return clean;
  const ref = referer ? `&referer=${encodeURIComponent(referer)}` : '';
  return `${BASE_URL}/api/cinema/hls?url=${encodeURIComponent(clean)}${ref}`;
};

export const api = {
  // Profiles
  async getProfiles(): Promise<UserProfile[]> {
    return requestJson<UserProfile[]>(`${BASE_URL}/api/auth/profiles`, undefined, 'Profiller yüklenemedi');
  },

  async getProfile(userId: UserId): Promise<UserProfile> {
    return requestJson<UserProfile>(`${BASE_URL}/api/auth/profile/${encodeURIComponent(userId)}`, undefined, 'Profil yüklenemedi');
  },

  async updateProfile(userId: UserId, data: Partial<UserProfile>): Promise<UserProfile> {
    return requestJson<UserProfile>(`${BASE_URL}/api/auth/profile/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Profil güncellenemedi');
  },

  // Letters
  async listLetters(): Promise<LoveLetter[]> {
    return requestJson<LoveLetter[]>(`${BASE_URL}/api/letters`, undefined, 'Mektuplar yüklenemedi');
  },

  async createLetter(data: {
    sender: UserId;
    title?: string;
    content_text?: string;
    canvas_data?: string;
    canvas_image_url?: string;
    stationery_theme?: string;
  }): Promise<LoveLetter> {
    return requestJson<LoveLetter>(`${BASE_URL}/api/letters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Mektup gönderilemedi');
  },

  async openLetter(letterId: number, viewer?: UserId): Promise<LoveLetter> {
    const query = viewer ? `?viewer=${encodeURIComponent(viewer)}` : '';
    return requestJson<LoveLetter>(`${BASE_URL}/api/letters/${letterId}/open${query}`, {
      method: 'POST',
    }, 'Mektup açılamadı');
  },

  async deleteLetter(letterId: number): Promise<{ success: boolean; archived?: boolean }> {
    return requestJson(`${BASE_URL}/api/letters/${letterId}`, {
      method: 'DELETE',
    }, 'Mektup arşive alınamadı');
  },

  /** Arşive kaldırılmış mektubu geri getir (kayıt hiç silinmez). */
  async restoreLetter(letterId: number): Promise<LoveLetter> {
    return requestJson<LoveLetter>(`${BASE_URL}/api/letters/${letterId}/restore`, {
      method: 'POST',
    }, 'Mektup geri getirilemedi');
  },

  /** Arşivdeki bütün mektupları kutuya geri getir. */
  async restoreAllLetters(): Promise<{ success: boolean; restored: number }> {
    return requestJson(`${BASE_URL}/api/letters/restore-all`, { method: 'POST' }, 'Mektuplar geri getirilemedi');
  },

  // Chat
  /**
   * Sohbet geçmişini sayfa sayfa getirir.
   * `beforeId` verilirse o mesajdan DAHA ESKİ olanlar gelir (yukarı kaydırma).
   */
  async getChatMessages(limit = 50, beforeId?: number): Promise<ChatMessage[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (beforeId != null) params.set('before_id', String(beforeId));
    return requestJson<ChatMessage[]>(`${BASE_URL}/api/chat/messages?${params.toString()}`, undefined, 'Mesajlar yüklenemedi');
  },

  /** Toplam mesaj sayısı (geçmişin başı bilgisi için). */
  async getChatMessageCount(): Promise<number> {
    const data = await requestJson<{ total?: number }>(`${BASE_URL}/api/chat/count`, undefined, 'Mesaj sayısı alınamadı');
    return Number(data?.total ?? 0);
  },

  /**
   * Anket oyu ver (ya da mevcut oyu değiştir).
   * Oylar sunucuda tutulur; karşı taraf da aynı işareti görür.
   */
  async votePoll(
    messageId: number,
    voter: UserId,
    optionIndex: number
  ): Promise<{ success: boolean; votes: number[]; voters: Record<string, number> }> {
    return requestJson(`${BASE_URL}/api/chat/messages/${messageId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voter, option_index: optionIndex }),
    }, 'Oy kaydedilemedi');
  },

  async sendChatMessage(data: {
    sender: UserId;
    message_type?: string;
    content?: string;
    media_url?: string;
    duration?: number;
    /** Yalnızca "konum" mesajları için: paylaşılan konumun koordinatları. */
    latitude?: number;
    longitude?: number;
    place_name?: string;
  }): Promise<ChatMessage> {
    return requestJson<ChatMessage>(`${BASE_URL}/api/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Mesaj gönderilemedi');
  },

  // Gallery
  async listGallery(album?: string): Promise<GalleryItem[]> {
    const url = album ? `${BASE_URL}/api/gallery?album=${encodeURIComponent(album)}` : `${BASE_URL}/api/gallery`;
    const data = await requestJson<GalleryItem[]>(url, undefined, 'Galeri yüklenemedi');
    return Array.isArray(data) ? data : [];
  },

  async addGalleryItem(data: {
    uploader: UserId;
    title?: string;
    caption?: string;
    media_type: 'image' | 'video';
    media_url: string;
    album?: string;
  }): Promise<GalleryItem> {
    return requestJson<GalleryItem>(`${BASE_URL}/api/gallery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Galeriye eklenemedi');
  },

  // Notes & Wishlist
  async listNotes(category?: string): Promise<SharedNote[]> {
    const url = category ? `${BASE_URL}/api/notes?category=${encodeURIComponent(category)}` : `${BASE_URL}/api/notes`;
    const data = await requestJson<SharedNote[]>(url, undefined, 'Notlar yüklenemedi');
    return Array.isArray(data) ? data : [];
  },

  async createNote(data: {
    creator: UserId;
    title: string;
    content?: string;
    category: string;
    pinned?: boolean;
  }): Promise<SharedNote> {
    return requestJson<SharedNote>(`${BASE_URL}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Not kaydedilemedi');
  },

  async updateNote(id: number, data: Partial<SharedNote>): Promise<SharedNote> {
    return requestJson<SharedNote>(`${BASE_URL}/api/notes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Not güncellenemedi');
  },

  async deleteNote(id: number): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/notes/${id}`, {
      method: 'DELETE',
    }, 'Not silinemedi');
  },

  // Location & Radar
  async updateLocation(data: {
    user_id: UserId;
    latitude: number;
    longitude: number;
    accuracy?: number;
    place_name?: string;
    battery?: number;
    speed?: number;
  }): Promise<{ success: boolean; distance_km?: number }> {
    return requestJson(`${BASE_URL}/api/location/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Konum güncellenemedi');
  },

  async getCoupleStatus(): Promise<CoupleStatus> {
    return requestJson<CoupleStatus>(`${BASE_URL}/api/location/couple-status`, undefined, 'Durum alınamadı');
  },

  // Nudge & Remote Vibration
  async sendNudge(data: {
    sender: UserId;
    nudge_type?: string;
    message?: string;
  }): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/interactions/nudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Dürtme gönderilemedi');
  },

  async triggerRemoteHaptic(data: {
    sender: UserId;
    pattern: string;
    target_device?: string;
  }): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/interactions/haptic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Titreşim gönderilemedi');
  },

  // Media Upload
  async uploadMedia(
    file: File,
    category = 'general'
  ): Promise<{ url: string; filename: string; [key: string]: unknown }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('media_category', category);
    const data = await requestJson<{ url: string; filename: string; [key: string]: unknown }>(
      `${BASE_URL}/api/media/upload`,
      { method: 'POST', body: formData },
      'Yükleme başarısız'
    );
    if (!data || !data.url) throw new Error('Yükleme yanıtı geçersiz');
    return data;
  },

  // System Version
  async getSystemVersion(): Promise<{ app_name: string; version: string; build_id?: string }> {
    return requestJson(`${BASE_URL}/api/system/version?t=${Date.now()}`, undefined, 'Sürüm bilgisi alınamadı');
  },

  /** Sohbette gönderilen belge/bağlantı için: sunucunun tam adresi. */
  absoluteUrl(url?: string | null): string {
    return mediaUrl(url);
  },

  // ----------------------------------------------------------------------
  // Anlık Fotoğraf (Snap)
  // ----------------------------------------------------------------------
  async listSnaps(sender?: UserId): Promise<SnapStory[]> {
    const url = sender
      ? `${BASE_URL}/api/snaps?sender=${encodeURIComponent(sender)}`
      : `${BASE_URL}/api/snaps`;
    return requestJson<SnapStory[]>(url, undefined, 'Anlar yüklenemedi');
  },

  async getSnapFeed(userId: UserId): Promise<SnapFeed> {
    return requestJson<SnapFeed>(`${BASE_URL}/api/snaps/feed?user_id=${encodeURIComponent(userId)}`, undefined, 'An akışı yüklenemedi');
  },

  async createSnap(data: {
    sender: UserId;
    media_url: string;
    media_type?: 'image' | 'video';
    caption?: string;
    mood?: string;
    duration?: number;
    filter_name?: string;
  }): Promise<SnapStory> {
    return requestJson<SnapStory>(`${BASE_URL}/api/snaps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'An paylaşılamadı');
  },

  async markSnapSeen(snapId: number, viewer?: UserId): Promise<SnapStory> {
    const query = viewer ? `?viewer=${encodeURIComponent(viewer)}` : '';
    return requestJson<SnapStory>(`${BASE_URL}/api/snaps/${snapId}/seen${query}`, { method: 'POST' }, 'An güncellenemedi');
  },

  async reactToSnap(snapId: number, sender: UserId, reaction: string): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/snaps/${snapId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, reaction }),
    }, 'Tepki gönderilemedi');
  },

  async deleteSnap(snapId: number, userId: UserId): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/snaps/${snapId}?user_id=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }, 'An silinemedi');
  },

  // ----------------------------------------------------------------------
  // Günlük
  // ----------------------------------------------------------------------
  async listDiary(viewer: UserId, month?: string): Promise<DiaryEntry[]> {
    const params = new URLSearchParams({ viewer });
    if (month) params.set('month', month);
    return requestJson<DiaryEntry[]>(`${BASE_URL}/api/diary?${params.toString()}`, undefined, 'Günlük yüklenemedi');
  },

  async getDiaryStats(): Promise<DiaryStats> {
    return requestJson<DiaryStats>(`${BASE_URL}/api/diary/stats`, undefined, 'İstatistikler alınamadı');
  },

  async createDiaryEntry(data: {
    author: UserId | 'ortak';
    title: string;
    content?: string;
    mood?: string;
    mood_score?: number;
    weather?: string;
    entry_date?: string;
    photo_url?: string;
    is_locked?: boolean;
  }): Promise<DiaryEntry> {
    return requestJson<DiaryEntry>(`${BASE_URL}/api/diary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Günlük kaydedilemedi');
  },

  async updateDiaryEntry(id: number, data: Partial<DiaryEntry>, viewer?: UserId): Promise<DiaryEntry> {
    const query = viewer ? `?viewer=${encodeURIComponent(viewer)}` : '';
    return requestJson<DiaryEntry>(`${BASE_URL}/api/diary/${id}${query}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Günlük güncellenemedi');
  },

  async deleteDiaryEntry(id: number, viewer?: UserId): Promise<{ success: boolean }> {
    const query = viewer ? `?viewer=${encodeURIComponent(viewer)}` : '';
    return requestJson(`${BASE_URL}/api/diary/${id}${query}`, { method: 'DELETE' }, 'Günlük silinemedi');
  },

  // ----------------------------------------------------------------------
  // Hayvan Albümü
  // ----------------------------------------------------------------------
  async listPets(category?: string): Promise<PetWithPhotos[]> {
    const url = category && category !== 'Tümü'
      ? `${BASE_URL}/api/pets?category=${encodeURIComponent(category)}`
      : `${BASE_URL}/api/pets`;
    return requestJson<PetWithPhotos[]>(url, undefined, 'Hayvan albümü yüklenemedi');
  },

  async createPet(data: {
    name: string;
    category: string;
    emoji?: string;
    photo_url?: string;
    color?: string;
    owner?: string;
    age?: string;
    breed?: string;
    bio?: string;
    love_notes?: string;
    is_favorite?: boolean;
  }): Promise<Pet> {
    return requestJson<Pet>(`${BASE_URL}/api/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Dost eklenemedi');
  },

  async updatePet(id: number, data: Partial<Pet>): Promise<Pet> {
    return requestJson<Pet>(`${BASE_URL}/api/pets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Dost güncellenemedi');
  },

  async deletePet(id: number): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/pets/${id}`, { method: 'DELETE' }, 'Dost silinemedi');
  },

  async addPetPhoto(petId: number, data: {
    uploader: UserId;
    media_url: string;
    media_type?: 'image' | 'video';
    caption?: string;
  }): Promise<PetPhoto> {
    return requestJson<PetPhoto>(`${BASE_URL}/api/pets/${petId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Fotoğraf eklenemedi');
  },

  async deletePetPhoto(petId: number, photoId: number): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/pets/${petId}/photos/${photoId}`, { method: 'DELETE' }, 'Fotoğraf silinemedi');
  },

  // ----------------------------------------------------------------------
  // Sinema Salonu
  // ----------------------------------------------------------------------
  async resolveCinemaLink(videoUrl: string): Promise<{
    source: string; video_url: string; embed_url?: string | null;
    kind: string; poster_url?: string | null;
    /** Film sitelerinden çözülen GERÇEK akış adresi (HLS). */
    stream_url?: string | null;
    /** Akışa erişirken gereken Referer (embed oynatıcısının adresi). */
    stream_referer?: string | null;
    page_url?: string | null; page_title?: string | null;
  }> {
    return requestJson(`${BASE_URL}/api/cinema/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: videoUrl }),
    }, 'Video bağlantısı çözümlenemedi');
  },

  async listCinemaRooms(): Promise<CinemaRoom[]> {
    return requestJson<CinemaRoom[]>(`${BASE_URL}/api/cinema`, undefined, 'Salonlar yüklenemedi');
  },

  async getCurrentCinemaRoom(): Promise<CinemaRoom | null> {
    const res = await fetch(`${BASE_URL}/api/cinema/current`);
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  },

  async createCinemaRoom(data: {
    title: string;
    video_url: string;
    created_by: UserId;
    kind?: string;
    cover_url?: string;
    poster_url?: string;
    /** Sunucunun `/resolve` ile bulduğu, perdeye gömülebilir oynatıcı adresi.
     *  Verilmezse sunucu adresi bir kez daha çözmeye çalışır (yavaş yol). */
    embed_url?: string | null;
    /** Film sitelerinden çözülen gerçek HLS akışı (perde kendi oynatıcısında açar). */
    stream_url?: string | null;
    stream_referer?: string | null;
    source?: string;
  }): Promise<CinemaRoom> {
    return requestJson<CinemaRoom>(`${BASE_URL}/api/cinema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Sinema salonu oluşturulamadı');
  },

  async getCinemaEmbed(roomId: number): Promise<{ html: string | null; kind: string; src: string }> {
    return requestJson(`${BASE_URL}/api/cinema/${roomId}/embed`, undefined, 'Oynatıcı alınamadı');
  },

  async startCinemaRoom(roomId: number, userId: UserId): Promise<CinemaRoom> {
    return requestJson<CinemaRoom>(`${BASE_URL}/api/cinema/${roomId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    }, 'Salon başlatılamadı');
  },

  /**
   * Bu cihazın oynatıcısı hazır.
   *
   * SADE MODEL: film `start` anında başlamaz; iki cihaz da hazır olunca sunucu
   * `cinema_play` yayınlar ve ikisi AYNI ANDA başlar.
   * Yanıt: `started: true` → şimdi başladı; `waiting_for_partner: true` → bekle.
   */
  async markCinemaReady(
    roomId: number,
    userId: UserId,
    position = 0,
    force = false
  ): Promise<{ started: boolean; position?: number; waiting_for_partner?: boolean }> {
    return requestJson(`${BASE_URL}/api/cinema/${roomId}/ready`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, position, force }),
    }, 'Hazır bildirimi başarısız');
  },

  async controlCinemaRoom(roomId: number, data: {
    user_id: UserId;
    action: 'play' | 'pause' | 'seek' | 'adopt' | 'join' | 'duration' | 'leave' | 'stop';
    position?: number;
    duration?: number;
  }): Promise<CinemaRoom> {
    return requestJson<CinemaRoom>(`${BASE_URL}/api/cinema/${roomId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Salon kontrolü başarısız');
  },

  async reactInCinema(roomId: number, sender: UserId, emoji: string): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/cinema/${roomId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, emoji }),
    }, 'Tepki gönderilemedi');
  },

  async deleteCinemaRoom(roomId: number): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/cinema/${roomId}`, { method: 'DELETE' }, 'Salon silinemedi');
  },

  // ----------------------------------------------------------------------
  // Sinema Takvimi
  // ----------------------------------------------------------------------
  async listShowtimes(month: string, viewer: UserId): Promise<Showtime[]> {
    const data = await requestJson<Showtime[]>(
      `${BASE_URL}/api/cinema/calendar?month=${encodeURIComponent(month)}&viewer=${encodeURIComponent(viewer)}`,
      undefined,
      'Takvim yüklenemedi'
    );
    return Array.isArray(data) ? data : [];
  },

  async getTonightShowtime(viewer: UserId): Promise<Showtime | null> {
    const res = await fetch(`${BASE_URL}/api/cinema/calendar/tonight?viewer=${encodeURIComponent(viewer)}`);
    if (!res.ok) return null;
    const text = await res.text();
    return text && text !== 'null' ? JSON.parse(text) : null;
  },

  async getNextShowtime(viewer: UserId): Promise<Showtime | null> {
    const res = await fetch(`${BASE_URL}/api/cinema/calendar/next?viewer=${encodeURIComponent(viewer)}`);
    if (!res.ok) return null;
    const text = await res.text();
    return text && text !== 'null' ? JSON.parse(text) : null;
  },

  async createShowtime(data: {
    title: string;
    video_url: string;
    show_date: string;
    show_time?: string;
    description?: string;
    genre?: string;
    poster_url?: string;
    hall?: string;
    created_by: UserId;
  }): Promise<Showtime> {
    return requestJson<Showtime>(`${BASE_URL}/api/cinema/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, video_url: cinemaVideoUrl(data.video_url) }),
    }, 'Seans eklenemedi');
  },

  async updateShowtime(id: number, data: Partial<Showtime> & { updated_by?: string }): Promise<Showtime> {
    const payload = { ...data, updated_by: data.updated_by || 'manuel' };
    if (payload.video_url) payload.video_url = cinemaVideoUrl(payload.video_url);
    return requestJson<Showtime>(`${BASE_URL}/api/cinema/calendar/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }, 'Seans güncellenemedi');
  },

  async deleteShowtime(id: number): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/cinema/calendar/${id}`, { method: 'DELETE' }, 'Seans silinemedi');
  },

  async bookTicket(showtimeId: number, userId: UserId): Promise<Showtime> {
    return requestJson<Showtime>(`${BASE_URL}/api/cinema/calendar/${showtimeId}/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    }, 'Bilet alınamadı');
  },

  async cancelTicket(showtimeId: number, userId: UserId): Promise<Showtime> {
    return requestJson<Showtime>(
      `${BASE_URL}/api/cinema/calendar/${showtimeId}/ticket?user_id=${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
      'Bilet iptal edilemedi'
    );
  },

  async openShowtime(showtimeId: number, userId: UserId): Promise<Showtime> {
    return requestJson<Showtime>(`${BASE_URL}/api/cinema/calendar/${showtimeId}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    }, 'Salon açılamadı');
  },

  // OpenClaw / otomasyon: bütün ayı tek istekte ayarla
  async importCalendar(data: {
    month: string;
    replace_existing?: boolean;
    created_by?: string;
    showtimes: {
      title: string;
      video_url: string;
      show_date: string;
      show_time?: string;
      description?: string;
      genre?: string;
      poster_url?: string;
      hall?: string;
    }[];
  }): Promise<{ success: boolean; month: string; created: number; removed: number }> {
    return requestJson(`${BASE_URL}/api/cinema/calendar/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Takvim içe aktarılamadı');
  },

  async autoScheduleCalendar(data: {
    month: string;
    day?: number;
    time?: string;
    replace_existing?: boolean;
    films: { title: string; video_url: string }[];
  }): Promise<{ success: boolean; month: string; created: number }> {
    return requestJson(`${BASE_URL}/api/cinema/calendar/auto-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Otomatik plan oluşturulamadı');
  },

  // ----------------------------------------------------------------------
  // Bahçe (demo ritüeller)
  // ----------------------------------------------------------------------
  async getDailyQuestion(userId: UserId): Promise<{
    date: string; prompt: string; my_answer?: string; partner_answer?: string;
    answered_mine: boolean; answered_partner: boolean; both_answered: boolean; demo: boolean;
  }> {
    return requestJson(`${BASE_URL}/api/garden/question?viewer=${encodeURIComponent(userId)}`, undefined, 'Günlük soru alınamadı');
  },

  async answerDailyQuestion(userId: UserId, answer: string): Promise<{ success: boolean; revealed: boolean }> {
    return requestJson(`${BASE_URL}/api/garden/question/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, answer }),
    }, 'Cevap gönderilemedi');
  },

  async listCapsules(userId: UserId): Promise<any[]> {
    const data = await requestJson<any[]>(`${BASE_URL}/api/garden/capsules?viewer=${encodeURIComponent(userId)}`, undefined, 'Kapsüller yüklenemedi');
    return Array.isArray(data) ? data : [];
  },

  async createCapsule(data: {
    sender: UserId; title: string; content: string; open_date: string;
  }): Promise<{ success: boolean; id: number }> {
    return requestJson(`${BASE_URL}/api/garden/capsules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Kapsül oluşturulamadı');
  },

  async deleteCapsule(capsuleId: number, userId: UserId): Promise<{ success: boolean }> {
    return requestJson(
      `${BASE_URL}/api/garden/capsules/${capsuleId}?user_id=${encodeURIComponent(userId)}`,
      { method: 'DELETE' },
      'Kapsül silinemedi'
    );
  },

  async listSongs(): Promise<any[]> {
    const data = await requestJson<any[]>(`${BASE_URL}/api/garden/songs`, undefined, 'Şarkılar yüklenemedi');
    return Array.isArray(data) ? data : [];
  },

  async addSong(data: {
    added_by: UserId; title: string; artist?: string; url: string; note?: string;
  }): Promise<{ success: boolean; id: number }> {
    return requestJson(`${BASE_URL}/api/garden/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }, 'Şarkı eklenemedi');
  },

  async getOnThisDay(): Promise<{ date: string; count: number; items: any[]; demo: boolean }> {
    return requestJson(`${BASE_URL}/api/garden/on-this-day`, undefined, 'Geçmiş anılar yüklenemedi');
  },

  async getMood(userId: UserId): Promise<{
    today: string | null; history: any[]; moods: Record<string, any>; demo: boolean;
    partner_today?: string | null;
  }> {
    return requestJson(`${BASE_URL}/api/garden/mood?user_id=${encodeURIComponent(userId)}`, undefined, 'Duygu havası alınamadı');
  },

  async setMood(userId: UserId, mood: string): Promise<{ success: boolean }> {
    return requestJson(`${BASE_URL}/api/garden/mood`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, mood }),
    }, 'Duygu havası güncellenemedi');
  },

  async getGardenSummary(userId: UserId): Promise<any> {
    return requestJson(`${BASE_URL}/api/garden/summary?viewer=${encodeURIComponent(userId)}`, undefined, 'Bahçe özeti alınamadı');
  },
};
