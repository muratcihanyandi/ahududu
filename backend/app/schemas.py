from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Any
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

class ChatMessageCreate(BaseModel):
    sender: str
    message_type: str = "text"
    content: Optional[str] = None
    media_url: Optional[str] = None
    duration: Optional[int] = 0

class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    sender: str
    message_type: str
    content: Optional[str]
    media_url: Optional[str]
    duration: Optional[int]
    created_at: datetime

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

class WatchBiometricsUpdate(BaseModel):
    user_id: str
    heart_rate: int
    steps: Optional[int] = 0
    stress_level: Optional[int] = 20
    watch_model: Optional[str] = "Galaxy Watch"
    battery: Optional[int] = 100

class NudgeRequest(BaseModel):
    sender: str
    nudge_type: str = "attention" # attention, hug, kiss, heartbeat, emergency
    message: Optional[str] = "Seni çok özledim ve ilgi istiyorum! 🥰"

class RemoteHapticRequest(BaseModel):
    sender: str
    pattern: str = "heartbeat" # heartbeat, double_buzz, tickle, sos
    target_device: str = "all" # phone, watch, all
