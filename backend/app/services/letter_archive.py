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

import json
import logging
import os
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import inspect, text

from backend.app.config import settings

logger = logging.getLogger("ahududu.letters")

BACKUP_DIR_NAME = "letters_backup"


def backup_dir() -> str:
    path = os.path.join(settings.UPLOAD_DIR, BACKUP_DIR_NAME)
    os.makedirs(path, exist_ok=True)
    return path


def backup_letter(letter: dict, reason: str = "delete") -> Optional[str]:
    """Bir mektubu diske JSON olarak yazar. Dosya yolu döner (hata olursa None)."""
    try:
        folder = backup_dir()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
        letter_id = letter.get("id", "x")
        filename = f"letter-{letter_id}-{stamp}-{reason}.json"
        path = os.path.join(folder, filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(letter, f, ensure_ascii=False, indent=2)
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


async def ensure_archive_columns(engine) -> None:
    """`love_letters` tablosuna arşiv kolonlarını ekler (mevcut kurulum için).

    `create_all` var olan tablolara yeni kolon eklemez; bu yüzden burada
    idempotent bir "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" uyguluyoruz.
    """
    statements = [
        "ALTER TABLE love_letters ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE",
        "ALTER TABLE love_letters ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP WITH TIME ZONE",
    ]
    try:
        async with engine.begin() as conn:
            columns = await conn.run_sync(
                lambda sync_conn: {
                    col["name"] for col in inspect(sync_conn).get_columns("love_letters")
                }
            )
            for statement in statements:
                column = statement.split("ADD COLUMN IF NOT EXISTS ")[1].split()[0]
                if column in columns:
                    continue
                await conn.execute(text(statement))
                logger.info("love_letters.%s kolonu eklendi.", column)
    except Exception as exc:  # noqa: BLE001 - arşiv kolonu yoksa da uygulama çalışsın
        logger.warning("Mektup arşiv kolonları hazırlanamadı: %s", exc)


async def backfill_letter_backups(letters) -> int:
    """Daha önce yedeği alınmamış mektuplar için bir kez yedek üretir."""
    folder = backup_dir()
    existing = set()
    try:
        existing = set(os.listdir(folder))
    except OSError:
        return 0

    created = 0
    for letter in letters:
        prefix = f"letter-{getattr(letter, 'id', None)}-"
        if any(name.startswith(prefix) for name in existing):
            continue
        if backup_letter(letter_to_dict(letter), reason="archive"):
            created += 1
    if created:
        logger.info("Mektup arşivi kuruldu: %d mektup yedeklendi.", created)
    return created
