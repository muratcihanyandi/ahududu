"""Hayvan Albümü — her hayvan arkadaşımıza isim ve kategori.

Kediler, köpekler, kuşlar, balıklar... Her biri kendi profiline,
fotoğraf albümüne ve sevimli notlarına sahip.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.config import settings
from backend.app.database import get_db
from backend.app.models import PetProfile, PetPhoto
from backend.app.schemas import (
    PetCreate,
    PetUpdate,
    PetResponse,
    PetPhotoCreate,
    PetPhotoResponse,
    PetWithPhotos,
)
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/pets", tags=["pets"])

def normalize_category(raw: str) -> str:
    """Kategorileri tek biçime indirger: 'köpek' / 'kopek' / 'Köpek' hepsi 'köpek'."""
    value = (raw or "").strip().lower()
    ascii_key = value.translate(TR_ASCII)
    canonical = CATEGORY_CANONICAL.get(ascii_key)
    if canonical:
        return canonical
    return value


DEFAULT_EMOJI = {
    "kedi": "🐱",
    "köpek": "🐶",
    "kuş": "🐦",
    "balık": "🐠",
    "tavşan": "🐰",
    "hamster": "🐹",
    "kaplumbağa": "🐢",
    "sürüngen": "🦎",
    "at": "🐴",
    "diğer": "🐾",
}

CATEGORY_CANONICAL = {
    "kedi": "kedi",
    "kopek": "köpek",
    "kus": "kuş",
    "balik": "balık",
    "tavsan": "tavşan",
    "hamster": "hamster",
    "kaplumbaga": "kaplumbağa",
    "surungen": "sürüngen",
    "at": "at",
    "diger": "diğer",
}

TR_ASCII = str.maketrans("çğıöşü", "cgiosu")


def _pet_dict(pet: PetProfile) -> dict:
    return {
        "id": pet.id,
        "name": pet.name,
        "category": pet.category,
        "emoji": pet.emoji or DEFAULT_EMOJI.get(pet.category, "🐾"),
        "photo_url": pet.photo_url,
        "color": pet.color or "#be185d",
        "owner": pet.owner,
        "age": pet.age,
        "breed": pet.breed,
        "bio": pet.bio,
        "love_notes": pet.love_notes,
        "is_favorite": bool(pet.is_favorite),
        "sort_order": pet.sort_order or 0,
        "created_at": pet.created_at.isoformat() if pet.created_at else None,
    }


@router.get("", response_model=List[PetWithPhotos])
async def list_pets(
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    query = select(PetProfile)
    if category and category not in ("Tümü", "all"):
        query = query.where(PetProfile.category == normalize_category(category))
    query = query.order_by(
        desc(PetProfile.is_favorite),
        PetProfile.sort_order,
        desc(PetProfile.created_at),
    )
    result = await db.execute(query)
    pets = result.scalars().all()

    photos_result = await db.execute(
        select(PetPhoto).order_by(desc(PetPhoto.created_at))
    )
    photos = photos_result.scalars().all()

    by_pet: dict = {}
    for photo in photos:
        by_pet.setdefault(photo.pet_id, []).append(photo)

    output = []
    for pet in pets:
        pet_photos = by_pet.get(pet.id, [])
        output.append({
            "pet": _pet_dict(pet),
            "photos": [
                {
                    "id": p.id,
                    "pet_id": p.pet_id,
                    "uploader": p.uploader,
                    "media_url": p.media_url,
                    "media_type": p.media_type,
                    "caption": p.caption,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                }
                for p in pet_photos
            ],
            "photo_count": len(pet_photos),
            "last_photo_at": pet_photos[0].created_at.isoformat() if pet_photos and pet_photos[0].created_at else None,
        })
    return output


@router.get("/categories")
async def list_categories(db: AsyncSession = Depends(get_db)):
    """Kategori listesi ve her kategoride kaç hayvan var."""
    result = await db.execute(
        select(PetProfile.category, func.count(PetProfile.id)).group_by(PetProfile.category)
    )
    counts = {row[0]: row[1] for row in result.all()}
    all_result = await db.execute(select(func.count(PetProfile.id)))
    total = all_result.scalar() or 0
    return {"total": total, "counts": counts}


@router.post("", response_model=PetResponse)
async def create_pet(payload: PetCreate, db: AsyncSession = Depends(get_db)):
    category = normalize_category(payload.category or "kedi")
    requested_emoji = (payload.emoji or "").strip()
    # İstemci varsayılan "🐾" gönderirse kategoriye uygun emojiyi biz seçelim.
    emoji = requested_emoji if requested_emoji and requested_emoji != "🐾" else DEFAULT_EMOJI.get(category, "🐾")
    pet = PetProfile(
        name=payload.name.strip(),
        category=category,
        emoji=emoji,
        photo_url=payload.photo_url,
        color=payload.color or "#be185d",
        owner=payload.owner or "bizim",
        age=payload.age,
        breed=payload.breed,
        bio=payload.bio,
        love_notes=payload.love_notes,
        is_favorite=bool(payload.is_favorite),
        sort_order=0,
    )
    db.add(pet)
    await db.commit()
    await db.refresh(pet)

    await ws_manager.broadcast({
        "type": "new_pet",
        "pet": _pet_dict(pet),
    })
    return _pet_dict(pet)


@router.put("/{pet_id}", response_model=PetResponse)
async def update_pet(pet_id: int, payload: PetUpdate, db: AsyncSession = Depends(get_db)):
    pet = await db.get(PetProfile, pet_id)
    if not pet:
        raise HTTPException(status_code=404, detail="Hayvan bulunamadı")

    data = payload.model_dump(exclude_unset=True)
    if data.get("category"):
        data["category"] = normalize_category(data["category"])
    for key, value in data.items():
        if value is not None:
            setattr(pet, key, value)
    if data.get("category") and not payload.emoji:
        pet.emoji = DEFAULT_EMOJI.get(pet.category, pet.emoji or "🐾")
    elif data.get("category") and payload.emoji == "🐾":
        pet.emoji = DEFAULT_EMOJI.get(pet.category, "🐾")
    await db.commit()
    await db.refresh(pet)

    await ws_manager.broadcast({"type": "pet_updated", "pet": _pet_dict(pet)})
    return _pet_dict(pet)


@router.delete("/{pet_id}")
async def delete_pet(pet_id: int, db: AsyncSession = Depends(get_db)):
    pet = await db.get(PetProfile, pet_id)
    if not pet:
        raise HTTPException(status_code=404, detail="Hayvan bulunamadı")

    photos_result = await db.execute(select(PetPhoto).where(PetPhoto.pet_id == pet_id))
    for photo in photos_result.scalars().all():
        await db.delete(photo)
    await db.delete(pet)
    await db.commit()
    await ws_manager.broadcast({"type": "pet_deleted", "pet_id": pet_id})
    return {"success": True}


@router.post("/{pet_id}/photos", response_model=PetPhotoResponse)
async def add_pet_photo(pet_id: int, payload: PetPhotoCreate, db: AsyncSession = Depends(get_db)):
    pet = await db.get(PetProfile, pet_id)
    if not pet:
        raise HTTPException(status_code=404, detail="Hayvan bulunamadı")

    photo = PetPhoto(
        pet_id=pet_id,
        uploader=payload.uploader,
        media_url=payload.media_url,
        media_type=payload.media_type or "image",
        caption=payload.caption,
    )
    db.add(photo)
    await db.commit()
    await db.refresh(photo)

    # Profil fotoğrafı yoksa ilk eklenen fotoğraf kapak olsun
    if not pet.photo_url:
        pet.photo_url = payload.media_url
        await db.commit()

    recipient = settings.partner_of(payload.uploader)
    await ws_manager.send_to_user(recipient, {
        "type": "new_pet_photo",
        "pet_id": pet_id,
        "photo": {
            "id": photo.id,
            "pet_id": photo.pet_id,
            "uploader": photo.uploader,
            "media_url": photo.media_url,
            "media_type": photo.media_type,
            "caption": photo.caption,
            "created_at": photo.created_at.isoformat(),
        },
    })
    return photo


@router.delete("/{pet_id}/photos/{photo_id}")
async def delete_pet_photo(pet_id: int, photo_id: int, db: AsyncSession = Depends(get_db)):
    photo = await db.get(PetPhoto, photo_id)
    if not photo or photo.pet_id != pet_id:
        raise HTTPException(status_code=404, detail="Fotoğraf bulunamadı")
    await db.delete(photo)
    await db.commit()
    await ws_manager.broadcast({"type": "pet_photo_deleted", "pet_id": pet_id, "photo_id": photo_id})
    return {"success": True}
