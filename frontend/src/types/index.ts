export type UserId = 'murat' | 'selin';

export const USERS: Record<UserId, { name: string; emoji: string }> = {
  murat: { name: 'Murat', emoji: '🐻' },
  selin: { name: 'Selin', emoji: '🌸' },
};

export const partnerOf = (id: UserId): UserId => (id === 'murat' ? 'selin' : 'murat');
export const nameOf = (id: UserId): string => USERS[id].name;

export interface UserProfile {
  id: UserId;
  display_name: string;
  avatar: string;
  status_text: string;
  battery_level: number;
  is_charging: boolean;
  last_seen?: string;
  current_lat?: number;
  current_lon?: number;
  place_name?: string;
}

export interface LoveLetter {
  id: number;
  sender: UserId;
  title: string;
  content_text?: string;
  canvas_data?: string; // S-Pen vector points JSON
  canvas_image_url?: string;
  stationery_theme: 'vintage_parchment' | 'rose_blush' | 'starry_night' | 'lavender';
  is_sealed: boolean;
  is_opened: boolean;
  opened_at?: string;
  created_at: string;
  /** Arşiv: sunucuda kutuya kaldırıldı (kayıt SİLİNMEZ, geri getirilebilir). */
  is_deleted?: boolean;
  deleted_at?: string;
}

export interface ChatMessage {
  id: number;
  sender: UserId;
  message_type: 'text' | 'image' | 'video' | 'voice' | 'walkie_talkie' | 'nudge';
  content?: string;
  media_url?: string;
  duration?: number;
  created_at: string;
}

export interface GalleryItem {
  id: number;
  uploader: UserId;
  title?: string;
  caption?: string;
  media_type: 'image' | 'video';
  media_url: string;
  thumbnail_url?: string;
  album: string;
  taken_at: string;
  created_at: string;
}

export interface SharedNote {
  id: number;
  creator: UserId;
  title: string;
  content?: string;
  category: 'note' | 'wishlist' | 'movies' | 'places' | 'shopping';
  is_completed: boolean;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface CouplePersonStatus {
  lat?: number;
  lon?: number;
  place: string;
  battery: number;
  status: string;
  last_seen?: string;
}

export interface CoupleStatus {
  murat: CouplePersonStatus;
  selin: CouplePersonStatus;
  distance_km?: number | null;
}

// ---------------------------- Anlık Fotoğraf ----------------------------

export type SnapMood = 'mutlu' | 'özledim' | 'uykum' | 'kızgın' | 'aşık' | 'heyecanlı' | 'üzgün';

export interface SnapStory {
  id: number;
  sender: UserId;
  media_url: string;
  media_type: 'image' | 'video';
  caption?: string;
  mood?: SnapMood;
  duration?: number;
  filter_name?: string;
  is_seen: boolean;
  seen_at?: string;
  created_at: string;
  expires_at: string;
}

export interface SnapFeedSlot {
  count: number;
  unseen?: number;
  unseen_by_partner?: number;
  latest: SnapStory | null;
}

export interface SnapFeed {
  me: SnapFeedSlot;
  partner: SnapFeedSlot;
}

// -------------------------------- Günlük --------------------------------

export type DiaryMood = 'mutlu' | 'aşık' | 'sakin' | 'heyecanlı' | 'üzgün' | 'kızgın' | 'yorgun';

export interface DiaryEntry {
  id: number;
  author: UserId | 'ortak';
  title: string;
  content?: string;
  mood?: DiaryMood;
  mood_score?: number;
  weather?: string;
  entry_date: string; // YYYY-MM-DD
  photo_url?: string;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface DiaryStats {
  total: number;
  streak: number;
  authors: Record<string, number>;
  moods: Record<string, number>;
  first_date?: string | null;
  last_date?: string | null;
  total_days?: number;
}

// ---------------------------- Hayvan Albümü ----------------------------

export interface Pet {
  id: number;
  name: string;
  category: string;
  emoji?: string;
  photo_url?: string;
  color?: string;
  owner: 'murat' | 'selin' | 'bizim';
  age?: string;
  breed?: string;
  bio?: string;
  love_notes?: string;
  is_favorite: boolean;
  sort_order: number;
  created_at: string;
}

export interface PetPhoto {
  id: number;
  pet_id: number;
  uploader: UserId;
  media_url: string;
  media_type: 'image' | 'video';
  caption?: string;
  created_at: string;
}

export interface PetWithPhotos {
  pet: Pet;
  photos: PetPhoto[];
  photo_count: number;
  last_photo_at?: string;
}

// ------------------------------ Sinema Salonu ------------------------------

export interface CinemaRoom {
  id: number;
  title: string;
  video_url: string;
  source: string;
  embed_url?: string;
  cover_url?: string;
  poster_url?: string;
  kind: string;
  created_by: UserId;
  is_playing: boolean;
  is_active: boolean;
  position: number;
  duration: number;
  updated_by?: UserId;
  last_seen_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CinemaSyncEvent {
  type: 'cinema_sync';
  room_id: number;
  action: 'play' | 'pause' | 'seek' | 'adopt' | 'join' | 'leave' | 'stop';
  position: number;
  duration: number;
  is_playing: boolean;
  is_active: boolean;
  updated_by: UserId;
  updated_at: string;
}

// ---------------------------- Sinema Takvimi ----------------------------

export interface Showtime {
  id: number;
  title: string;
  description?: string;
  genre: string;
  poster_url?: string;
  video_url: string;
  embed_url?: string;
  source: string;
  duration_minutes: number;
  show_date: string;      // YYYY-MM-DD
  show_time: string;      // HH:MM
  hall: string;
  seats: number;
  booked_by: string;      // "murat,selin"
  booked_count: number;
  my_ticket: boolean;
  partner_ticket: boolean;
  ticket_code?: string;
  is_published: boolean;
  is_cancelled: boolean;
  created_by: string;
  updated_by?: string;
  created_at: string;
  updated_at: string;
  room_id?: number;
  started_at?: string;
  starts_in_minutes?: number | null;
  is_tonight: boolean;
}
