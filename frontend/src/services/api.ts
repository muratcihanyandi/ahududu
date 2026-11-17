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
    return saved || 'https://ahududu.fakeyol.com';
  }
  
  // Normal browser or PWA loaded from Pi or Cloudflare
  return '';
};

const BASE_URL = getServerBaseUrl();

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
    const res = await fetch(`${BASE_URL}/api/auth/profiles`);
    return res.json();
  },

  async getProfile(userId: UserId): Promise<UserProfile> {
    const res = await fetch(`${BASE_URL}/api/auth/profile/${userId}`);
    return res.json();
  },

  async updateProfile(userId: UserId, data: Partial<UserProfile>): Promise<UserProfile> {
    const res = await fetch(`${BASE_URL}/api/auth/profile/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  // Letters
  async listLetters(): Promise<LoveLetter[]> {
    const res = await fetch(`${BASE_URL}/api/letters`);
    return res.json();
  },

  async createLetter(data: {
    sender: UserId;
    title?: string;
    content_text?: string;
    canvas_data?: string;
    canvas_image_url?: string;
    stationery_theme?: string;
  }): Promise<LoveLetter> {
    const res = await fetch(`${BASE_URL}/api/letters`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async openLetter(letterId: number): Promise<LoveLetter> {
    const res = await fetch(`${BASE_URL}/api/letters/${letterId}/open`, {
      method: 'POST',
    });
    return res.json();
  },

  async deleteLetter(letterId: number): Promise<{ success: boolean; archived?: boolean }> {
    const res = await fetch(`${BASE_URL}/api/letters/${letterId}`, {
      method: 'DELETE',
    });
    return res.json();
  },

  /** Arşive kaldırılmış mektubu geri getir (kayıt hiç silinmez). */
  async restoreLetter(letterId: number): Promise<LoveLetter> {
    const res = await fetch(`${BASE_URL}/api/letters/${letterId}/restore`, {
      method: 'POST',
    });
    return res.json();
  },

  // ----------------------------------------------------------------------
  // Cihaz kaydı (uygulama kapalıyken mesaj bildirimi için)
  // ----------------------------------------------------------------------
  async registerDevice(data: {
    user_id: UserId;
    token: string;
    platform?: string;
  }): Promise<{ success: boolean; push_ready?: boolean }> {
    const res = await fetch(`${BASE_URL}/api/devices/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async getPushStatus(): Promise<{
    configured: boolean;
    mode: string | null;
    devices: Record<string, number>;
  }> {
    const res = await fetch(`${BASE_URL}/api/devices/status`);
    return res.json();
  },

  /** Arşivdeki bütün mektupları kutuya geri getir. */
  async restoreAllLetters(): Promise<{ success: boolean; restored: number }> {
    const res = await fetch(`${BASE_URL}/api/letters/restore-all`, { method: 'POST' });
    return res.json();
  },

  // Chat
  /**
   * Sohbet geçmişini sayfa sayfa getirir.
   * `beforeId` verilirse o mesajdan DAHA ESKİ olanlar gelir (yukarı kaydırma).
   */
  async getChatMessages(limit = 50, beforeId?: number): Promise<ChatMessage[]> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (beforeId != null) params.set('before_id', String(beforeId));
    const res = await fetch(`${BASE_URL}/api/chat/messages?${params.toString()}`);
    return res.json();
  },

  /** Toplam mesaj sayısı (geçmişin başı bilgisi için). */
  async getChatMessageCount(): Promise<number> {
    const res = await fetch(`${BASE_URL}/api/chat/count`);
    const data = await res.json();
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
    const res = await fetch(`${BASE_URL}/api/chat/messages/${messageId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voter, option_index: optionIndex }),
    });
    if (!res.ok) throw new Error(`Oy kaydedilemedi (${res.status})`);
    return res.json();
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
    const res = await fetch(`${BASE_URL}/api/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Mesaj gönderilemedi (${res.status})`);
    return res.json();
  },

  // Gallery
  async listGallery(album?: string): Promise<GalleryItem[]> {
    const url = album ? `${BASE_URL}/api/gallery?album=${encodeURIComponent(album)}` : `${BASE_URL}/api/gallery`;
    const res = await fetch(url);
    const data = await res.json();
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
    const res = await fetch(`${BASE_URL}/api/gallery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  // Notes & Wishlist
  async listNotes(category?: string): Promise<SharedNote[]> {
    const url = category ? `${BASE_URL}/api/notes?category=${category}` : `${BASE_URL}/api/notes`;
    const res = await fetch(url);
    return res.json();
  },

  async createNote(data: {
    creator: UserId;
    title: string;
    content?: string;
    category: string;
    pinned?: boolean;
  }): Promise<SharedNote> {
    const res = await fetch(`${BASE_URL}/api/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async updateNote(id: number, data: Partial<SharedNote>): Promise<SharedNote> {
    const res = await fetch(`${BASE_URL}/api/notes/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteNote(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/notes/${id}`, {
      method: 'DELETE',
    });
    return res.json();
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
    const res = await fetch(`${BASE_URL}/api/location/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async getCoupleStatus(): Promise<CoupleStatus> {
    const res = await fetch(`${BASE_URL}/api/location/couple-status`);
    return res.json();
  },

  // Nudge & Remote Vibration
  async sendNudge(data: {
    sender: UserId;
    nudge_type?: string;
    message?: string;
  }): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/interactions/nudge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async triggerRemoteHaptic(data: {
    sender: UserId;
    pattern: string;
    target_device?: string;
  }): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/interactions/haptic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  // Media Upload
  async uploadMedia(
    file: File,
    category = 'general'
  ): Promise<{ url: string; filename: string; [key: string]: unknown }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('media_category', category);
    const res = await fetch(`${BASE_URL}/api/media/upload`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) throw new Error(`Yükleme başarısız (${res.status})`);
    const data = await res.json();
    if (!data || !data.url) throw new Error('Yükleme yanıtı geçersiz');
    return data;
  },

  // System Version
  async getSystemVersion(): Promise<{ app_name: string; version: string; build_id?: string }> {
    const res = await fetch(`${BASE_URL}/api/system/version?t=${Date.now()}`);
    return res.json();
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
    const res = await fetch(url);
    return res.json();
  },

  async getSnapFeed(userId: UserId): Promise<SnapFeed> {
    const res = await fetch(`${BASE_URL}/api/snaps/feed?user_id=${encodeURIComponent(userId)}`);
    return res.json();
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
    const res = await fetch(`${BASE_URL}/api/snaps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async markSnapSeen(snapId: number): Promise<SnapStory> {
    const res = await fetch(`${BASE_URL}/api/snaps/${snapId}/seen`, { method: 'POST' });
    return res.json();
  },

  async reactToSnap(snapId: number, sender: UserId, reaction: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/snaps/${snapId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, reaction }),
    });
    return res.json();
  },

  async deleteSnap(snapId: number, userId: UserId): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/snaps/${snapId}?user_id=${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
    return res.json();
  },

  // ----------------------------------------------------------------------
  // Günlük
  // ----------------------------------------------------------------------
  async listDiary(viewer: UserId, month?: string): Promise<DiaryEntry[]> {
    const params = new URLSearchParams({ viewer });
    if (month) params.set('month', month);
    const res = await fetch(`${BASE_URL}/api/diary?${params.toString()}`);
    return res.json();
  },

  async getDiaryStats(): Promise<DiaryStats> {
    const res = await fetch(`${BASE_URL}/api/diary/stats`);
    return res.json();
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
    const res = await fetch(`${BASE_URL}/api/diary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async updateDiaryEntry(id: number, data: Partial<DiaryEntry>): Promise<DiaryEntry> {
    const res = await fetch(`${BASE_URL}/api/diary/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteDiaryEntry(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/diary/${id}`, { method: 'DELETE' });
    return res.json();
  },

  // ----------------------------------------------------------------------
  // Hayvan Albümü
  // ----------------------------------------------------------------------
  async listPets(category?: string): Promise<PetWithPhotos[]> {
    const url = category && category !== 'Tümü'
      ? `${BASE_URL}/api/pets?category=${encodeURIComponent(category)}`
      : `${BASE_URL}/api/pets`;
    const res = await fetch(url);
    return res.json();
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
    const res = await fetch(`${BASE_URL}/api/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async updatePet(id: number, data: Partial<Pet>): Promise<Pet> {
    const res = await fetch(`${BASE_URL}/api/pets/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deletePet(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/pets/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async addPetPhoto(petId: number, data: {
    uploader: UserId;
    media_url: string;
    media_type?: 'image' | 'video';
    caption?: string;
  }): Promise<PetPhoto> {
    const res = await fetch(`${BASE_URL}/api/pets/${petId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deletePetPhoto(petId: number, photoId: number): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/pets/${petId}/photos/${photoId}`, { method: 'DELETE' });
    return res.json();
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
    const res = await fetch(`${BASE_URL}/api/cinema/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_url: videoUrl }),
    });
    return res.json();
  },

  async listCinemaRooms(): Promise<CinemaRoom[]> {
    const res = await fetch(`${BASE_URL}/api/cinema`);
    return res.json();
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
    const res = await fetch(`${BASE_URL}/api/cinema`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async getCinemaEmbed(roomId: number): Promise<{ html: string | null; kind: string; src: string }> {
    const res = await fetch(`${BASE_URL}/api/cinema/${roomId}/embed`);
    return res.json();
  },

  async startCinemaRoom(roomId: number, userId: UserId): Promise<CinemaRoom> {
    const res = await fetch(`${BASE_URL}/api/cinema/${roomId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    return res.json();
  },

  async controlCinemaRoom(roomId: number, data: {
    user_id: UserId;
    action: 'play' | 'pause' | 'seek' | 'adopt' | 'join' | 'leave' | 'stop';
    position?: number;
    duration?: number;
  }): Promise<CinemaRoom> {
    const res = await fetch(`${BASE_URL}/api/cinema/${roomId}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async reactInCinema(roomId: number, sender: UserId, emoji: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/cinema/${roomId}/react`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender, emoji }),
    });
    return res.json();
  },

  async deleteCinemaRoom(roomId: number): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/cinema/${roomId}`, { method: 'DELETE' });
    return res.json();
  },

  // ----------------------------------------------------------------------
  // Sinema Takvimi
  // ----------------------------------------------------------------------
  async listShowtimes(month: string, viewer: UserId): Promise<Showtime[]> {
    const res = await fetch(
      `${BASE_URL}/api/cinema/calendar?month=${encodeURIComponent(month)}&viewer=${encodeURIComponent(viewer)}`
    );
    const data = await res.json();
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
    const res = await fetch(`${BASE_URL}/api/cinema/calendar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, video_url: cinemaVideoUrl(data.video_url) }),
    });
    return res.json();
  },

  async updateShowtime(id: number, data: Partial<Showtime> & { updated_by?: string }): Promise<Showtime> {
    const payload = { ...data, updated_by: data.updated_by || 'manuel' };
    if (payload.video_url) payload.video_url = cinemaVideoUrl(payload.video_url);
    const res = await fetch(`${BASE_URL}/api/cinema/calendar/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.json();
  },

  async deleteShowtime(id: number): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/cinema/calendar/${id}`, { method: 'DELETE' });
    return res.json();
  },

  async bookTicket(showtimeId: number, userId: UserId): Promise<Showtime> {
    const res = await fetch(`${BASE_URL}/api/cinema/calendar/${showtimeId}/ticket`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || 'Bilet alınamadı');
    return res.json();
  },

  async cancelTicket(showtimeId: number, userId: UserId): Promise<Showtime> {
    const res = await fetch(
      `${BASE_URL}/api/cinema/calendar/${showtimeId}/ticket?user_id=${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
    return res.json();
  },

  async openShowtime(showtimeId: number, userId: UserId): Promise<Showtime> {
    const res = await fetch(`${BASE_URL}/api/cinema/calendar/${showtimeId}/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId }),
    });
    if (!res.ok) {
      let detail = 'Salon açılamadı';
      try {
        detail = (await res.json()).detail || detail;
      } catch {
        /* yut */
      }
      throw new Error(detail);
    }
    return res.json();
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
    const res = await fetch(`${BASE_URL}/api/cinema/calendar/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async autoScheduleCalendar(data: {
    month: string;
    day?: number;
    time?: string;
    replace_existing?: boolean;
    films: { title: string; video_url: string }[];
  }): Promise<{ success: boolean; month: string; created: number }> {
    const res = await fetch(`${BASE_URL}/api/cinema/calendar/auto-schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  // ----------------------------------------------------------------------
  // Bahçe (demo ritüeller)
  // ----------------------------------------------------------------------
  async getDailyQuestion(userId: UserId): Promise<{
    date: string; prompt: string; my_answer?: string; partner_answer?: string;
    answered_mine: boolean; answered_partner: boolean; both_answered: boolean; demo: boolean;
  }> {
    const res = await fetch(`${BASE_URL}/api/garden/question?viewer=${encodeURIComponent(userId)}`);
    return res.json();
  },

  async answerDailyQuestion(userId: UserId, answer: string): Promise<{ success: boolean; revealed: boolean }> {
    const res = await fetch(`${BASE_URL}/api/garden/question/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, answer }),
    });
    return res.json();
  },

  async listCapsules(userId: UserId): Promise<any[]> {
    const res = await fetch(`${BASE_URL}/api/garden/capsules?viewer=${encodeURIComponent(userId)}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  async createCapsule(data: {
    sender: UserId; title: string; content: string; open_date: string;
  }): Promise<{ success: boolean; id: number }> {
    const res = await fetch(`${BASE_URL}/api/garden/capsules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async deleteCapsule(capsuleId: number, userId: UserId): Promise<{ success: boolean }> {
    const res = await fetch(
      `${BASE_URL}/api/garden/capsules/${capsuleId}?user_id=${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
    return res.json();
  },

  async listSongs(): Promise<any[]> {
    const res = await fetch(`${BASE_URL}/api/garden/songs`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  },

  async addSong(data: {
    added_by: UserId; title: string; artist?: string; url: string; note?: string;
  }): Promise<{ success: boolean; id: number }> {
    const res = await fetch(`${BASE_URL}/api/garden/songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async getOnThisDay(): Promise<{ date: string; count: number; items: any[]; demo: boolean }> {
    const res = await fetch(`${BASE_URL}/api/garden/on-this-day`);
    return res.json();
  },

  async getMood(userId: UserId): Promise<{
    today: string | null; history: any[]; moods: Record<string, any>; demo: boolean;
    partner_today?: string | null;
  }> {
    const res = await fetch(`${BASE_URL}/api/garden/mood?user_id=${encodeURIComponent(userId)}`);
    return res.json();
  },

  async setMood(userId: UserId, mood: string): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/garden/mood`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, mood }),
    });
    return res.json();
  },

  async getGardenSummary(userId: UserId): Promise<any> {
    const res = await fetch(`${BASE_URL}/api/garden/summary?viewer=${encodeURIComponent(userId)}`);
    return res.json();
  },
};
