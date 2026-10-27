import os
import uuid
import aiofiles
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from backend.app.config import settings

router = APIRouter(prefix="/api/media", tags=["media"])

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {
    # Images
    "png", "jpg", "jpeg", "webp", "gif",
    # Audio
    "webm", "mp3", "wav", "m4a", "ogg", "aac",
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

@router.get("/file/{filename}")
async def get_file(filename: str):
    # Sanitize filename
    safe_filename = os.path.basename(filename)
    file_path = os.path.join(settings.UPLOAD_DIR, safe_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    return FileResponse(file_path)
