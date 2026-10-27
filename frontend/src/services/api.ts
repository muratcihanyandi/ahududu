import {
  UserProfile, LoveLetter, ChatMessage, GalleryItem,
  SharedNote, WatchBiometrics, CoupleStatus, UserId
} from '../types';

export const getServerBaseUrl = (): string => {
  if (typeof window === 'undefined') return 'http://192.168.2.170:33470';
  
  // If running inside Capacitor Native Android App (where origin is https://localhost)
  if (window.location.hostname === 'localhost' && window.location.port !== '33470' && window.location.port !== '5173') {
    const saved = localStorage.getItem('ahududu_server_url');
    return saved || 'http://192.168.2.170:33470';
  }
  
  // Normal browser or PWA loaded from Pi or Cloudflare
  return '';
};

const BASE_URL = getServerBaseUrl();

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

  async deleteLetter(letterId: number): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/letters/${letterId}`, {
      method: 'DELETE',
    });
    return res.json();
  },

  // Chat
  async getChatMessages(limit = 50): Promise<ChatMessage[]> {
    const res = await fetch(`${BASE_URL}/api/chat/messages?limit=${limit}`);
    return res.json();
  },

  async sendChatMessage(data: {
    sender: UserId;
    message_type?: string;
    content?: string;
    media_url?: string;
    duration?: number;
  }): Promise<ChatMessage> {
    const res = await fetch(`${BASE_URL}/api/chat/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  // Gallery
  async listGallery(album?: string): Promise<GalleryItem[]> {
    const url = album ? `${BASE_URL}/api/gallery?album=${encodeURIComponent(album)}` : `${BASE_URL}/api/gallery`;
    const res = await fetch(url);
    return res.json();
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

  // Watch & Nudge
  async sendNudge(data: {
    sender: UserId;
    nudge_type?: string;
    message?: string;
  }): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/watch/nudge`, {
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
    const res = await fetch(`${BASE_URL}/api/watch/haptic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async updateWatchBiometrics(data: {
    user_id: UserId;
    heart_rate: number;
    steps?: number;
    stress_level?: number;
    watch_model?: string;
    battery?: number;
  }): Promise<{ success: boolean }> {
    const res = await fetch(`${BASE_URL}/api/watch/biometrics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.json();
  },

  async getWatchBiometrics(userId: UserId): Promise<WatchBiometrics> {
    const res = await fetch(`${BASE_URL}/api/watch/biometrics/${userId}`);
    return res.json();
  },

  // Media Upload
  async uploadMedia(file: File, category = 'general'): Promise<{ url: string; filename: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('media_category', category);
    const res = await fetch(`${BASE_URL}/api/media/upload`, {
      method: 'POST',
      body: formData,
    });
    return res.json();
  },

  // System Version
  async getSystemVersion(): Promise<{ app_name: string; version: string; build_id?: string }> {
    const res = await fetch(`${BASE_URL}/api/system/version?t=${Date.now()}`);
    return res.json();
  }
};
