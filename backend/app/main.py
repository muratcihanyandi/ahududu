import os
import json
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse

from backend.app.config import settings
from backend.app.database import init_db
from backend.app.websocket_manager import ws_manager
from backend.app.routes import auth, letters, chat, gallery, notes, location, watch, media

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ahududu")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Ahududu database...")
    try:
        await init_db()
        logger.info("Database tables initialized successfully.")
    except Exception as e:
        logger.error(f"Database initialization warning: {e}")
    yield

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
app.include_router(watch.router)
app.include_router(media.router)

# Version check endpoint for zero-reinstall instant updates
@app.get("/api/system/version")
async def get_system_version():
    index_file = os.path.join(settings.STATIC_DIR, "index.html")
    build_id = str(int(os.path.getmtime(index_file))) if os.path.exists(index_file) else settings.APP_VERSION
    return {
        "app_name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "build_id": build_id,
        "env": settings.ENV,
        "features": [
            "spen_canvas", "letters_wax_seal", "nudge_button",
            "walkie_talkie", "watch_biometrics", "couple_radar",
            "remote_vibrate", "shared_gallery", "shared_notes"
        ]
    }

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
                partner_id = "sevgilim" if user_id == "murat" else "murat"
                
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
                elif msg_type == "walkie_talkie_audio":
                    # Broadcast direct audio buffer chunk or url to partner
                    await ws_manager.send_to_user(partner_id, {
                        "type": "walkie_talkie_play",
                        "sender": user_id,
                        "audio_base64": data.get("audio_base64"),
                        "audio_url": data.get("audio_url")
                    })
                elif msg_type == "watch_pulse":
                    # Instant watch animation pulse
                    await ws_manager.send_to_user(partner_id, {
                        "type": "watch_animation",
                        "sender": user_id,
                        "animation": data.get("animation", "heartbeat")
                    })
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

if os.path.exists(static_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_path, "assets")), name="assets")
    
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        requested_file = os.path.join(static_path, full_path)
        if full_path and os.path.exists(requested_file) and not os.path.isdir(requested_file):
            if full_path.startswith("assets/"):
                return FileResponse(requested_file, headers={"Cache-Control": "public, max-age=31536000, immutable"})
            return FileResponse(requested_file, headers=NO_CACHE_HEADERS)
        index_file = os.path.join(static_path, "index.html")
        if os.path.exists(index_file):
            return FileResponse(index_file, headers=NO_CACHE_HEADERS)
        return JSONResponse({"status": "Ahududu API is running. Frontend build not found yet."})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
