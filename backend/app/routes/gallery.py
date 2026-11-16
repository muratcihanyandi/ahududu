from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List, Optional
from backend.app.database import get_db
from backend.app.models import GalleryItem, now_utc
from backend.app.schemas import GalleryItemCreate, GalleryItemResponse
from backend.app.config import settings
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/gallery", tags=["gallery"])

@router.get("", response_model=List[GalleryItemResponse])
async def list_gallery(
    album: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(GalleryItem)
    if album:
        query = query.where(GalleryItem.album == album)
    query = query.order_by(desc(GalleryItem.created_at))
    result = await db.execute(query)
    return result.scalars().all()

@router.post("", response_model=GalleryItemResponse)
async def add_gallery_item(payload: GalleryItemCreate, db: AsyncSession = Depends(get_db)):
    item = GalleryItem(
        uploader=payload.uploader,
        title=payload.title,
        caption=payload.caption,
        media_type=payload.media_type,
        media_url=payload.media_url,
        thumbnail_url=payload.thumbnail_url or payload.media_url,
        album=payload.album or "Bizim Anılarımız"
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    
    # Broadcast to partner
    recipient = settings.partner_of(payload.uploader)
    await ws_manager.send_to_user(recipient, {
        "type": "new_gallery_item",
        "item": {
            "id": item.id,
            "uploader": item.uploader,
            "title": item.title,
            "caption": item.caption,
            "media_type": item.media_type,
            "media_url": item.media_url,
            "album": item.album,
            "created_at": item.created_at.isoformat()
        }
    })
    return item

@router.delete("/{item_id}")
async def delete_gallery_item(item_id: int, db: AsyncSession = Depends(get_db)):
    item = await db.get(GalleryItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Öğe bulunamadı")
    await db.delete(item)
    await db.commit()
    return {"success": True}
