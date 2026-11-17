import os
import re
import json
import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from backend.app.config import settings
from backend.app.database import init_db
from backend.app.websocket_manager import ws_manager
from backend.app.routes import (
    auth, letters, chat, gallery, notes, location, interactions, media,
    snaps, diary, pets, cinema, cinema_calendar, garden,
)
from backend.app.routes import cinema as cinema_room_module

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ahududu")

BUILD_ID_POLL_SECONDS = 3
BUILD_ID_META_NAME = "ahududu-build-id"
BUILD_ID_FILE = "build-id.txt"


def get_build_id() -> str:
    """Identify the deployed frontend bundle.

    The deploy script writes build-id.txt next to index.html. It is authoritative
    because container image layers do not preserve file timestamps, so an mtime
    based id would differ between the workstation and the running container.
    """
    build_id_path = os.path.join(settings.STATIC_DIR, BUILD_ID_FILE)
    if os.path.exists(build_id_path):
        try:
            with open(build_id_path, "r", encoding="utf-8") as f:
                value = f.read().strip()
            if value:
                return value
        except OSError as e:
            logger.warning("Could not read %s: %s", BUILD_ID_FILE, e)

    index_file = os.path.join(settings.STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return str(int(os.path.getmtime(index_file)))
    return settings.APP_VERSION


async def watch_build_changes():
    """Notify every connected client as soon as a new frontend build is deployed."""
    last_build_id = get_build_id()
    while True:
        await asyncio.sleep(BUILD_ID_POLL_SECONDS)
        current_build_id = get_build_id()
        if current_build_id == last_build_id:
            continue
        last_build_id = current_build_id
        logger.info("New frontend build detected (%s), notifying clients.", current_build_id)
        try:
            await ws_manager.broadcast({"type": "app_update", "build_id": current_build_id})
        except Exception as e:
            logger.warning("app_update broadcast failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Ahududu database...")
    try:
        await init_db()
        logger.info("Database tables initialized successfully.")
    except Exception as e:
        logger.error(f"Database initialization warning: {e}")

    # Mektup arşivi: yedeği olmayan mektupların bir kez diske yedeğini al.
    try:
        from backend.app.services import letter_archive
        from backend.app.database import AsyncSessionLocal
        from backend.app.models import LoveLetter
        from sqlalchemy import select

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(LoveLetter))
            await letter_archive.backfill_letter_backups(result.scalars().all())
    except Exception as e:  # noqa: BLE001
        logger.warning("Mektup yedeği alınamadı: %s", e)

    watcher = asyncio.create_task(watch_build_changes())
    try:
        yield
    finally:
        watcher.cancel()
        with suppress(asyncio.CancelledError):
            await watcher

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan
)

# CORS setup for mobile web, PWA & tunnel domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(auth.router)
app.include_router(letters.router)
app.include_router(chat.router)
app.include_router(gallery.router)
app.include_router(notes.router)
app.include_router(location.router)
app.include_router(interactions.router)
app.include_router(media.router)
app.include_router(snaps.router)
app.include_router(diary.router)
app.include_router(pets.router)
app.include_router(cinema.router)
app.include_router(cinema_calendar.router)
app.include_router(garden.router)

# Version check endpoint for zero-reinstall instant updates
@app.get("/api/system/version")
async def get_system_version():
    return {
        "app_name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "build_id": get_build_id(),
        "env": settings.ENV,
        "features": [
            "spen_canvas", "letters_wax_seal", "nudge_button",
            "couple_radar",
            "remote_vibrate", "shared_gallery", "shared_notes", "auto_update",
            "snap_stories", "shared_diary", "pet_album", "cinema_salonu",
            "letter_archive", "dark_cinema_calendar", "voice_messages"
        ]
    }


# ---- Çok oyunculu oyun rölesi ----
# Oyun (ör. Uno merdivenli) kendi oyun-içi arayüzünü bu soket üzerinden açık
# tutar. Sunucu paketi yorumlamaz, yalnızca partnere aktarır ve boyut sınırı
# koyar: kamera kareleri tek bir büyük mesajla soket döngüsünü tıkamasın.
GAME_MAX_PACKET_BYTES = 60 * 1024        # kamera karesi (JPEG base64) sınırı
GAME_MSG_PREFIX = "game_"


async def relay_game_packet(partner_id: str, sender_id: str, data: dict,
                            SUMMARY_ONLY: bool = False) -> None:
    """Bir oyun paketini partnere ilet.

    SUMMARY_ONLY: paket büyük alanlar (kamera/mikrofon verisi) içeriyorsa
    yalnızca küçük özeti geçer; veri paketleri limite uymazsa düşer.
    """
    payload = dict(data)
    payload["from"] = sender_id
    if SUMMARY_ONLY:
        payload.pop("data", None)
    else:
        blob = payload.get("data")
        if isinstance(blob, str) and len(blob) > GAME_MAX_PACKET_BYTES:
            logger.debug("game paketi çok büyük (%s bayt), atlandı", len(blob))
            return
    await ws_manager.send_to_user(partner_id, payload)


# Real-time WebSocket connection
@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await ws_manager.connect(websocket, user_id)
    try:
        while True:
            data_text = await websocket.receive_text()
            try:
                data = json.loads(data_text)
                msg_type = data.get("type")
                partner_id = settings.partner_of(user_id)
                
                if msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))
                elif msg_type == "nudge":
                    await ws_manager.send_to_user(partner_id, {
                        "type": "nudge",
                        "sender": user_id,
                        "nudge_type": data.get("nudge_type", "attention"),
                        "message": data.get("message", "Seni çok özledim! ❤️")
                    })
                elif msg_type == "remote_vibrate":
                    await ws_manager.send_to_user(partner_id, {
                        "type": "remote_vibrate",
                        "sender": user_id,
                        "pattern_name": data.get("pattern", "heartbeat"),
                        "vibration_pattern": data.get("vibration_pattern", [120, 100, 180, 800, 120, 100, 180]),
                        "target_device": data.get("target_device", "all")
                    })
                elif msg_type == "cinema_presence":
                    # Partner salonda mı? Anlık durum, veritabanına dokunmadan.
                    # Ayrıca kişinin Ahududu durumu "Sinemada" olarak güncellenir.
                    is_watching = bool(data.get("is_watching"))
                    title = data.get("title")
                    await ws_manager.send_to_user(partner_id, {
                        "type": "cinema_presence",
                        "user_id": user_id,
                        "room_id": data.get("room_id"),
                        "is_watching": is_watching,
                        "title": title,
                    })
                    # "Sinemada" durumu + giriş bildirimi
                    try:
                        await cinema_room_module.set_cinema_presence(user_id, is_watching, title)
                    except Exception as exc:  # noqa: BLE001
                        logger.debug("cinema_presence kaydı başarısız: %s", exc)
                    if is_watching:
                        # Partnerin ekranında büyük bildirim: "Selin sinema salonuna girdi 🍿"
                        await ws_manager.send_to_user(partner_id, {
                            "type": "cinema_partner_joined",
                            "user_id": user_id,
                            "title": title,
                            "room_id": data.get("room_id"),
                        })
                elif msg_type == "cinema_position_reply":
                    # Salona biri girdiğinde, oynayan tarafın CANLI konumu.
                    # Tek tur: soru soruldu, cevap geldi, iş bitti.
                    # (Sürekli checkpoint YOK — kullanıcı isteğiyle kaldırıldı.)
                    room_id = data.get("room_id")
                    position = data.get("position")
                    if room_id is not None and position is not None:
                        try:
                            cinema_room_module.resolve_position(int(room_id), float(position))
                        except Exception as e:  # noqa: BLE001
                            logger.debug("cinema_position_reply işlenemedi: %s", e)
                elif msg_type == "cinema_heartbeat":
                    # SADE MODEL: kalp atışı / sürekli checkpoint YOK.
                    # Oynarken senkron yapmıyoruz (Murat 20:11, Selin 20:22
                    # olabilir). Bu mesaj yalnızca "salondayım" bilgisini taşır.
                    room_id = data.get("room_id")
                    await ws_manager.send_to_user(partner_id, {
                        "type": "cinema_heartbeat",
                        "user_id": user_id,
                        "room_id": room_id,
                        "position": data.get("position"),
                        "is_playing": bool(data.get("is_playing")),
                    })
                elif msg_type.startswith("game_"):
                    # ---- Oyunlar (çok oyunculu) ----
                    # "game_car" (araba konumu, 20 Hz), "game_cam_frame" (canlı
                    # kamera karesi), "game_hello", "game_cam_status", "game_mic".
                    # Paket olduğu gibi partnere aktarılır; sunucuda işlenmez.
                    if msg_type == "game_car":
                        await relay_game_packet(partner_id, user_id, data, SUMMARY_ONLY=True)
                    else:
                        await relay_game_packet(partner_id, user_id, data)
            except Exception as e:
                logger.error(f"Error processing WS packet: {e}")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket, user_id)
    except Exception as e:
        logger.error(f"WS error: {e}")
        ws_manager.disconnect(websocket, user_id)

# Serve Frontend static assets with strict no-cache for index.html to guarantee instant updates
static_path = settings.STATIC_DIR
NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0"
}
BUILD_ID_META_PATTERN = re.compile(
    r'<meta\s+name="' + BUILD_ID_META_NAME + r'"\s+content="[^"]*"\s*/?>'
)


def render_index_html():
    """Serve index.html with the exact build id of the bundle it references."""
    index_file = os.path.join(static_path, "index.html")
    if not os.path.exists(index_file):
        return None
    with open(index_file, "r", encoding="utf-8") as f:
        html = f.read()

    # Read the mtime once: the meta tag must match the build the client will load.
    meta_tag = f'<meta name="{BUILD_ID_META_NAME}" content="{get_build_id()}" />'

    # Drop any stale copies so exactly one authoritative tag remains.
    html = BUILD_ID_META_PATTERN.sub("", html)
    if "</head>" in html:
        html = html.replace("</head>", f"    {meta_tag}\n  </head>", 1)
    else:
        html = meta_tag + html
    return html


if os.path.exists(static_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_path, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Resolve inside the static directory only, so the catch-all route cannot escape it.
        requested_file = os.path.realpath(os.path.join(static_path, full_path))
        static_root = os.path.realpath(static_path)
        inside_static = requested_file == static_root or requested_file.startswith(static_root + os.sep)
        if (
            full_path
            and inside_static
            and os.path.isfile(requested_file)
        ):
            if full_path.startswith("assets/"):
                return FileResponse(requested_file, headers={"Cache-Control": "public, max-age=31536000, immutable"})
            return FileResponse(requested_file, headers=NO_CACHE_HEADERS)
        html = render_index_html()
        if html is not None:
            return HTMLResponse(html, headers=NO_CACHE_HEADERS)
        return JSONResponse({"status": "Ahududu API is running. Frontend build not found yet."})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
