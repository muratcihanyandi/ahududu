export type UserId = 'murat' | 'sevgilim';

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

export interface WatchBiometrics {
  user_id: UserId;
  heart_rate: number;
  steps: number;
  stress_level: number;
  battery: number;
  watch_model: string;
  recorded_at?: string;
}

export interface CoupleStatus {
  murat: {
    lat?: number;
    lon?: number;
    place: string;
    battery: number;
    status: string;
    last_seen?: string;
  };
  sevgilim: {
    lat?: number;
    lon?: number;
    place: string;
    battery: number;
    status: string;
    last_seen?: string;
  };
  distance_km?: number;
}
