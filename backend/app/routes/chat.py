import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List
from backend.app.database import get_db
from backend.app.models import ChatMessage, UserProfile
from backend.app.schemas import ChatMessageCreate, ChatMessageResponse
from backend.app.config import settings
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("ahududu.chat")

router = APIRouter(prefix="/api/chat", tags=["chat"])

@router.get("/messages", response_model=List[ChatMessageResponse])
async def get_messages(
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(ChatMessage)
        .order_by(desc(ChatMessage.created_at))
        .offset(offset)
        .limit(limit)
    )
    messages = result.scalars().all()
    return list(reversed(messages))

@router.post("/messages", response_model=ChatMessageResponse)
async def send_message(payload: ChatMessageCreate, db: AsyncSession = Depends(get_db)):
    msg = ChatMessage(
        sender=payload.sender,
        message_type=payload.message_type,
        content=payload.content,
        media_url=payload.media_url,
        duration=payload.duration or 0,
        latitude=payload.latitude,
        longitude=payload.longitude,
        place_name=payload.place_name,
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)

    # Konum mesajıysa partner'in "Neredeyiz?" bilgisi de güncellenir:
    # biri haritada açıkça konum paylaştıysa bu, en son bilinen konumdur.
    if (
        msg.message_type == "konum"
        and msg.latitude is not None
        and msg.longitude is not None
    ):
        try:
            profile = await db.get(UserProfile, payload.sender)
            if profile is not None:
                profile.current_lat = msg.latitude
                profile.current_lon = msg.longitude
                if msg.place_name:
                    profile.place_name = msg.place_name
                await db.commit()
        except Exception as e:  # noqa: BLE001 - konum güncellemesi mesajı engellemesin
            logger.warning("Konum profili güncellenemedi: %s", e)
            await db.rollback()

    # Broadcast to partner
    recipient = settings.partner_of(payload.sender)
    await ws_manager.send_to_user(recipient, {
        "type": "new_chat_message",
        "message": {
            "id": msg.id,
            "sender": msg.sender,
            "message_type": msg.message_type,
            "content": msg.content,
            "media_url": msg.media_url,
            "duration": msg.duration,
            "latitude": msg.latitude,
            "longitude": msg.longitude,
            "place_name": msg.place_name,
            "created_at": msg.created_at.isoformat()
        }
    })
    return msg
