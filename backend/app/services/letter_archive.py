"""Mektup Arşivi — mektuplar asla kaybolmasın.

Neden var?
----------
Mektuplar veritabanındaki normal kayıtlar. Bir "örnek program kur" veya bir
temizlik işlemi yanlış tabloya dokunursa, mektuplar geri dönüşü olmayan
şekilde silinebiliyordu. Artık her mektup:

  1. Silinmeden ÖNCE diske JSON yedeği alınır (`letters_backup/`),
  2. Silinen mektuplar "çöp kutusunda" tutulur (soft-delete),
  3. Uygulamadan silme isteği gelirse yalnızca "gizlenir" (arşivde kalır).

Böylece kullanıcı ne yaparsa yapsın mektup geri getirilebilir.
"""

import asyncio
import json
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from backend.app.config import settings

logger = logging.getLogger("ahududu.letters")

BACKUP_DIR_NAME = "letters_backup"


def backup_dir() -> str:
    path = os.path.join(settings.UPLOAD_DIR, BACKUP_DIR_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def backup_letter(letter: dict, reason: str = "delete") -> Optional[str]:
    """Bir mektubu diske atomik olarak JSON yazar. Dosya yolu döner (hata olursa None)."""
    try:
        folder = backup_dir()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%f")
        suffix = uuid.uuid4().hex[:6]
        letter_id = letter.get("id", "x")
        filename = f"letter-{letter_id}-{stamp}-{suffix}-{reason}.json"
        path = os.path.join(folder, filename)
        tmp_path = f"{path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(letter, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
        logger.info("Mektup yedeklendi: %s", filename)
        return path
    except Exception as exc:  # noqa: BLE001 - yedek hatası ana işlemi bozmasın
        logger.warning("Mektup yedeklenemedi: %s", exc)
        return None


def letter_to_dict(letter) -> dict:
    return {
        "id": getattr(letter, "id", None),
        "sender": getattr(letter, "sender", None),
        "title": getattr(letter, "title", None),
        "content_text": getattr(letter, "content_text", None),
        "canvas_data": getattr(letter, "canvas_data", None),
        "canvas_image_url": getattr(letter, "canvas_image_url", None),
        "stationery_theme": getattr(letter, "stationery_theme", None),
        "is_sealed": getattr(letter, "is_sealed", None),
        "is_opened": getattr(letter, "is_opened", None),
        "opened_at": (
            letter.opened_at.isoformat() if getattr(letter, "opened_at", None) else None
        ),
        "created_at": (
            letter.created_at.isoformat() if getattr(letter, "created_at", None) else None
        ),
    }


def _backfill_sync(items: list[dict]) -> int:
    folder = backup_dir()
    try:
        existing_ids: set[str] = set()
        for name in os.listdir(folder):
            if name.startswith("letter-"):
                parts = name.split("-", 2)
                if len(parts) >= 2:
                    existing_ids.add(parts[1])
    except OSError:
        return 0

    created = 0
    for item in items:
        lid = str(item.get("id"))
        if lid in existing_ids:
            continue
        if backup_letter(item, reason="archive"):
            existing_ids.add(lid)
            created += 1
    return created


async def backfill_letter_backups(letters) -> int:
    """Daha önce yedeği alınmamış mektuplar için bir kez yedek üretir."""
    items = [letter_to_dict(letter) for letter in letters]
    created = await asyncio.to_thread(_backfill_sync, items)
    if created:
        logger.info("Mektup arşivi kuruldu: %d mektup yedeklendi.", created)
    return created
