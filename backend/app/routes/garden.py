"""Bahçe — My Bibi'den ilham alan çift ritüelleri.

Her şey "demo" etiketiyle eklenir: veriler kalıcıdır, özellikler çalışır,
fakat ileride geliştirilebilir olarak işaretlenmiştir.

  • Günlük Soru (Daily Bloom)   : Her gün tek soru; ikiniz de cevaplayana kadar
                                   karşı tarafın cevabı görünmez.
  • Zaman Kapsülü               : Belirli bir tarihe kadar açılmayan mesaj.
  • Bizim Şarkılarımız          : İkinizin şarkıları + o şarkının hikâyesi.
  • Bugün Yıllar Önce           : Aynı günün geçmiş yıllarındaki anılar.
  • Duygu Havası                : Bugünkü gökyüzün (☀️ ⛅ 🌧 ⛈ 🌙) + ısı haritası.
"""

import json
from datetime import date, datetime, timedelta
from typing import List, Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models import (
    CoupleDailyQuestion, CoupleTimeCapsule, CoupleSong, CoupleMoodWeather,
)
from backend.app.time_utils import now_tr, today_tr, to_tr_aware
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/garden", tags=["garden"])

# Hazır günlük sorular (sırayla döner)
QUESTION_BANK = [
    "Beraber gittiğimiz en güzel yer neresiydi?",
    "Benim en çok sevdiğin huyum ne?",
    "İlk tanıştığımız gün ne hissettin?",
    "Birlikte yapmak istediğin en büyük hayal ne?",
    "Bugün beni ne zaman düşündün?",
    "En sevdiğin küçük anımız hangisi?",
    "Beni ilk gördüğünde ilk dikkatini ne çekti?",
    "Beraber izlediğimiz en iyi film hangisiydi?",
    "Bir gün olsa ne yapmak isterdin?",
    "Sana en çok ne zaman minnettar kaldın?",
    "Birlikte öğrenmek istediğin bir şey var mı?",
    "En son ne zaman kalbim küt küt attı?",
]


def _today() -> str:
    return today_tr().isoformat()


async def _get_or_create_daily_question(day: str, db: AsyncSession) -> CoupleDailyQuestion:
    result = await db.execute(
        select(CoupleDailyQuestion)
        .where(CoupleDailyQuestion.question_date == day)
        .order_by(CoupleDailyQuestion.id.asc())
        .limit(1)
    )
    existing = result.scalars().first()
    if not existing:
        existing = CoupleDailyQuestion(
            question_date=day,
            prompt=QUESTION_BANK[today_tr().toordinal() % len(QUESTION_BANK)],
            answers="{}",
        )
        db.add(existing)
        await db.commit()
        await db.refresh(existing)
    return existing


# ---------------------------------------------------------------------------
# Günlük Soru
# ---------------------------------------------------------------------------

@router.get("/question")
async def get_daily_question(viewer: str = Query(...), db: AsyncSession = Depends(get_db)):
    day = _today()
    existing = await _get_or_create_daily_question(day, db)

    answers = _parse_answers(existing.answers)
    partner = settings.partner_of(viewer)
    answered_mine = viewer in answers
    answered_partner = partner in answers

    return {
        "date": day,
        "prompt": existing.prompt,
        "my_answer": answers.get(viewer),
        "partner_answer": answers.get(partner) if answered_mine and answered_partner else None,
        "answered_mine": answered_mine,
        "answered_partner": answered_partner,
        "both_answered": answered_mine and answered_partner,
        "demo": True,
    }


@router.post("/question/answer")
async def answer_daily_question(payload: dict, db: AsyncSession = Depends(get_db)):
    viewer = payload.get("user_id") if isinstance(payload.get("user_id"), str) else ""
    raw_answer = payload.get("answer")
    if not isinstance(raw_answer, str):
        raise HTTPException(status_code=400, detail="Geçersiz cevap")
    answer = raw_answer.strip()
    if not viewer or not answer:
        raise HTTPException(status_code=400, detail="Cevap boş olamaz")

    day = _today()
    entry = await _get_or_create_daily_question(day, db)

    answers = _parse_answers(entry.answers)
    answers[viewer] = answer[:1000]
    entry.answers = _dump_answers(answers)
    await db.commit()

    partner = settings.partner_of(viewer)
    revealed = partner in answers
    await ws_manager.send_to_user(partner, {
        "type": "garden_question_answered",
        "by": viewer,
        "revealed": revealed,
        "prompt": entry.prompt,
    })
    return {"success": True, "revealed": revealed}


def _parse_answers(raw: Optional[str]) -> dict:
    text = (raw or "").strip()
    if not text:
        return {}
    if text.startswith("{"):
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return {str(k): str(v) for k, v in parsed.items() if isinstance(v, str)}
        except Exception:
            pass
    result = {}
    for line in text.split("\n"):
        if "|||" in line:
            who, body = line.split("|||", 1)
            result[who.strip()] = body.strip()
    return result


def _dump_answers(answers: dict) -> str:
    return json.dumps(answers, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Zaman Kapsülü
# ---------------------------------------------------------------------------

@router.get("/capsules")
async def list_capsules(viewer: str = Query(...), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CoupleTimeCapsule).order_by(desc(CoupleTimeCapsule.open_date)))
    capsules = result.scalars().all()
    now = now_tr()
    output = []
    for capsule in capsules:
        can_open = _can_open(capsule, now)
        is_mine = capsule.sender == viewer
        output.append({
            "id": capsule.id,
            "sender": capsule.sender,
            "title": capsule.title,
            "open_date": capsule.open_date,
            "can_open": can_open,
            "is_mine": is_mine,
            # Hiç kimse erken göremez (gönderen de dahil)
            "content": capsule.content if can_open else None,
            "created_at": capsule.created_at.isoformat() if capsule.created_at else None,
            "demo": True,
        })
    return output


@router.post("/capsules")
async def create_capsule(payload: dict, db: AsyncSession = Depends(get_db)):
    sender = payload.get("sender") if isinstance(payload.get("sender"), str) else ""
    raw_title = payload.get("title")
    raw_content = payload.get("content")
    raw_open_date = payload.get("open_date")
    if not all(isinstance(v, str) for v in (raw_title, raw_content, raw_open_date)):
        raise HTTPException(status_code=400, detail="Başlık, mesaj ve tarih geçerli metin olmalı")

    title = raw_title.strip()
    content = raw_content.strip()
    open_date_str = raw_open_date.strip()

    if not sender or not title or not content:
        raise HTTPException(status_code=400, detail="Başlık ve mesaj gerekli")
    try:
        parsed_dt = to_tr_aware(datetime.fromisoformat(open_date_str))
    except (ValueError, TypeError) as exc:
        raise HTTPException(status_code=400, detail="Açılış tarihi geçersiz") from exc

    normalized_open_date = parsed_dt.strftime("%Y-%m-%dT%H:%M:%S")
    capsule = CoupleTimeCapsule(
        sender=sender,
        title=title[:200],
        content=content[:5000],
        open_date=normalized_open_date,
    )
    db.add(capsule)
    await db.commit()
    await db.refresh(capsule)

    await ws_manager.send_to_user(settings.partner_of(sender), {
        "type": "garden_capsule_sealed",
        "title": capsule.title,
        "open_date": capsule.open_date,
    })
    return {"success": True, "id": capsule.id}


@router.delete("/capsules/{capsule_id}")
async def delete_capsule(capsule_id: int, user_id: str = Query(...), db: AsyncSession = Depends(get_db)):
    capsule = await db.get(CoupleTimeCapsule, capsule_id)
    if not capsule:
        raise HTTPException(status_code=404, detail="Kapsül bulunamadı")
    if capsule.sender != user_id:
        raise HTTPException(status_code=403, detail="Sadece kendi kapsülünü silebilirsin")
    await db.delete(capsule)
    await db.commit()
    return {"success": True}


def _can_open(capsule: CoupleTimeCapsule, now: datetime) -> bool:
    try:
        target = to_tr_aware(datetime.fromisoformat(capsule.open_date))
        return target <= to_tr_aware(now)
    except (ValueError, TypeError):
        return False


# ---------------------------------------------------------------------------
# Bizim Şarkılarımız
# ---------------------------------------------------------------------------

def _validate_song_url(raw: str) -> str:
    url = raw.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Şarkı bağlantısı gerekli")
    low = url.lower()
    if low.startswith(("javascript:", "data:", "vbscript:", "file:")):
        raise HTTPException(status_code=400, detail="Geçersiz şarkı bağlantısı")
    if "://" not in url and "." in url.split("/")[0]:
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Geçerli bir http(s) bağlantısı gir")
    return url[:1000]


@router.get("/songs")
async def list_songs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CoupleSong).order_by(desc(CoupleSong.created_at)))
    songs = result.scalars().all()
    return [
        {
            "id": s.id,
            "title": s.title,
            "artist": s.artist,
            "url": s.url,
            "note": s.note,
            "added_by": s.added_by,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "demo": True,
        }
        for s in songs
    ]


@router.post("/songs")
async def add_song(payload: dict, db: AsyncSession = Depends(get_db)):
    added_by = payload.get("added_by") if isinstance(payload.get("added_by"), str) else ""
    raw_title = payload.get("title")
    raw_url = payload.get("url")
    if not isinstance(raw_title, str) or not isinstance(raw_url, str):
        raise HTTPException(status_code=400, detail="Şarkı adı ve bağlantı gerekli")
    title = raw_title.strip()
    url = _validate_song_url(raw_url)
    if not added_by or not title:
        raise HTTPException(status_code=400, detail="Şarkı adı ve bağlantı gerekli")

    artist_val = payload.get("artist")
    note_val = payload.get("note")
    song = CoupleSong(
        added_by=added_by,
        title=title[:200],
        artist=(artist_val.strip()[:200] or None) if isinstance(artist_val, str) else None,
        url=url,
        note=(note_val.strip()[:1000] or None) if isinstance(note_val, str) else None,
    )
    db.add(song)
    await db.commit()
    await db.refresh(song)

    await ws_manager.send_to_user(settings.partner_of(added_by), {
        "type": "garden_song_added",
        "title": song.title,
        "by": added_by,
    })
    return {"success": True, "id": song.id}


@router.delete("/songs/{song_id}")
async def delete_song(song_id: int, db: AsyncSession = Depends(get_db)):
    song = await db.get(CoupleSong, song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Şarkı bulunamadı")
    await db.delete(song)
    await db.commit()
    return {"success": True}


# ---------------------------------------------------------------------------
# Bugün Yıllar Önce
# ---------------------------------------------------------------------------

@router.get("/on-this-day")
async def on_this_day(db: AsyncSession = Depends(get_db)):
    """Geçmiş yılların aynı günündeki anılar, günlükler ve mektuplar."""
    from backend.app.models import DiaryEntry, GalleryItem, LoveLetter

    today = today_tr()
    month_day = today.strftime("%m-%d")
    items: List[dict] = []

    diary_result = await db.execute(
        select(DiaryEntry)
        .where(DiaryEntry.entry_date.like(f"%-{month_day}"))
        .where(DiaryEntry.is_locked.is_(False))
    )
    for entry in diary_result.scalars().all():
        try:
            year_int = int(entry.entry_date[:4])
        except (ValueError, TypeError):
            continue
        if year_int < today.year:
            items.append({
                "type": "diary",
                "year": year_int,
                "title": entry.title,
                "content": (entry.content or "")[:300],
                "date": entry.entry_date,
            })

    letter_result = await db.execute(
        select(
            LoveLetter.id,
            LoveLetter.title,
            LoveLetter.content_text,
            LoveLetter.created_at,
        )
        .where(LoveLetter.is_deleted.is_not(True))
        .where(LoveLetter.is_opened.is_(True))
    )
    for _, title, content_text, created_at in letter_result.all():
        if not created_at:
            continue
        local_dt = to_tr_aware(created_at)
        if local_dt.strftime("%m-%d") == month_day and local_dt.year < today.year:
            items.append({
                "type": "letter",
                "year": local_dt.year,
                "title": title,
                "content": (content_text or "")[:300],
                "date": local_dt.date().isoformat(),
            })

    gallery_result = await db.execute(
        select(
            GalleryItem.title,
            GalleryItem.caption,
            GalleryItem.media_url,
            GalleryItem.created_at,
        )
    )
    for title, caption, media_url, created_at in gallery_result.all():
        if not created_at:
            continue
        local_dt = to_tr_aware(created_at)
        if local_dt.strftime("%m-%d") == month_day and local_dt.year < today.year:
            items.append({
                "type": "photo",
                "year": local_dt.year,
                "title": title or caption or "Bir anımız",
                "url": media_url,
                "date": local_dt.date().isoformat(),
            })

    items.sort(key=lambda x: -x["year"])
    return {"date": today.isoformat(), "count": len(items), "items": items[:20], "demo": True}


# ---------------------------------------------------------------------------
# Duygu Havası
# ---------------------------------------------------------------------------

MOODS = {
    "sunny": {"emoji": "☀️", "label": "Güneşli"},
    "cloudy": {"emoji": "⛅", "label": "Bulutlu"},
    "rainy": {"emoji": "🌧️", "label": "Yağmurlu"},
    "storm": {"emoji": "⛈️", "label": "Fırtına"},
    "night": {"emoji": "🌙", "label": "Gece"},
}


@router.get("/mood")
async def get_mood(
    user_id: str = Query(...),
    days: int = Query(30, ge=1, le=120),
    db: AsyncSession = Depends(get_db),
):
    today = _today()
    today_result = await db.execute(
        select(CoupleMoodWeather)
        .where(CoupleMoodWeather.user_id == user_id)
        .where(CoupleMoodWeather.mood_date == today)
    )
    today_entry = today_result.scalars().first()

    since = (today_tr() - timedelta(days=days)).isoformat()
    history_result = await db.execute(
        select(CoupleMoodWeather)
        .where(CoupleMoodWeather.user_id == user_id)
        .where(CoupleMoodWeather.mood_date >= since)
        .order_by(CoupleMoodWeather.mood_date)
    )
    history = history_result.scalars().all()

    # Partnerin bugünkü havası (ikiniz de görebilirsiniz)
    partner_id = settings.partner_of(user_id)
    partner_result = await db.execute(
        select(CoupleMoodWeather)
        .where(CoupleMoodWeather.user_id == partner_id)
        .where(CoupleMoodWeather.mood_date == today)
    )
    partner_entry = partner_result.scalars().first()

    return {
        "today": today_entry.mood if today_entry else None,
        "partner_today": partner_entry.mood if partner_entry else None,
        "history": [
            {"date": h.mood_date, "mood": h.mood, "emoji": MOODS.get(h.mood, {}).get("emoji", "💭")}
            for h in history
        ],
        "moods": MOODS,
        "demo": True,
    }


@router.post("/mood")
async def set_mood(payload: dict, db: AsyncSession = Depends(get_db)):
    user_id = payload.get("user_id") if isinstance(payload.get("user_id"), str) else ""
    mood = payload.get("mood") if isinstance(payload.get("mood"), str) else ""
    if not user_id or mood not in MOODS:
        raise HTTPException(status_code=400, detail="Geçerli bir hava seç")

    today = _today()
    result = await db.execute(
        select(CoupleMoodWeather)
        .where(CoupleMoodWeather.user_id == user_id)
        .where(CoupleMoodWeather.mood_date == today)
        .order_by(CoupleMoodWeather.id.asc())
    )
    entry = result.scalars().first()
    if entry:
        entry.mood = mood
    else:
        entry = CoupleMoodWeather(user_id=user_id, mood_date=today, mood=mood)
        db.add(entry)
    await db.commit()

    await ws_manager.send_to_user(settings.partner_of(user_id), {
        "type": "garden_mood_updated",
        "by": user_id,
        "mood": mood,
        "emoji": MOODS[mood]["emoji"],
    })
    return {"success": True}


# ---------------------------------------------------------------------------
# Bahçe özeti (ana ekran kartı için)
# ---------------------------------------------------------------------------

@router.get("/summary")
async def garden_summary(viewer: str = Query(...), db: AsyncSession = Depends(get_db)):
    question = await get_daily_question(viewer=viewer, db=db)

    capsule_result = await db.execute(select(CoupleTimeCapsule))
    capsules = capsule_result.scalars().all()
    now = now_tr()
    ready_capsules = sum(1 for c in capsules if _can_open(c, now))
    waiting_capsules = len(capsules) - ready_capsules

    song_result = await db.execute(select(CoupleSong))
    song_count = len(song_result.scalars().all())

    otd = await on_this_day(db=db)
    mood = await get_mood(user_id=viewer, days=30, db=db)

    return {
        "question_pending": not question["answered_mine"],
        "question_both_answered": question["both_answered"],
        "ready_capsules": ready_capsules,
        "waiting_capsules": waiting_capsules,
        "song_count": song_count,
        "on_this_day_count": otd["count"],
        "my_mood": mood["today"],
        "demo": True,
    }
