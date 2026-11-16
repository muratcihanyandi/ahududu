"""Anlık Fotoğraf (Snap) — 24 saat sonra kendiliğinden kaybolan kareler.

Herkes kendi "anını" paylaşır; partneri açtığında mühür kırılır ve
"Gördüm! ❤️" tepkisi anında WebSocket ile geri gider.
"""

from datetime import timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models import SnapStory, now_utc
from backend.app.schemas import SnapStoryCreate, SnapStoryResponse, SnapReaction
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/snaps", tags=["snaps"])

SNAP_LIFETIME = timedelta(hours=24)


def _snap_payload(snap: SnapStory) -> dict:
    return {
        "id": snap.id,
        "sender": snap.sender,
        "media_url": snap.media_url,
        "media_type": snap.media_type,
        "caption": snap.caption,
        "mood": snap.mood,
        "duration": snap.duration,
        "filter_name": snap.filter_name,
        "is_seen": snap.is_seen,
        "created_at": snap.created_at.isoformat() if snap.created_at else None,
        "expires_at": snap.expires_at.isoformat() if snap.expires_at else None,
    }


@router.get("", response_model=List[SnapStoryResponse])
async def list_snaps(
    sender: Optional[str] = Query(None, description="Sadece bir kişinin anları"),
    include_seen: bool = Query(True, description="Görülmüş anları da getir"),
    limit: int = Query(80, le=200),
    db: AsyncSession = Depends(get_db),
):
    now = now_utc()
    query = select(SnapStory).where(SnapStory.expires_at > now)
    if sender:
        query = query.where(SnapStory.sender == sender)
    if not include_seen:
        query = query.where(SnapStory.is_seen.is_(False))
    query = query.order_by(desc(SnapStory.created_at)).limit(limit)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/feed")
async def snap_feed(user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Ana ekran için iki kişinin son anları: çevrimiçi halka göstergesi."""
    now = now_utc()
    result = await db.execute(
        select(SnapStory)
        .where(SnapStory.expires_at > now)
        .order_by(desc(SnapStory.created_at))
        .limit(120)
    )
    snaps = result.scalars().all()
    partner = settings.partner_of(user_id)

    mine = [s for s in snaps if s.sender == user_id]
    partner_snaps = [s for s in snaps if s.sender == partner]

    return {
        "me": {
            "count": len(mine),
            "unseen_by_partner": len([s for s in mine if not s.is_seen]),
            "latest": _snap_payload(mine[0]) if mine else None,
        },
        "partner": {
            "count": len(partner_snaps),
            "unseen": len([s for s in partner_snaps if not s.is_seen]),
            "latest": _snap_payload(partner_snaps[0]) if partner_snaps else None,
        },
    }


@router.post("", response_model=SnapStoryResponse)
async def create_snap(payload: SnapStoryCreate, db: AsyncSession = Depends(get_db)):
    now = now_utc()
    snap = SnapStory(
        sender=payload.sender,
        media_url=payload.media_url,
        media_type=payload.media_type or "image",
        caption=payload.caption,
        mood=payload.mood or "mutlu",
        duration=payload.duration or 5,
        filter_name=payload.filter_name or "none",
        is_seen=False,
        created_at=now,
        expires_at=now + SNAP_LIFETIME,
    )
    db.add(snap)
    await db.commit()
    await db.refresh(snap)

    recipient = settings.partner_of(payload.sender)
    await ws_manager.send_to_user(recipient, {
        "type": "new_snap",
        "snap": _snap_payload(snap),
    })
    return snap


@router.post("/{snap_id}/seen", response_model=SnapStoryResponse)
async def mark_snap_seen(snap_id: int, db: AsyncSession = Depends(get_db)):
    snap = await db.get(SnapStory, snap_id)
    if not snap:
        raise HTTPException(status_code=404, detail="An bulunamadı")

    if not snap.is_seen:
        snap.is_seen = True
        snap.seen_at = now_utc()
        await db.commit()
        await db.refresh(snap)
        await ws_manager.send_to_user(snap.sender, {
            "type": "snap_seen",
            "snap_id": snap.id,
            "seen_by": settings.partner_of(snap.sender),
            "seen_at": snap.seen_at.isoformat(),
        })
    return snap


@router.post("/{snap_id}/react")
async def react_to_snap(snap_id: int, payload: SnapReaction, db: AsyncSession = Depends(get_db)):
    snap = await db.get(SnapStory, snap_id)
    if not snap:
        raise HTTPException(status_code=404, detail="An bulunamadı")

    await ws_manager.send_to_user(snap.sender, {
        "type": "snap_reaction",
        "snap_id": snap.id,
        "sender": payload.sender,
        "reaction": payload.reaction,
    })
    return {"success": True, "reaction": payload.reaction}


@router.delete("/{snap_id}")
async def delete_snap(snap_id: int, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    snap = await db.get(SnapStory, snap_id)
    if not snap:
        raise HTTPException(status_code=404, detail="An bulunamadı")
    if snap.sender != user_id:
        raise HTTPException(status_code=403, detail="Sadece kendi anını silebilirsin")

    await db.delete(snap)
    await db.commit()
    await ws_manager.broadcast({"type": "snap_deleted", "snap_id": snap_id})
    return {"success": True}
