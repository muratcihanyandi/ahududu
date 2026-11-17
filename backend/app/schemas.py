from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any, Dict
from datetime import datetime

class UserProfileSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    display_name: str
    avatar: str
    status_text: str
    battery_level: int
    is_charging: bool
    last_seen: Optional[datetime] = None
    current_lat: Optional[float] = None
    current_lon: Optional[float] = None
    place_name: Optional[str] = None

class UserProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    avatar: Optional[str] = None
    status_text: Optional[str] = None
    battery_level: Optional[int] = None
    is_charging: Optional[bool] = None
    place_name: Optional[str] = None

class LoveLetterCreate(BaseModel):
    sender: str
    title: Optional[str] = "Sana Bir Mektubum Var ❤️"
    content_text: Optional[str] = None
    canvas_data: Optional[str] = None
    canvas_image_url: Optional[str] = None
    stationery_theme: Optional[str] = "vintage_parchment"

class LoveLetterResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sender: str
    title: str
    content_text: Optional[str]
    canvas_data: Optional[str]
    canvas_image_url: Optional[str]
    stationery_theme: str
    is_sealed: bool
    is_opened: bool
    opened_at: Optional[datetime]
    created_at: datetime
    # Arşiv: mektup kutuya kaldırıldıysa True (kayıt silinmez, geri getirilebilir)
    is_deleted: Optional[bool] = False
    deleted_at: Optional[datetime] = None

class ChatMessageCreate(BaseModel):
    """Sohbet mesajı.

    `message_type`:
      text, image, video, voice, walkie_talkie, nudge
      konum  -> `latitude` + `longitude` (+ `place_name`); `content` etikettir
      anket  -> `content` = soru, ilk satır; aşağıdaki satırlar seçenekler
      etkinlik -> `content` = başlık, ilk satır; kalan satırlar ayrıntı
    """
    sender: str
    message_type: str = "text"
    content: Optional[str] = None
    media_url: Optional[str] = None
    duration: Optional[int] = 0
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    place_name: Optional[str] = None

class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sender: str
    message_type: str
    content: Optional[str]
    media_url: Optional[str]
    duration: Optional[int]
    created_at: datetime
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    place_name: Optional[str] = None
    # Yalnızca "anket" mesajlarında dolu gelir: seçenek başına oy sayısı.
    votes: Optional[List[int]] = None
    # Bu anket mesajına oy verenler: {voter: option_index}
    voters: Optional[Dict[str, int]] = None


class PollVoteRequest(BaseModel):
    """Anket oyu: kişi başına tek oy; tekrar oy verilirse oyu değiştirir."""
    voter: str
    option_index: int

class GalleryItemCreate(BaseModel):
    uploader: str
    title: Optional[str] = None
    caption: Optional[str] = None
    media_type: str = "image"
    media_url: str
    thumbnail_url: Optional[str] = None
    album: Optional[str] = "Bizim Anılarımız"

class GalleryItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    uploader: str
    title: Optional[str]
    caption: Optional[str]
    media_type: str
    media_url: str
    thumbnail_url: Optional[str]
    album: str
    taken_at: datetime
    created_at: datetime

class SharedNoteCreate(BaseModel):
    creator: str
    title: str
    content: Optional[str] = None
    category: str = "note"
    pinned: bool = False

class SharedNoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    category: Optional[str] = None
    is_completed: Optional[bool] = None
    pinned: Optional[bool] = None

class SharedNoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    creator: str
    title: str
    content: Optional[str]
    category: str
    is_completed: bool
    pinned: bool
    created_at: datetime
    updated_at: datetime

class LocationUpdate(BaseModel):
    user_id: str
    latitude: float
    longitude: float
    accuracy: Optional[float] = 10.0
    place_name: Optional[str] = "Konum"
    battery: Optional[int] = 100
    speed: Optional[float] = 0.0

class NudgeRequest(BaseModel):
    sender: str
    nudge_type: str = "attention" # attention, hug, kiss, heartbeat, emergency
    message: Optional[str] = "Seni çok özledim ve ilgi istiyorum! 🥰"

class RemoteHapticRequest(BaseModel):
    sender: str
    pattern: str = "heartbeat" # heartbeat, double_buzz, tickle, sos
    target_device: str = "phone" # phone, all


# ------------------------------ Anlık Fotoğraf ------------------------------

class SnapStoryCreate(BaseModel):
    sender: str
    media_url: str
    media_type: str = "image"
    caption: Optional[str] = None
    mood: Optional[str] = "mutlu"
    duration: Optional[int] = 5
    filter_name: Optional[str] = "none"


class SnapStoryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sender: str
    media_url: str
    media_type: str
    caption: Optional[str]
    mood: Optional[str]
    duration: Optional[int]
    filter_name: Optional[str]
    is_seen: bool
    seen_at: Optional[datetime]
    created_at: datetime
    expires_at: datetime


class SnapReaction(BaseModel):
    sender: str
    reaction: str = "❤️"


# --------------------------------- Günlük ----------------------------------

class DiaryEntryCreate(BaseModel):
    author: str
    title: str
    content: Optional[str] = None
    mood: Optional[str] = "mutlu"
    mood_score: Optional[int] = 5
    weather: Optional[str] = "none"
    entry_date: Optional[str] = None
    photo_url: Optional[str] = None
    is_locked: bool = False


class DiaryEntryUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    mood: Optional[str] = None
    mood_score: Optional[int] = None
    weather: Optional[str] = None
    entry_date: Optional[str] = None
    photo_url: Optional[str] = None
    is_locked: Optional[bool] = None


class DiaryEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    author: str
    title: str
    content: Optional[str]
    mood: Optional[str]
    mood_score: Optional[int]
    weather: Optional[str]
    entry_date: str
    photo_url: Optional[str]
    is_locked: bool
    created_at: datetime
    updated_at: datetime


# ------------------------------ Hayvan Albümü ------------------------------

class PetCreate(BaseModel):
    name: str
    category: str = "kedi"
    emoji: Optional[str] = "🐾"
    photo_url: Optional[str] = None
    color: Optional[str] = "#be185d"
    owner: str = "bizim"
    age: Optional[str] = None
    breed: Optional[str] = None
    bio: Optional[str] = None
    love_notes: Optional[str] = None
    is_favorite: bool = False


class PetUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    emoji: Optional[str] = None
    photo_url: Optional[str] = None
    color: Optional[str] = None
    owner: Optional[str] = None
    age: Optional[str] = None
    breed: Optional[str] = None
    bio: Optional[str] = None
    love_notes: Optional[str] = None
    is_favorite: Optional[bool] = None


class PetPhotoCreate(BaseModel):
    uploader: str
    media_url: str
    media_type: str = "image"
    caption: Optional[str] = None


class PetPhotoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    pet_id: int
    uploader: str
    media_url: str
    media_type: str
    caption: Optional[str]
    created_at: datetime


class PetWithPhotos(BaseModel):
    pet: "PetResponse"
    photos: List[PetPhotoResponse] = []
    photo_count: int = 0
    last_photo_at: Optional[datetime] = None


class PetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    category: str
    emoji: Optional[str]
    photo_url: Optional[str]
    color: Optional[str]
    owner: str
    age: Optional[str]
    breed: Optional[str]
    bio: Optional[str]
    love_notes: Optional[str]
    is_favorite: bool
    sort_order: int
    created_at: datetime


PetWithPhotos.model_rebuild()


# ------------------------------ Sinema Salonu ------------------------------

class CinemaRoomCreate(BaseModel):
    title: str
    video_url: str
    source: str = "link"
    embed_url: Optional[str] = None
    stream_url: Optional[str] = None
    stream_referer: Optional[str] = None
    cover_url: Optional[str] = None
    poster_url: Optional[str] = None
    kind: Optional[str] = "film"
    created_by: str = "murat"


class CinemaRoomResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    video_url: str
    source: str
    embed_url: Optional[str]
    stream_url: Optional[str] = None
    stream_referer: Optional[str] = None
    cover_url: Optional[str]
    poster_url: Optional[str]
    kind: str
    created_by: str
    is_playing: bool
    is_active: bool
    position: float
    duration: float
    updated_by: Optional[str]
    last_seen_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class CinemaControl(BaseModel):
    user_id: str
    action: str                       # play, pause, seek, adopt, leave
    position: Optional[float] = 0.0
    duration: Optional[float] = 0.0


class CinemaReaction(BaseModel):
    sender: str
    emoji: str = "❤️"


# ---------------------------- Sinema Takvimi ----------------------------

class ShowtimeCreate(BaseModel):
    title: str
    description: Optional[str] = None
    genre: Optional[str] = "film"
    poster_url: Optional[str] = None
    video_url: str
    duration_minutes: Optional[int] = 0
    show_date: str                      # YYYY-MM-DD
    show_time: Optional[str] = "21:00"  # HH:MM
    hall: Optional[str] = "Salon 1"
    seats: Optional[int] = 2
    is_published: bool = True
    created_by: str = "murat"


class ShowtimeUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    genre: Optional[str] = None
    poster_url: Optional[str] = None
    video_url: Optional[str] = None
    duration_minutes: Optional[int] = None
    show_date: Optional[str] = None
    show_time: Optional[str] = None
    hall: Optional[str] = None
    seats: Optional[int] = None
    is_published: Optional[bool] = None
    is_cancelled: Optional[bool] = None
    updated_by: Optional[str] = None


class ShowtimeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    title: str
    description: Optional[str]
    genre: str
    poster_url: Optional[str]
    video_url: str
    embed_url: Optional[str]
    source: str
    duration_minutes: Optional[int]
    show_date: str
    show_time: str
    hall: str
    seats: int
    booked_by: str
    ticket_code: Optional[str]
    is_published: bool
    is_cancelled: bool
    created_by: str
    updated_by: Optional[str]
    created_at: datetime
    updated_at: datetime
    room_id: Optional[int]
    started_at: Optional[datetime]


class TicketRequest(BaseModel):
    user_id: str


class CalendarImportItem(BaseModel):
    """OpenClaw / otomasyon için: tek satırlık film bilgisi."""
    title: str
    video_url: str
    show_date: str
    show_time: Optional[str] = "21:00"
    description: Optional[str] = None
    genre: Optional[str] = "film"
    poster_url: Optional[str] = None
    duration_minutes: Optional[int] = 0
    hall: Optional[str] = "Salon 1"


class CalendarImport(BaseModel):
    """Bir ayın tamamını tek istekte ayarlama (OpenClaw için)."""
    month: Optional[str] = None           # YYYY-MM (verilmezse tarihlerden çıkarılır)
    replace_existing: bool = False        # o ayın mevcut seanslarını sil
    created_by: Optional[str] = "openclaw"
    showtimes: List[CalendarImportItem]

