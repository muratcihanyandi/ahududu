import logging
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, func
from typing import Dict, Iterable, List, Optional
from backend.app.database import get_db
from backend.app.models import ChatMessage, ChatPollVote, UserProfile
from backend.app.schemas import ChatMessageCreate, ChatMessageResponse, PollVoteRequest
from backend.app.config import settings
from backend.app.websocket_manager import ws_manager

logger = logging.getLogger("ahududu.chat")

router = APIRouter(prefix="/api/chat", tags=["chat"])

# Anket en fazla 6 seçenek taşır (arayüzde de 6 sınırı var).
MAX_POLL_OPTIONS = 6


def poll_option_count(content: Optional[str]) -> int:
    """Anket mesajının seçenek sayısı (1. satır soru, kalanı seçenek)."""
    if not content:
        return 0
    options = [line.strip() for line in content.split("\n")[1:] if line.strip()]
    return min(len(options), MAX_POLL_OPTIONS)


def build_poll_state(
    content: Optional[str], rows: Iterable[ChatPollVote]
) -> Dict[str, object]:
    """Oyları arayüzün isteyeceği biçime çevirir."""
    option_count = poll_option_count(content)
    votes = [0] * option_count
    latest_by_voter: Dict[str, ChatPollVote] = {}
    for row in rows:
        voter_key = str(row.voter)
        prev = latest_by_voter.get(voter_key)
        if prev is None or (row.id or 0) >= (prev.id or 0):
            latest_by_voter[voter_key] = row

    voters: Dict[str, int] = {}
    for voter_key, row in latest_by_voter.items():
        if not isinstance(row.option_index, int):
            continue
        if 0 <= row.option_index < option_count:
            votes[row.option_index] += 1
        # Oy veren kişi her zaman görünsün (seçenek silinmiş olsa bile).
        voters[voter_key] = int(row.option_index)
    return {"votes": votes, "voters": voters}


async def votes_for_messages(
    db: AsyncSession, message_ids: List[int]
) -> Dict[int, List[ChatPollVote]]:
    """Verilen anket mesajlarının oylarını tek sorguda getirir."""
    if not message_ids:
        return {}
    result = await db.execute(
        select(ChatPollVote).where(ChatPollVote.message_id.in_(message_ids))
    )
    grouped: Dict[int, List[ChatPollVote]] = defaultdict(list)
    for row in result.scalars().all():
        grouped[row.message_id].append(row)
    return grouped


def message_payload(msg: ChatMessage, poll_state: Optional[dict] = None) -> dict:
    """WebSocket'te gönderilecek mesaj gövdesi."""
    payload = {
        "id": msg.id,
        "sender": msg.sender,
        "message_type": msg.message_type,
        "content": msg.content,
        "media_url": msg.media_url,
        "duration": msg.duration,
        "latitude": msg.latitude,
        "longitude": msg.longitude,
        "place_name": msg.place_name,
        "created_at": msg.created_at.isoformat() if msg.created_at else None,
    }
    if poll_state:
        payload.update(poll_state)
    return payload


@router.get("/messages", response_model=List[ChatMessageResponse])
async def get_messages(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    before_id: Optional[int] = Query(None, gt=0),
    db: AsyncSession = Depends(get_db)
):
    query = select(ChatMessage)
    if before_id is not None:
        query = query.where(ChatMessage.id < before_id).order_by(desc(ChatMessage.id)).limit(limit)
    else:
        query = query.order_by(desc(ChatMessage.id)).offset(offset).limit(limit)
    result = await db.execute(query)
    messages = list(reversed(result.scalars().all()))

    # Anket mesajları oylarıyla birlikte gelsin: uygulama açıldığında oyların
    # iki tarafta da doğru görünmesi için oylar mesajla birlikte yüklenir.
    poll_ids = [m.id for m in messages if m.message_type == "anket"]
    grouped = await votes_for_messages(db, poll_ids)

    response: List[ChatMessageResponse] = []
    for msg in messages:
        item = ChatMessageResponse.model_validate(msg)
        if msg.message_type == "anket":
            state = build_poll_state(msg.content, grouped.get(msg.id, []))
            item.votes = state["votes"]  # type: ignore[assignment]
            item.voters = state["voters"]  # type: ignore[assignment]
        response.append(item)
    return response


@router.get("/count")
async def get_message_count(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(func.count(ChatMessage.id)))
    total = int(result.scalar_one() or 0)
    return {"total": total}


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

    poll_state = None
    if msg.message_type == "anket":
        poll_state = build_poll_state(msg.content, [])

    response = ChatMessageResponse.model_validate(msg)
    if poll_state is not None:
        response.votes = poll_state["votes"]  # type: ignore[assignment]
        response.voters = poll_state["voters"]  # type: ignore[assignment]
    ws_payload = message_payload(msg, poll_state)

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
        "message": ws_payload,
    })
    return response


@router.post("/messages/{message_id}/vote")
async def vote_poll(
    message_id: int,
    payload: PollVoteRequest,
    db: AsyncSession = Depends(get_db),
):
    """Anket oyu ver (ya da mevcut oyu değiştir).

    Oylar sunucuda tutulur, böylece karşı taraf da aynı işareti görür; oy verildiği
    anda iki tarafa da WebSocket olayı (`poll_vote`) gider.
    """
    voter = (payload.voter or "").strip()
    if voter not in settings.USER_IDS:
        raise HTTPException(status_code=400, detail="Geçersiz kullanıcı")

    msg = await db.get(ChatMessage, message_id)
    if msg is None:
        raise HTTPException(status_code=404, detail="Anket bulunamadı")
    if msg.message_type != "anket":
        raise HTTPException(status_code=400, detail="Bu mesaj anket değil")

    option_count = poll_option_count(msg.content)
    if not (0 <= payload.option_index < option_count):
        raise HTTPException(status_code=400, detail="Geçersiz seçenek")

    result = await db.execute(
        select(ChatPollVote).where(
            ChatPollVote.message_id == message_id,
            ChatPollVote.voter == voter,
        )
    )
    existing = result.scalars().first()
    if existing is None:
        existing = ChatPollVote(
            message_id=message_id,
            voter=voter,
            option_index=payload.option_index,
        )
        db.add(existing)
    else:
        existing.option_index = payload.option_index
    await db.commit()

    grouped = await votes_for_messages(db, [message_id])
    state = build_poll_state(msg.content, grouped.get(message_id, []))

    # İki tarafa da aynı olay: veren taraf da başka cihazdan güncel kalsın.
    for user_id in settings.USER_IDS:
        await ws_manager.send_to_user(user_id, {
            "type": "poll_vote",
            "message_id": message_id,
            "voter": voter,
            "option_index": payload.option_index,
            "votes": state["votes"],
            "voters": state["voters"],
        })

    return {
        "success": True,
        "message_id": message_id,
        "voter": voter,
        "option_index": payload.option_index,
        "votes": state["votes"],
        "voters": state["voters"],
    }
