from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Text, Boolean, Float, DateTime
from backend.app.database import Base

def now_utc():
    return datetime.now(timezone.utc)

class UserProfile(Base):
    __tablename__ = "user_profiles"
    
    id = Column(String(50), primary_key=True) # 'murat' or 'selin'
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
    sender = Column(String(50), nullable=False) # 'murat' or 'selin'
    title = Column(String(200), default="Sana Bir Mektubum Var ❤️")
    content_text = Column(Text, nullable=True)
    canvas_data = Column(Text, nullable=True) # S-Pen vector stroke JSON
    canvas_image_url = Column(String(500), nullable=True) # Pre-rendered canvas drawing
    stationery_theme = Column(String(50), default="vintage_parchment")
    is_sealed = Column(Boolean, default=True)
    is_opened = Column(Boolean, default=False)
    opened_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    # Mektuplar SİLİNMEZ: kutuya kaldırılanlar burada işaretlenir ve
    # `deleted_at` ile ne zaman kaldırıldığı saklanır. Diske de JSON yedeği
    # alınır (services/letter_archive.py), böylece hiçbir mektup kaybolmaz.
    is_deleted = Column(Boolean, default=False)
    deleted_at = Column(DateTime(timezone=True), nullable=True)

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


# ---------------------------------------------------------------------------
# Anlık Fotoğraf (Snap) — 24 saatlik "şu an ne yapıyorum" kareleri
# ---------------------------------------------------------------------------

class SnapStory(Base):
    __tablename__ = "snap_stories"

    id = Column(Integer, primary_key=True, index=True)
    sender = Column(String(50), nullable=False)          # 'murat' or 'selin'
    media_url = Column(String(500), nullable=False)
    media_type = Column(String(20), default="image")      # image, video
    caption = Column(String(300), nullable=True)
    mood = Column(String(30), default="mutlu")            # mutlu, özledim, uykum, kızgın...
    duration = Column(Integer, default=5)                 # video için saniye
    filter_name = Column(String(30), default="none")
    is_seen = Column(Boolean, default=False)
    seen_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    expires_at = Column(DateTime(timezone=True), nullable=False)


# ---------------------------------------------------------------------------
# Günlük — ikimizin ortak anı defteri
# ---------------------------------------------------------------------------

class DiaryEntry(Base):
    __tablename__ = "diary_entries"

    id = Column(Integer, primary_key=True, index=True)
    author = Column(String(50), nullable=False)           # murat, selin, ortak
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=True)
    mood = Column(String(30), default="mutlu")
    mood_score = Column(Integer, default=5)               # 1..5 yıldız
    weather = Column(String(30), default="none")
    entry_date = Column(String(10), nullable=False)       # YYYY-MM-DD (günlük gün)
    photo_url = Column(String(500), nullable=True)
    is_locked = Column(Boolean, default=False)            # sadece yazan görebilir
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


# ---------------------------------------------------------------------------
# Hayvan Albümü — Murat ve Selin'in hayvan arkadaşları
# ---------------------------------------------------------------------------

class PetProfile(Base):
    __tablename__ = "pet_profiles"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), nullable=False)
    category = Column(String(40), default="kedi")         # kedi, köpek, kuş, balık, tavşan...
    emoji = Column(String(10), default="🐾")
    photo_url = Column(String(500), nullable=True)
    color = Column(String(20), default="#be185d")
    owner = Column(String(50), default="bizim")           # murat, selin, bizim
    age = Column(String(30), nullable=True)
    breed = Column(String(80), nullable=True)
    bio = Column(Text, nullable=True)
    love_notes = Column(Text, nullable=True)              # "sevimli halleri" notları
    is_favorite = Column(Boolean, default=False)
    sort_order = Column(Integer, default=0)
    created_at = Column(DateTime(timezone=True), default=now_utc)


class PetPhoto(Base):
    __tablename__ = "pet_photos"

    id = Column(Integer, primary_key=True, index=True)
    pet_id = Column(Integer, nullable=False, index=True)  # pet_profiles.id
    uploader = Column(String(50), nullable=False)
    media_url = Column(String(500), nullable=False)
    media_type = Column(String(20), default="image")
    caption = Column(String(300), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)


# ---------------------------------------------------------------------------
# Sinema Salonu — birlikte izleme odası
# ---------------------------------------------------------------------------

class CinemaRoom(Base):
    __tablename__ = "cinema_rooms"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    video_url = Column(String(1000), nullable=False)
    source = Column(String(50), default="link")           # link, upload, embed
    embed_url = Column(String(1000), nullable=True)       # iframe ile izlenen adresler
    cover_url = Column(String(1000), nullable=True)
    poster_url = Column(String(1000), nullable=True)
    kind = Column(String(30), default="film")             # film, dizi, klip, video
    created_by = Column(String(50), default="murat")
    is_playing = Column(Boolean, default=False)
    is_active = Column(Boolean, default=False)
    position = Column(Float, default=0.0)                 # saniye
    duration = Column(Float, default=0.0)                 # saniye
    updated_by = Column(String(50), nullable=True)
    last_seen_at = Column(DateTime(timezone=True), nullable=True)   # partner odada mı
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)


# ---------------------------------------------------------------------------
# Sinema Takvimi — o ayın yayın programı ("beyaz perde")
# ---------------------------------------------------------------------------
#
# Akış:
#   1. Takvime film eklenir (başlık, afiş, seans saati, video linki/sitesi).
#   2. İki kişi film için "bilet alır" (gerçek bilet değil, ortak rezervasyon).
#   3. Seans saati gelince/tıklayınca salon açılır; izleme senkron ilerler.

class CinemaShowtime(Base):
    __tablename__ = "cinema_showtimes"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    genre = Column(String(60), default="film")            # film, dizi, belgesel, klip, animasyon
    poster_url = Column(String(1000), nullable=True)      # afiş (varsa)
    video_url = Column(String(1000), nullable=False)      # izlenecek site/yayın adresi
    embed_url = Column(String(1000), nullable=True)       # sayfa içinde oynatılabilir adres
    source = Column(String(50), default="link")           # youtube, vimeo, embed, link...
    duration_minutes = Column(Integer, default=0)

    # Seans zamanı: ayın günü + saat (yerel saat, Europe/Istanbul)
    show_date = Column(String(10), nullable=False)        # YYYY-MM-DD
    show_time = Column(String(5), default="21:00")        # HH:MM
    hall = Column(String(50), default="Salon 1")          # salon adı
    seats = Column(Integer, default=2)                    # bilet sayısı

    # Biletler: hangi kullanıcılar bilet aldı (virgülle: "murat,selin")
    booked_by = Column(Text, default="")                  # "" -> kimse almadı
    ticket_code = Column(String(40), nullable=True)       # bilet kodu / rezervasyon numarası

    is_published = Column(Boolean, default=True)          # takvimde görünsün mü
    is_cancelled = Column(Boolean, default=False)
    created_by = Column(String(50), default="murat")
    updated_by = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)
    updated_at = Column(DateTime(timezone=True), default=now_utc, onupdate=now_utc)

    # Sinema odasıyla bağlantı: seans salonu, bu oda kimliğini kullanır
    room_id = Column(Integer, nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)   # salon açıldı mı


# ---------------------------------------------------------------------------
# Bahçe — çift ritüelleri (Günlük Soru, Zaman Kapsülü, Şarkılar, Duygu Havası)
# ---------------------------------------------------------------------------

class CoupleDailyQuestion(Base):
    __tablename__ = "couple_daily_questions"

    id = Column(Integer, primary_key=True, index=True)
    question_date = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    prompt = Column(String(400), nullable=False)
    # Cevaplar "kullanici|||cevap" satırlarıyla saklanır
    answers = Column(Text, default="")
    created_at = Column(DateTime(timezone=True), default=now_utc)


class CoupleTimeCapsule(Base):
    __tablename__ = "couple_time_capsules"

    id = Column(Integer, primary_key=True, index=True)
    sender = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False)
    open_date = Column(String(30), nullable=False)   # ISO tarih/saat
    created_at = Column(DateTime(timezone=True), default=now_utc)


class CoupleSong(Base):
    __tablename__ = "couple_songs"

    id = Column(Integer, primary_key=True, index=True)
    added_by = Column(String(50), nullable=False)
    title = Column(String(200), nullable=False)
    artist = Column(String(200), nullable=True)
    url = Column(String(1000), nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=now_utc)


class CoupleMoodWeather(Base):
    __tablename__ = "couple_mood_weather"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(50), nullable=False, index=True)
    mood_date = Column(String(10), nullable=False, index=True)   # YYYY-MM-DD
    mood = Column(String(20), nullable=False)
    created_at = Column(DateTime(timezone=True), default=now_utc)

