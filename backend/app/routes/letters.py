from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List
from backend.app.database import get_db
from backend.app.models import LoveLetter, now_utc
from backend.app.schemas import LoveLetterCreate, LoveLetterResponse
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/letters", tags=["letters"])

@router.get("", response_model=List[LoveLetterResponse])
async def list_letters(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(LoveLetter).order_by(desc(LoveLetter.created_at)))
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
    
    # Send real-time notification to recipient
    recipient = "sevgilim" if payload.sender == "murat" else "murat"
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

@router.get("/{letter_id}", response_model=LoveLetterResponse)
async def get_letter(letter_id: int, db: AsyncSession = Depends(get_db)):
    letter = await db.get(LoveLetter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Mektup bulunamadı")
    return letter

@router.post("/{letter_id}/open", response_model=LoveLetterResponse)
async def open_letter(letter_id: int, db: AsyncSession = Depends(get_db)):
    letter = await db.get(LoveLetter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Mektup bulunamadı")
    
    if not letter.is_opened:
        letter.is_opened = True
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
    letter = await db.get(LoveLetter, letter_id)
    if not letter:
        raise HTTPException(status_code=404, detail="Mektup bulunamadı")
    await db.delete(letter)
    await db.commit()
    return {"success": True}
