import mimetypes
import os
import uuid
import aiofiles
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from backend.app.config import settings

router = APIRouter(prefix="/api/media", tags=["media"])

os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
MAX_UPLOAD_BYTES = 150 * 1024 * 1024  # 150 MB

SAFE_INLINE_IMAGE_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/bmp",
}

ALLOWED_EXTENSIONS = {
    # Images
    "png", "jpg", "jpeg", "webp", "gif", "heic", "heif", "bmp",
    # Audio (sesli mesaj: webm, mp3, m4a, wav, ogg, aac, caf, amr, 3gp)
    "webm", "mp3", "wav", "m4a", "ogg", "aac", "caf", "amr", "3gp", "opus", "oga",
    # Video
    "mp4", "mov", "mkv", "m4v", "webm", "avi", "3gp", "ts",
    # Belge (sohbette ataç → Belge): pdf, office, metin, arşiv
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv",
    "json", "rtf", "odt", "ods", "odp", "epub", "zip", "rar", "7z",
}


def _guess_extension(file: UploadFile) -> str:
    """Dosya uzantısını tahmin eder.

    Android'de her dosya bir ada sahip olmadığından (`content://` seçicileri
    bazen adı boş gönderir) MIME türüne de bakılır; hiçbiri yoksa `bin` olur —
    belge gönderimi asla bozuk bir uzantıyla düşmesin.
    """
    name = (file.filename or "").strip()
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext in ALLOWED_EXTENSIONS:
        return ext

    content_type = (file.content_type or "").lower()
    mimetypes_map = {
        "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
        "image/gif": "gif", "image/heic": "heic", "image/heif": "heif",
        "audio/webm": "webm", "audio/mpeg": "mp3", "audio/mp4": "m4a",
        "audio/x-m4a": "m4a", "audio/wav": "wav", "audio/ogg": "ogg",
        "audio/aac": "aac", "audio/amr": "amr",
        "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
        "video/x-matroska": "mkv", "video/3gpp": "3gp",
        "application/pdf": "pdf",
        "application/msword": "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/vnd.ms-excel": "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.ms-powerpoint": "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
        "text/plain": "txt", "text/csv": "csv", "text/markdown": "md",
        "application/json": "json", "application/rtf": "rtf",
        "application/epub+zip": "epub",
        "application/zip": "zip",
        "application/vnd.rar": "rar", "application/x-rar-compressed": "rar",
        "application/x-7z-compressed": "7z",
        "application/vnd.oasis.opendocument.text": "odt",
        "application/vnd.oasis.opendocument.spreadsheet": "ods",
        "application/vnd.oasis.opendocument.presentation": "odp",
    }
    if content_type in mimetypes_map:
        return mimetypes_map[content_type]
    if "image" in content_type and "svg" not in content_type and "xml" not in content_type:
        return "png"
    if "audio" in content_type:
        return "webm"
    if "video" in content_type:
        return "mp4"
    return "bin"


def _safe_upload_path(filename: str) -> tuple[str, str]:
    """Validate and resolve a file inside UPLOAD_DIR; reject directories and traversal."""
    if not filename or filename in (".", "..") or os.path.basename(filename) != filename:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    upload_root = os.path.realpath(settings.UPLOAD_DIR)
    real_path = os.path.realpath(os.path.join(upload_root, filename))
    if not real_path.startswith(upload_root + os.sep) or not os.path.isfile(real_path):
        raise HTTPException(status_code=404, detail="Dosya bulunamadı")
    return filename, real_path


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    media_category: str = Form("general") # letters, chat, gallery, voice, document
):
    ext = _guess_extension(file)
    safe_category = "".join(ch for ch in media_category if ch.isalnum() or ch in "-_")[:24] or "general"

    unique_filename = f"{uuid.uuid4().hex}_{safe_category}.{ext}"
    dest_path = os.path.join(settings.UPLOAD_DIR, unique_filename)

    written = 0
    try:
        async with aiofiles.open(dest_path, "wb") as buffer:
            while content := await file.read(1024 * 1024): # 1MB chunks
                written += len(content)
                if written > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="Dosya çok büyük")
                await buffer.write(content)
    except Exception:
        if os.path.exists(dest_path):
            try:
                os.remove(dest_path)
            except OSError:
                pass
        raise
            
    media_url = f"/api/media/file/{unique_filename}"
    return {
        "success": True,
        "filename": unique_filename,
        "url": media_url,
        "content_type": file.content_type,
        "original_name": file.filename or unique_filename,
    }

@router.get("/file/{filename}", response_model=None)
async def get_file(filename: str):
    safe_filename, file_path = _safe_upload_path(filename)

    media_type, _ = mimetypes.guess_type(safe_filename)
    if not media_type:
        media_type = "application/octet-stream"

    # Never serve active web payloads (HTML/SVG/JS/XML) inline on our origin
    low_type = media_type.lower()
    is_active_payload = any(tok in low_type for tok in ("html", "svg", "xml", "javascript", "ecmascript"))
    if is_active_payload:
        media_type = "application/octet-stream"
        low_type = media_type

    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
        # Telefondaki WebView/Capacitor kabuğundan erişim için
        "Access-Control-Allow-Origin": "*",
        "X-Content-Type-Options": "nosniff",
    }
    allow_inline = (
        low_type in SAFE_INLINE_IMAGE_TYPES
        or low_type.startswith("video/")
        or low_type.startswith("audio/")
        or low_type == "application/pdf"
    )
    if not allow_inline:
        headers["Content-Disposition"] = f'attachment; filename="{safe_filename}"'

    # Sinema Salonu ve Android WebView videoyu PARÇA PARÇA (Range) ister.
    # Range desteklenmezse video ilerlemez, sarma çalışmaz, bazen siyah kalır.
    return FileResponse(
        file_path,
        media_type=media_type,
        headers=headers,
    )


@router.head("/file/{filename}")
async def head_file(filename: str):
    """Bazı oynatıcılar (Android/ExoPlayer) önce HEAD ile süre ve boyut sorar."""
    safe_filename, file_path = _safe_upload_path(filename)

    media_type, _ = mimetypes.guess_type(safe_filename)
    return FileResponse(
        file_path,
        media_type=media_type or "application/octet-stream",
        headers={
            "Accept-Ranges": "bytes",
            "Access-Control-Allow-Origin": "*",
        },
    )
