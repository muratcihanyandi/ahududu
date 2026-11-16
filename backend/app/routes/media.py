import mimetypes
import os
import uuid
import aiofiles
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import FileResponse
from backend.app.config import settings

router = APIRouter(prefix="/api/media", tags=["media"])

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {
    # Images
    "png", "jpg", "jpeg", "webp", "gif",
    # Audio (sesli mesaj: webm, mp3, m4a, wav, ogg, aac, caf, amr, 3gp)
    "webm", "mp3", "wav", "m4a", "ogg", "aac", "caf", "amr", "3gp",
    # Video
    "mp4", "mov", "mkv"
}

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    media_category: str = Form("general") # letters, chat, gallery, voice
):
    ext = file.filename.split(".")[-1].lower() if "." in file.filename else "bin"
    if ext not in ALLOWED_EXTENSIONS:
        ext = "png" if "image" in file.content_type else ("webm" if "audio" in file.content_type else "bin")
    
    unique_filename = f"{uuid.uuid4().hex}_{media_category}.{ext}"
    dest_path = os.path.join(settings.UPLOAD_DIR, unique_filename)
    
    async with aiofiles.open(dest_path, "wb") as buffer:
        while content := await file.read(1024 * 1024): # 1MB chunks
            await buffer.write(content)
            
    media_url = f"/api/media/file/{unique_filename}"
    return {
        "success": True,
        "filename": unique_filename,
        "url": media_url,
        "content_type": file.content_type
    }

@router.get("/file/{filename}", response_model=None)
async def get_file(filename: str, request: Request):
    # Sanitize filename
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(settings.UPLOAD_DIR, safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    media_type, _ = mimetypes.guess_type(safe_filename)
    if not media_type:
        media_type = "application/octet-stream"

    # Sinema Salonu ve Android WebView videoyu PARÇA PARÇA (Range) ister.
    # Range desteklenmezse video ilerlemez, sarma çalışmaz, bazen siyah kalır.
    return FileResponse(
        file_path,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
            # Telefondaki WebView/Capacitor kabuğundan erişim için
            "Access-Control-Allow-Origin": "*",
        },
    )


@router.head("/file/{filename}")
async def head_file(filename: str):
    """Bazı oynatıcılar (Android/ExoPlayer) önce HEAD ile süre ve boyut sorar."""
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(settings.UPLOAD_DIR, safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")

    media_type, _ = mimetypes.guess_type(safe_filename)
    return FileResponse(
        file_path,
        media_type=media_type or "application/octet-stream",
        headers={
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
        },
    )
