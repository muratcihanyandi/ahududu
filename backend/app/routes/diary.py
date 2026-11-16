"""Günlük — ikimizin ortak anı defteri.

Kendine ait, sadece sevgilinin okuyamayacağı kilitli günlük notları da
desteklenir (is_locked). Sayfa flip animasyonu istemcide yapılır.
"""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.database import get_db
from backend.app.models import DiaryEntry, now_utc
from backend.app.schemas import DiaryEntryCreate, DiaryEntryUpdate, DiaryEntryResponse
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/diary", tags=["diary"])


def _payload(entry: DiaryEntry, viewer: Optional[str] = None) -> dict:
    """Kilitli bir günlük, yazan dışında kimseye açılmaz."""
    if entry.is_locked and viewer and viewer != entry.author:
        return {
            "id": entry.id,
            "author": entry.author,
            "title": "Kilitli bir günlük 🔒",
            "content": None,
            "mood": entry.mood,
            "mood_score": entry.mood_score,
            "weather": entry.weather,
            "entry_date": entry.entry_date,
            "photo_url": None,
            "is_locked": True,
            "created_at": entry.created_at.isoformat() if entry.created_at else None,
            "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
        }
    return {
        "id": entry.id,
        "author": entry.author,
        "title": entry.title,
        "content": entry.content,
        "mood": entry.mood,
        "mood_score": entry.mood_score,
        "weather": entry.weather,
        "entry_date": entry.entry_date,
        "photo_url": entry.photo_url,
        "is_locked": entry.is_locked,
        "created_at": entry.created_at.isoformat() if entry.created_at else None,
        "updated_at": entry.updated_at.isoformat() if entry.updated_at else None,
    }


@router.get("", response_model=List[DiaryEntryResponse])
async def list_entries(
    viewer: Optional[str] = Query(None),
    author: Optional[str] = None,
    month: Optional[str] = Query(None, description="YYYY-MM"),
    limit: int = Query(200, le=500),
    db: AsyncSession = Depends(get_db),
):
    query = select(DiaryEntry)
    if author:
        query = query.where(DiaryEntry.author == author)
    if month:
        query = query.where(DiaryEntry.entry_date.like(f"{month}%"))
    query = query.order_by(desc(DiaryEntry.entry_date), desc(DiaryEntry.created_at)).limit(limit)
    result = await db.execute(query)
    entries = result.scalars().all()
    return [_payload(e, viewer) for e in entries]


@router.get("/stats")
async def diary_stats(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(DiaryEntry))
    entries = result.scalars().all()
    if not entries:
        return {
            "total": 0,
            "streak": 0,
            "authors": {},
            "moods": {},
            "first_date": None,
            "last_date": None,
        }

    dates = sorted({e.entry_date for e in entries}, reverse=True)
    authors: dict = {}
    moods: dict = {}
    for e in entries:
        authors[e.author] = authors.get(e.author, 0) + 1
        moods[e.mood or "none"] = moods.get(e.mood or "none", 0) + 1

    # Ardışık gün serisi: bugünden (veya dünden) geriye doğru kesintisiz günler.
    streak = 0
    try:
        today = date.today()
        present = {date.fromisoformat(d) for d in dates}
        cursor = today if today in present else today.fromordinal(today.toordinal() - 1)
        while cursor in present:
            streak += 1
            cursor = cursor.fromordinal(cursor.toordinal() - 1)
    except ValueError:
        streak = 0

    return {
        "total": len(entries),
        "streak": streak,
        "authors": authors,
        "moods": moods,
        "first_date": dates[-1],
        "last_date": dates[0],
        "total_days": len(dates),
    }


@router.post("", response_model=DiaryEntryResponse)
async def create_entry(payload: DiaryEntryCreate, db: AsyncSession = Depends(get_db)):
    entry = DiaryEntry(
        author=payload.author,
        title=payload.title.strip() or "Bugün...",
        content=payload.content,
        mood=payload.mood or "mutlu",
        mood_score=max(1, min(5, payload.mood_score or 5)),
        weather=payload.weather or "none",
        entry_date=payload.entry_date or date.today().isoformat(),
        photo_url=payload.photo_url,
        is_locked=bool(payload.is_locked),
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)

    await ws_manager.broadcast({
        "type": "new_diary_entry",
        "entry": _payload(entry),
    })
    return _payload(entry)


@router.get("/{entry_id}", response_model=DiaryEntryResponse)
async def get_entry(entry_id: int, viewer: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    entry = await db.get(DiaryEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Günlük bulunamadı")
    if entry.is_locked and viewer and viewer != entry.author:
        raise HTTPException(status_code=403, detail="Bu günlük kilitli 🔒")
    return _payload(entry, viewer)


@router.put("/{entry_id}", response_model=DiaryEntryResponse)
async def update_entry(entry_id: int, payload: DiaryEntryUpdate, db: AsyncSession = Depends(get_db)):
    entry = await db.get(DiaryEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Günlük bulunamadı")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is not None:
            setattr(entry, key, value)
    entry.updated_at = now_utc()
    await db.commit()
    await db.refresh(entry)

    await ws_manager.broadcast({
        "type": "diary_entry_updated",
        "entry": _payload(entry),
    })
    return _payload(entry)


@router.delete("/{entry_id}")
async def delete_entry(entry_id: int, db: AsyncSession = Depends(get_db)):
    entry = await db.get(DiaryEntry, entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Günlük bulunamadı")
    await db.delete(entry)
    await db.commit()
    await ws_manager.broadcast({"type": "diary_entry_deleted", "entry_id": entry_id})
    return {"success": True}
