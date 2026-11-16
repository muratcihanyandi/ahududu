from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from typing import List
from backend.app.database import get_db
from backend.app.models import ChatMessage
from backend.app.schemas import ChatMessageCreate, ChatMessageResponse
from backend.app.config import settings
from backend.app.websocket_manager import ws_manager

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
        duration=payload.duration or 0
    )
    db.add(msg)
    await db.commit()
    await db.refresh(msg)
    
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
            "created_at": msg.created_at.isoformat()
        }
    })
    return msg
