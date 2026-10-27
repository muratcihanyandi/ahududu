from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, Boolean, Float, DateTime
from backend.app.database import Base

def now_utc():
    return datetime.now(timezone.utc)

class UserProfile(Base):
    __tablename__ = "user_profiles"
    
    id = Column(String(50), primary_key=True) # 'murat' or 'sevgilim'
    display_name = Column(String(100), nullable=False)
    avatar = Column(String(255), default="❤️")
    status_text = Column(String(100), default="Seni Düşünüyor 🥰")
    battery_level = Column(Integer, default=100)
    is_charging = Column(Boolean, default=False)
    last_seen = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)
    current_lat = Column(Float, nullable=True)
    current_lon = Column(Float, nullable=True)
    place_name = Column(String(150), default="Konum alınıyor...")

class LoveLetter(Base):
    __tablename__ = "love_letters"
    
    id = Column(Integer, primary_key=True, index=True)
    sender = Column(String(50), nullable=False) # 'murat' or 'sevgilim'
    title = Column(String(200), default="Sana Bir Mektubum Var ❤️")
    content_text = Column(Text, nullable=True)
    canvas_data = Column(Text, nullable=True) # S-Pen vector stroke JSON
    canvas_image_url = Column(String(500), nullable=True) # Pre-rendered canvas drawing
    stationery_theme = Column(String(50), default="vintage_parchment")
    is_sealed = Column(Boolean, default=True)
    is_opened = Column(Boolean, default=False)
    opened_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    
    id = Column(Integer, primary_key=True, index=True)
    sender = Column(String(50), nullable=False)
    message_type = Column(String(30), default="text") # text, image, video, voice, walkie_talkie, nudge
    content = Column(Text, nullable=True)
    media_url = Column(String(500), nullable=True)
    duration = Column(Integer, default=0) # Voice note duration in seconds
    created_at = Column(DateTime(timezone=True), default=now_utc)

class GalleryItem(Base):
    __tablename__ = "gallery_items"
    
    id = Column(Integer, primary_key=True, index=True)
    uploader = Column(String(50), nullable=False)
    title = Column(String(200), nullable=True)
    caption = Column(Text, nullable=True)
    media_type = Column(String(20), default="image") # image, video
    media_url = Column(String(500), nullable=False)
    thumbnail_url = Column(String(500), nullable=True)
    album = Column(String(100), default="Bizim Anılarımız")
    taken_at = Column(DateTime(timezone=True), default=now_utc)
    created_at = Column(DateTime(timezone=True), default=now_utc)

class SharedNote(Base):
    __tablename__ = "shared_notes"
    
    id = Column(Integer, primary_key=True, index=True)
    creator = Column(String(50), nullable=False)
    title = Column(String(255), nullable=False)
    content = Column(Text, nullable=True)
    category = Column(String(50), default="note") # note, wishlist, movies, places, shopping
    is_completed = Column(Boolean, default=False)
    pinned = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

class LocationLog(Base):
    __tablename__ = "location_logs"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(50), nullable=False, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    accuracy = Column(Float, default=10.0)
    place_name = Column(String(200), default="Konum")
    battery = Column(Integer, default=100)
    speed = Column(Float, default=0.0)
    updated_at = Column(DateTime(timezone=True), default=now_utc)

class WatchBiometrics(Base):
    __tablename__ = "watch_biometrics"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(50), nullable=False, index=True)
    heart_rate = Column(Integer, default=72)
    steps = Column(Integer, default=0)
    stress_level = Column(Integer, default=20) # 1-100
    watch_model = Column(String(100), default="Samsung Galaxy Watch")
    battery = Column(Integer, default=100)
    recorded_at = Column(DateTime(timezone=True), default=now_utc)
