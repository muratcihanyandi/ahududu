from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List, Optional
from backend.app.database import get_db
from backend.app.models import SharedNote, now_utc
from backend.app.schemas import SharedNoteCreate, SharedNoteUpdate, SharedNoteResponse
from backend.app.config import settings
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/notes", tags=["notes"])

@router.get("", response_model=List[SharedNoteResponse])
async def list_notes(
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    query = select(SharedNote)
    if category:
        query = query.where(SharedNote.category == category)
    query = query.order_by(desc(SharedNote.pinned), desc(SharedNote.created_at))
    result = await db.execute(query)
    return result.scalars().all()

@router.post("", response_model=SharedNoteResponse)
async def create_note(payload: SharedNoteCreate, db: AsyncSession = Depends(get_db)):
    note = SharedNote(
        creator=payload.creator,
        title=payload.title,
        content=payload.content,
        category=payload.category,
        pinned=payload.pinned,
        is_completed=False
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    
    # Broadcast to partner
    recipient = settings.partner_of(payload.creator)
    await ws_manager.send_to_user(recipient, {
        "type": "new_note",
        "note": {
            "id": note.id,
            "creator": note.creator,
            "title": note.title,
            "category": note.category
        }
    })
    return note

@router.put("/{note_id}", response_model=SharedNoteResponse)
async def update_note(note_id: int, payload: SharedNoteUpdate, db: AsyncSession = Depends(get_db)):
    note = await db.get(SharedNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Not bulunamadı")
    
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        if value is None and key != "content":
            continue
        setattr(note, key, value)
    note.updated_at = now_utc()
    await db.commit()
    await db.refresh(note)
    
    # Broadcast update to both
    await ws_manager.broadcast({
        "type": "note_updated",
        "note": {
            "id": note.id,
            "title": note.title,
            "is_completed": note.is_completed,
            "pinned": note.pinned,
            "category": note.category
        }
    })
    return note

@router.delete("/{note_id}")
async def delete_note(note_id: int, db: AsyncSession = Depends(get_db)):
    note = await db.get(SharedNote, note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Not bulunamadı")
    await db.delete(note)
    await db.commit()
    await ws_manager.broadcast({
        "type": "note_deleted",
        "note_id": note_id
    })
    return {"success": True}
