from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from backend.app.database import get_db
from backend.app.config import settings
from backend.app.models import UserProfile, now_utc
from backend.app.schemas import UserProfileSchema, UserProfileUpdate
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/auth", tags=["auth"])

async def ensure_profiles(db: AsyncSession):
    # Ensure the two accounts exist. No fake status/place text is seeded:
    # a profile starts empty until the person themselves fills it in.
    defaults = [
        (settings.USER_MURAT, "Murat", "🐻"),
        (settings.USER_SELIN, "Selin", "🌸"),
    ]
    added = False
    for user_id, display_name, avatar in defaults:
        existing = await db.get(UserProfile, user_id)
        if not existing:
            db.add(UserProfile(
                id=user_id,
                display_name=display_name,
                avatar=avatar,
                status_text="",
                place_name="",
                battery_level=100,
            ))
            added = True
    if added:
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()

@router.get("/profiles")
async def get_profiles(db: AsyncSession = Depends(get_db)):
    await ensure_profiles(db)
    result = await db.execute(select(UserProfile))
    profiles = result.scalars().all()
    return profiles

@router.get("/profile/{user_id}", response_model=UserProfileSchema)
async def get_profile(user_id: str, db: AsyncSession = Depends(get_db)):
    await ensure_profiles(db)
    profile = await db.get(UserProfile, user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    return profile

@router.put("/profile/{user_id}", response_model=UserProfileSchema)
async def update_profile(user_id: str, payload: UserProfileUpdate, db: AsyncSession = Depends(get_db)):
    await ensure_profiles(db)
    profile = await db.get(UserProfile, user_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if value is None and key != "place_name":
            continue
        setattr(profile, key, value)
    profile.last_seen = now_utc()
    await db.commit()
    await db.refresh(profile)
    
    # Broadcast status change to partner
    partner_id = settings.partner_of(user_id)
    await ws_manager.send_to_user(partner_id, {
        "type": "partner_profile_updated",
        "profile": {
            "id": profile.id,
            "display_name": profile.display_name,
            "avatar": profile.avatar,
            "status_text": profile.status_text,
            "battery_level": profile.battery_level,
            "is_charging": profile.is_charging,
            "place_name": profile.place_name,
            "last_seen": profile.last_seen.isoformat() if profile.last_seen else None,
        }
    })
    return profile
