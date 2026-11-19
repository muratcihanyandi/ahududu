"""Mektuplar — kalpten yazılan mektup kutusu.

Mektuplar ASLA kaybolmaz: silme işlemi mektubu arşive taşır (soft delete) ve
her mektup silinmeden önce diske JSON yedeği yazılır. Arayüzdeki "arşiv"
sekmesi silinmiş mektupları da gösterip geri getirmeye izin verir.
"""

import asyncio
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from backend.app.database import get_db
from backend.app.models import LoveLetter, now_utc
from backend.app.schemas import LoveLetterCreate, LoveLetterResponse
from backend.app.config import settings
from backend.app.websocket_manager import ws_manager
from backend.app.services import letter_archive

logger = logging.getLogger("ahududu.letters")

router = APIRouter(prefix="/api/letters", tags=["letters"])


@router.get("", response_model=List[LoveLetterResponse])
async def list_letters(
    include_deleted: bool = Query(
        True,
        description="Arşivdeki (silinmiş) mektupları da getir. Varsayılan olarak tümü döner.",
    ),
    db: AsyncSession = Depends(get_db),
):
    """Mektuplar — varsayılan olarak arşivdekiler dahil hepsi döner."""
    query = select(LoveLetter)
    if not include_deleted:
        query = query.where(LoveLetter.is_deleted.is_not(True))
    query = query.order_by(desc(LoveLetter.created_at))
    result = await db.execute(query)
    return result.scalars().all()


@router.post("", response_model=LoveLetterResponse)
async def create_letter(payload: LoveLetterCreate, db: AsyncSession = Depends(get_db)):
    letter = LoveLetter(
        sender=payload.sender,
        title=payload.title or "Sana Özel Bir Mektup 💌",
        content_text=payload.content_text,
        canvas_data=payload.canvas_data,
        canvas_image_url=payload.canvas_image_url,
        stationery_theme=payload.stationery_theme or "vintage_parchment",
        is_sealed=True,
        is_opened=False
    )
    db.add(letter)
    await db.commit()
    await db.refresh(letter)

    # Yeni mektup diske de yedeklenir (kalıcı arşiv).
    await asyncio.to_thread(letter_archive.backup_letter, letter_archive.letter_to_dict(letter), "created")

    # Send real-time notification to recipient
    recipient = settings.partner_of(payload.sender)
    await ws_manager.send_to_user(recipient, {
        "type": "new_letter",
        "letter": {
            "id": letter.id,
            "sender": letter.sender,
            "title": letter.title,
            "stationery_theme": letter.stationery_theme,
            "created_at": letter.created_at.isoformat()
        }
    })
    return letter


@router.post("/restore-all")
async def restore_all_letters(db: AsyncSession = Depends(get_db)):
    """Arşivdeki bütün mektupları kutuya geri getir.

    Eski sürümlerde mektup "silindiğinde" kayıt tamamen yok oluyordu. Bu uç,
    o dönemden kalan gizlenmiş mektupları tek dokunuşla geri getirir.
    """
    result = await db.execute(select(LoveLetter))
    letters = result.scalars().all()
    restored = 0
    for letter in letters:
        if getattr(letter, "is_deleted", False):
            _setattr_safe(letter, "is_deleted", False)
            _setattr_safe(letter, "deleted_at", None)
            restored += 1
    if restored:
        await db.commit()
        await ws_manager.broadcast({"type": "letters_updated"})
    return {"success": True, "restored": restored}


@router.get("/archive")
async def letter_archive_report(db: AsyncSession = Depends(get_db)):
    """Mektup arşivinin özeti."""
    result = await db.execute(select(LoveLetter))
    letters = result.scalars().all()
    deleted = [l for l in letters if getattr(l, "is_deleted", False)]
    return {
        "total": len(letters),
        "active": len(letters) - len(deleted),
        "archived": len(deleted),
    }


@router.get("/{letter_id}", response_model=LoveLetterResponse)
async def get_letter(letter_id: int, db: AsyncSession = Depends(get_db)):
    letter = await db.get(LoveLetter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Mektup bulunamadı")
    return letter


@router.post("/{letter_id}/open", response_model=LoveLetterResponse)
async def open_letter(
    letter_id: int,
    viewer: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    letter = await db.get(LoveLetter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Mektup bulunamadı")

    if viewer and viewer == letter.sender:
        return letter

    if not letter.is_opened:
        letter.is_opened = True
        letter.is_sealed = False
        letter.opened_at = now_utc()
        await db.commit()
        await db.refresh(letter)
        
        # Notify sender that letter was opened
        await ws_manager.send_to_user(letter.sender, {
            "type": "letter_opened_by_partner",
            "letter_id": letter.id,
            "title": letter.title,
            "opened_at": letter.opened_at.isoformat()
        })
    return letter


@router.delete("/{letter_id}")
async def delete_letter(letter_id: int, db: AsyncSession = Depends(get_db)):
    """Mektubu kutuya kaldır — KAYIT SİLİNMEZ, arşive taşınır.

    Mektup geri getirilebilir olması için `is_deleted` işaretlenir; ayrıca
    silinmeden önce diske JSON yedeği alınır. Arşiv sekmesinden geri getirilir.
    """
    letter = await db.get(LoveLetter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Mektup bulunamadı")

    await asyncio.to_thread(letter_archive.backup_letter, letter_archive.letter_to_dict(letter), "deleted")
    _setattr_safe(letter, "is_deleted", True)
    _setattr_safe(letter, "deleted_at", now_utc())
    await db.commit()
    await db.refresh(letter)
    await ws_manager.broadcast({"type": "letters_updated"})
    return {"success": True, "archived": True}


@router.post("/{letter_id}/restore", response_model=LoveLetterResponse)
async def restore_letter(letter_id: int, db: AsyncSession = Depends(get_db)):
    """Arşivdeki mektubu geri getir."""
    letter = await db.get(LoveLetter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Mektup bulunamadı")
    _setattr_safe(letter, "is_deleted", False)
    _setattr_safe(letter, "deleted_at", None)
    await db.commit()
    await db.refresh(letter)
    await ws_manager.broadcast({"type": "letters_updated"})
    return letter


def _setattr_safe(obj, name: str, value) -> None:
    """Kolon henüz eklenmemiş olsa bile patlamasın."""
    try:
        setattr(obj, name, value)
    except Exception:  # noqa: BLE001
        logger.debug("Mektup alanı yazılamadı: %s", name)
