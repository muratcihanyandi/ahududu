"""Sinema Takvimi — o ayın yayın programı ("beyaz perde").

Akış
----
1. Takvime film eklenir (başlık, afiş, seans saati, video linki/sitesi).
2. Murat ve Selin film için "bilet alır" (gerçek bilet değil, ortak rezervasyon).
3. Seans saati gelince salon açılır; iki telefon senkron izler.

OpenClaw entegrasyonu
---------------------
`POST /api/cinema/calendar/import` ile bütün ay tek istekte ayarlanabilir.
Ayrıca `POST /api/cinema/calendar/auto-schedule` ile film başlıkları verilip
video kaynağı otomatik bulunabilir.
"""

import hashlib
import re
from datetime import date, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models import CinemaRoom, CinemaShowtime, now_utc
from backend.app.schemas import (
    ShowtimeCreate,
    ShowtimeUpdate,
    ShowtimeResponse,
    TicketRequest,
    CalendarImport,
)
from backend.app.routes.cinema import resolve_video
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/cinema/calendar", tags=["cinema-calendar"])

DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_PATTERN = re.compile(r"^\d{2}:\d{2}$")


def _ticket_code(showtime: CinemaShowtime) -> str:
    """Bilet kodu: film + tarih + salondan türeyen sabit, okunabilir kod."""
    seed = f"{showtime.id}:{showtime.show_date}:{showtime.show_time}:{showtime.hall}"
    digest = hashlib.sha1(seed.encode("utf-8")).hexdigest()[:6].upper()
    return f"AHU-{digest}"


def _booked_list(value: Optional[str]) -> List[str]:
    return [v.strip() for v in (value or "").split(",") if v.strip()]


def _start_at(show: CinemaShowtime) -> Optional[datetime]:
    """Seansın gerçek başlangıç anı (yerel saat, naive datetime ile karşılaştırılır)."""
    try:
        hour, minute = (int(part) for part in show.show_time.split(":"))
        day = date.fromisoformat(show.show_date)
        return datetime(day.year, day.month, day.day, hour, minute)
    except (ValueError, AttributeError):
        return None


def _payload(show: CinemaShowtime, viewer: Optional[str] = None) -> dict:
    booked = _booked_list(show.booked_by)
    start = _start_at(show)
    now_local = datetime.now()
    starts_in_minutes = None
    if start:
        starts_in_minutes = int((start - now_local).total_seconds() // 60)

    return {
        "id": show.id,
        "title": show.title,
        "description": show.description,
        "genre": show.genre or "film",
        "poster_url": show.poster_url,
        "video_url": show.video_url,
        "embed_url": show.embed_url,
        "source": show.source,
        "duration_minutes": show.duration_minutes or 0,
        "show_date": show.show_date,
        "show_time": show.show_time,
        "hall": show.hall,
        "seats": show.seats or 2,
        "booked_by": ",".join(booked),
        "booked_count": len(booked),
        "my_ticket": bool(viewer and viewer in booked),
        "partner_ticket": bool(
            viewer and settings.partner_of(viewer) in booked
        ),
        "ticket_code": show.ticket_code,
        "is_published": bool(show.is_published),
        "is_cancelled": bool(show.is_cancelled),
        "created_by": show.created_by,
        "updated_by": show.updated_by,
        "created_at": show.created_at.isoformat() if show.created_at else None,
        "updated_at": show.updated_at.isoformat() if show.updated_at else None,
        "room_id": show.room_id,
        "started_at": show.started_at.isoformat() if show.started_at else None,
        "starts_in_minutes": starts_in_minutes,
        "is_tonight": bool(start and start.date() == now_local.date()),
    }


def _normalize_date(value: str) -> str:
    value = (value or "").strip()
    if not DATE_PATTERN.match(value):
        raise HTTPException(status_code=400, detail="Tarih YYYY-AA-GG biçiminde olmalı")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Geçersiz tarih") from exc
    return value


def _normalize_time(value: Optional[str]) -> str:
    value = (value or "21:00").strip()
    if not TIME_PATTERN.match(value):
        value = f"{int(value):02d}:00" if value.isdigit() else "21:00"
    hour, minute = (int(part) for part in value.split(":"))
    if hour > 23 or minute > 59:
        raise HTTPException(status_code=400, detail="Geçersiz seans saati")
    return f"{hour:02d}:{minute:02d}"


# --------------------------------------------------------------------------
# Okuma
# --------------------------------------------------------------------------

@router.get("", response_model=None)
async def list_showtimes(
    month: Optional[str] = Query(None, description="YYYY-MM"),
    viewer: Optional[str] = None,
    include_cancelled: bool = False,
    db: AsyncSession = Depends(get_db),
):
    query = select(CinemaShowtime)
    if month:
        query = query.where(CinemaShowtime.show_date.like(f"{month}%"))
    if not include_cancelled:
        query = query.where(CinemaShowtime.is_cancelled.is_(False))
    query = query.order_by(CinemaShowtime.show_date, CinemaShowtime.show_time)
    result = await db.execute(query)
    return [_payload(s, viewer) for s in result.scalars().all()]


@router.get("/tonight", response_model=None)
async def tonight(viewer: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Bu akşamki seans (ana ekran kartı için)."""
    today = date.today().isoformat()
    result = await db.execute(
        select(CinemaShowtime)
        .where(CinemaShowtime.show_date == today)
        .where(CinemaShowtime.is_cancelled.is_(False))
        .order_by(CinemaShowtime.show_time)
        .limit(1)
    )
    show = result.scalars().first()
    return _payload(show, viewer) if show else None


@router.get("/next", response_model=None)
async def next_showtime(viewer: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """En yakın gelecek seans (bilet alma daveti için)."""
    today = date.today().isoformat()
    result = await db.execute(
        select(CinemaShowtime)
        .where(CinemaShowtime.show_date >= today)
        .where(CinemaShowtime.is_cancelled.is_(False))
        .order_by(CinemaShowtime.show_date, CinemaShowtime.show_time)
        .limit(1)
    )
    show = result.scalars().first()
    return _payload(show, viewer) if show else None


# --------------------------------------------------------------------------
# Yazma (manuel)
# --------------------------------------------------------------------------

@router.post("", response_model=None)
async def create_showtime(payload: ShowtimeCreate, db: AsyncSession = Depends(get_db)):
    resolved = resolve_video(payload.video_url)
    show = CinemaShowtime(
        title=payload.title.strip(),
        description=payload.description,
        genre=payload.genre or "film",
        poster_url=payload.poster_url or resolved.get("poster_url"),
        video_url=resolved["video_url"],
        embed_url=resolved.get("embed_url"),
        source=resolved["source"],
        duration_minutes=payload.duration_minutes or 0,
        show_date=_normalize_date(payload.show_date),
        show_time=_normalize_time(payload.show_time),
        hall=payload.hall or "Salon 1",
        seats=max(2, payload.seats or 2),
        booked_by="",
        is_published=payload.is_published,
        created_by=payload.created_by or "murat",
    )
    db.add(show)
    await db.commit()
    await db.refresh(show)

    await ws_manager.broadcast({
        "type": "cinema_showtime_added",
        "showtime": _payload(show),
    })
    return _payload(show)


@router.put("/{showtime_id}", response_model=None)
async def update_showtime(showtime_id: int, payload: ShowtimeUpdate, db: AsyncSession = Depends(get_db)):
    show = await db.get(CinemaShowtime, showtime_id)
    if not show:
        raise HTTPException(status_code=404, detail="Seans bulunamadı")

    data = payload.model_dump(exclude_unset=True)
    if "video_url" in data and data["video_url"]:
        resolved = resolve_video(data["video_url"])
        show.video_url = resolved["video_url"]
        show.embed_url = resolved.get("embed_url")
        show.source = resolved["source"]
        if not data.get("poster_url"):
            show.poster_url = resolved.get("poster_url")
        data.pop("video_url")

    if "show_date" in data and data["show_date"]:
        data["show_date"] = _normalize_date(data["show_date"])
    if "show_time" in data and data["show_time"]:
        data["show_time"] = _normalize_time(data["show_time"])

    for key, value in data.items():
        if key in ("updated_by",):
            continue
        if value is not None:
            setattr(show, key, value)
    show.updated_by = payload.updated_by or "manuel"
    show.updated_at = now_utc()
    await db.commit()
    await db.refresh(show)

    await ws_manager.broadcast({
        "type": "cinema_showtime_updated",
        "showtime": _payload(show),
    })
    return _payload(show)


@router.delete("/{showtime_id}")
async def delete_showtime(showtime_id: int, db: AsyncSession = Depends(get_db)):
    show = await db.get(CinemaShowtime, showtime_id)
    if not show:
        raise HTTPException(status_code=404, detail="Seans bulunamadı")
    await db.delete(show)
    await db.commit()
    await ws_manager.broadcast({"type": "cinema_showtime_deleted", "showtime_id": showtime_id})
    return {"success": True}


# --------------------------------------------------------------------------
# Bilet
# --------------------------------------------------------------------------

@router.post("/{showtime_id}/ticket", response_model=None)
async def book_ticket(showtime_id: int, payload: TicketRequest, db: AsyncSession = Depends(get_db)):
    """Bilet al (gerçek bilet değil; ortak rezervasyon)."""
    show = await db.get(CinemaShowtime, showtime_id)
    if not show:
        raise HTTPException(status_code=404, detail="Seans bulunamadı")
    if show.is_cancelled:
        raise HTTPException(status_code=400, detail="Bu seans iptal edilmiş")

    booked = _booked_list(show.booked_by)
    if payload.user_id in booked:
        raise HTTPException(status_code=400, detail="Bu seans için zaten biletin var")
    if len(booked) >= (show.seats or 2):
        raise HTTPException(status_code=400, detail="Salon dolu")

    booked.append(payload.user_id)
    show.booked_by = ",".join(booked)
    show.ticket_code = show.ticket_code or _ticket_code(show)
    await db.commit()
    await db.refresh(show)

    partner = settings.partner_of(payload.user_id)
    await ws_manager.send_to_user(partner, {
        "type": "cinema_ticket_booked",
        "showtime": _payload(show, partner),
        "booked_by": payload.user_id,
    })
    return _payload(show, payload.user_id)


@router.delete("/{showtime_id}/ticket", response_model=None)
async def cancel_ticket(
    showtime_id: int,
    user_id: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    show = await db.get(CinemaShowtime, showtime_id)
    if not show:
        raise HTTPException(status_code=404, detail="Seans bulunamadı")

    booked = _booked_list(show.booked_by)
    if user_id not in booked:
        raise HTTPException(status_code=400, detail="Bu seans için biletin yok")
    booked.remove(user_id)
    show.booked_by = ",".join(booked)
    if not booked:
        show.ticket_code = None
    await db.commit()
    await db.refresh(show)

    await ws_manager.send_to_user(settings.partner_of(user_id), {
        "type": "cinema_ticket_cancelled",
        "showtime": _payload(show),
        "cancelled_by": user_id,
    })
    return _payload(show, user_id)


# --------------------------------------------------------------------------
# Seansı izlemeye başla (takvimden salona geçiş)
# --------------------------------------------------------------------------

@router.post("/{showtime_id}/open", response_model=None)
async def open_showtime(
    showtime_id: int,
    payload: TicketRequest,
    db: AsyncSession = Depends(get_db),
):
    """Takvimdeki filmi sinema salonunda aç. Salon tüm cihazlara senkronlanır."""
    show = await db.get(CinemaShowtime, showtime_id)
    if not show:
        raise HTTPException(status_code=404, detail="Seans bulunamadı")

    booked = _booked_list(show.booked_by)
    if booked and payload.user_id not in booked:
        raise HTTPException(status_code=403, detail="Önce bilet almalısın 🎟️")

    resolved = resolve_video(show.video_url)
    room = await db.get(CinemaRoom, show.room_id) if show.room_id else None
    if not room:
        room = CinemaRoom(
            title=show.title,
            video_url=show.video_url,
            source=resolved["source"],
            embed_url=resolved.get("embed_url"),
            poster_url=show.poster_url or resolved.get("poster_url"),
            kind="embed" if resolved.get("embed_url") else "film",
            created_by=payload.user_id,
            is_playing=False,
            is_active=False,
            position=0.0,
            duration=0.0,
        )
        db.add(room)
        await db.flush()
        show.room_id = room.id

    # Tek aktif salon: diğerlerini kapat
    all_rooms = await db.execute(select(CinemaRoom))
    for other in all_rooms.scalars().all():
        other.is_active = False

    room.is_active = True
    room.is_playing = True
    room.position = 0.0
    room.updated_by = payload.user_id
    room.last_seen_at = now_utc()
    show.started_at = show.started_at or now_utc()
    await db.commit()
    await db.refresh(show)
    await db.refresh(room)

    await ws_manager.broadcast({
        "type": "cinema_started",
        "room": {
            "id": room.id,
            "title": room.title,
            "video_url": room.video_url,
            "source": room.source,
            "embed_url": room.embed_url,
            "poster_url": room.poster_url,
            "kind": room.kind,
            "created_by": room.created_by,
            "is_playing": True,
            "is_active": True,
            "position": 0,
            "duration": room.duration or 0,
            "updated_by": payload.user_id,
            "showtime_id": show.id,
        },
        "started_by": payload.user_id,
        "showtime_id": show.id,
        "title": show.title,
    })
    return _payload(show, payload.user_id)


# --------------------------------------------------------------------------
# OpenClaw / otomasyon: bütün ayı tek istekte ayarla
# --------------------------------------------------------------------------

@router.post("/import")
async def import_calendar(payload: CalendarImport, db: AsyncSession = Depends(get_db)):
    """Bir ayın takvimini tek istekte oluştur (OpenClaw entegrasyonu).

    `replace_existing` true ise o ayın eski seansları silinir.
    Video adresi verilmemişse hata döner, var olan linkler otomatik çözümlenir.
    """
    if not payload.showtimes:
        raise HTTPException(status_code=400, detail="Takvim boş olamaz")

    month = payload.month
    if not month:
        dates = sorted(_normalize_date(item.show_date) for item in payload.showtimes)
        month = dates[0][:7] if dates else date.today().isoformat()[:7]

    removed = 0
    if payload.replace_existing:
        existing = await db.execute(
            select(CinemaShowtime).where(CinemaShowtime.show_date.like(f"{month}%"))
        )
        for show in existing.scalars().all():
            await db.delete(show)
            removed += 1

    created = []
    for item in payload.showtimes:
        resolved = resolve_video(item.video_url)
        show = CinemaShowtime(
            title=item.title.strip(),
            description=item.description,
            genre=item.genre or "film",
            poster_url=item.poster_url or resolved.get("poster_url"),
            video_url=resolved["video_url"],
            embed_url=resolved.get("embed_url"),
            source=resolved["source"],
            duration_minutes=item.duration_minutes or 0,
            show_date=_normalize_date(item.show_date),
            show_time=_normalize_time(item.show_time),
            hall=item.hall or "Salon 1",
            seats=2,
            booked_by="",
            is_published=True,
            created_by=payload.created_by or "openclaw",
        )
        db.add(show)
        created.append(show)

    await db.commit()
    for show in created:
        await db.refresh(show)

    await ws_manager.broadcast({
        "type": "cinema_calendar_updated",
        "month": month,
        "count": len(created),
        "by": payload.created_by or "openclaw",
    })

    return {
        "success": True,
        "month": month,
        "created": len(created),
        "removed": removed,
        "showtimes": [_payload(s) for s in created],
    }


@router.post("/auto-schedule")
async def auto_schedule(payload: dict, db: AsyncSession = Depends(get_db)):
    """Basit otomatik plan: başlık + site linki listesi verilir, tarihler dağıtılır.

    Örnek gövde:
        {"month": "2026-11", "day": 8, "time": "21:00",
         "films": [{"title": "Inception", "video_url": "..."}], "replace_existing": true}
    """
    month = payload.get("month")
    if not month:
        raise HTTPException(status_code=400, detail="Ay (YYYY-MM) gerekli")
    films = payload.get("films") or []
    if not films:
        raise HTTPException(status_code=400, detail="Film listesi boş olamaz")

    day = int(payload.get("day") or 8)
    time_value = _normalize_time(payload.get("time") or "21:00")
    created_by = payload.get("created_by") or "openclaw"

    if payload.get("replace_existing"):
        existing = await db.execute(
            select(CinemaShowtime).where(CinemaShowtime.show_date.like(f"{month}%"))
        )
        for show in existing.scalars().all():
            await db.delete(show)

    created = []
    for index, film in enumerate(films):
        # Her filme 4 günde bir seans: 8, 12, 16, 20, 24, 28...
        release_day = day + index * 4
        try:
            show_date = date.fromisoformat(f"{month}-01").replace(day=1) + timedelta(days=release_day - 1)
        except ValueError:
            show_date = date.fromisoformat(f"{month}-01")
        resolved = resolve_video(film.get("video_url") or film.get("url") or "")
        show = CinemaShowtime(
            title=(film.get("title") or "Film").strip(),
            description=film.get("description"),
            genre=film.get("genre") or "film",
            poster_url=film.get("poster_url") or resolved.get("poster_url"),
            video_url=resolved["video_url"],
            embed_url=resolved.get("embed_url"),
            source=resolved["source"],
            duration_minutes=film.get("duration_minutes") or 0,
            show_date=show_date.isoformat(),
            show_time=time_value,
            hall=f"Salon {index % 2 + 1}",
            seats=2,
            booked_by="",
            is_published=True,
            created_by=created_by,
        )
        db.add(show)
        created.append(show)

    await db.commit()
    for show in created:
        await db.refresh(show)

    await ws_manager.broadcast({
        "type": "cinema_calendar_updated",
        "month": month,
        "count": len(created),
        "by": created_by,
    })
    return {"success": True, "month": month, "created": len(created), "showtimes": [_payload(s) for s in created]}


@router.get("/export")
async def export_calendar(month: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Takvimi dışa aktar (OpenClaw okur / yedek alır)."""
    query = select(CinemaShowtime)
    if month:
        query = query.where(CinemaShowtime.show_date.like(f"{month}%"))
    query = query.order_by(CinemaShowtime.show_date, CinemaShowtime.show_time)
    result = await db.execute(query)
    shows = result.scalars().all()
    return {
        "month": month,
        "count": len(shows),
        "showtimes": [_payload(s) for s in shows],
    }

# --------------------------------------------------------------------------
# Tek seans detayı — EN SONDA: /{showtime_id} yalnızca sayısal kimlikleri
# yakalasın diye (export, tonight, next gibi sabit yollar önce tanımlı olmalı).
# --------------------------------------------------------------------------

@router.get("/{showtime_id}", response_model=None)
async def get_showtime(showtime_id: int, viewer: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    show = await db.get(CinemaShowtime, showtime_id)
    if not show:
        raise HTTPException(status_code=404, detail="Seans bulunamadı")
    return _payload(show, viewer)
