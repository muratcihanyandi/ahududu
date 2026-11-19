import math
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from backend.app.database import get_db
from backend.app.config import settings
from backend.app.models import UserProfile, LocationLog, now_utc
from backend.app.routes.auth import ensure_profiles
from backend.app.schemas import LocationUpdate
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/location", tags=["location"])

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Returns distance between two coordinates in kilometers."""
    R = 6371.0  # Earth radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2)
    a = min(1.0, max(0.0, a))
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)

@router.post("/update")
async def update_location(payload: LocationUpdate, db: AsyncSession = Depends(get_db)):
    await ensure_profiles(db)
    profile = await db.get(UserProfile, payload.user_id)
    resolved_place = (payload.place_name or "").strip() or (profile.place_name if profile else "") or ""
    if profile:
        profile.current_lat = payload.latitude
        profile.current_lon = payload.longitude
        if payload.place_name and payload.place_name.strip():
            profile.place_name = payload.place_name.strip()
        if payload.battery is not None:
            profile.battery_level = payload.battery
        profile.last_seen = now_utc()
        resolved_place = profile.place_name or ""

    battery_val = payload.battery if payload.battery is not None else (profile.battery_level if profile else 100)
    # Store in location logs
    log = LocationLog(
        user_id=payload.user_id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        accuracy=payload.accuracy if payload.accuracy is not None else 10.0,
        place_name=resolved_place or "Konum",
        battery=battery_val,
        speed=payload.speed if payload.speed is not None else 0.0
    )
    db.add(log)
    await db.commit()

    # Calculate distance if both coords exist
    partner_id = settings.partner_of(payload.user_id)
    partner = await db.get(UserProfile, partner_id)
    distance_km = None
    if (
        profile
        and partner
        and profile.current_lat is not None
        and profile.current_lon is not None
        and partner.current_lat is not None
        and partner.current_lon is not None
    ):
        distance_km = haversine_distance(
            profile.current_lat, profile.current_lon,
            partner.current_lat, partner.current_lon
        )

    # Broadcast to partner
    await ws_manager.send_to_user(partner_id, {
        "type": "partner_location_update",
        "user_id": payload.user_id,
        "latitude": payload.latitude,
        "longitude": payload.longitude,
        "place_name": resolved_place,
        "battery": battery_val,
        "distance_km": distance_km,
        "last_seen": profile.last_seen.isoformat() if (profile and profile.last_seen) else None,
    })

    return {
        "success": True,
        "distance_km": distance_km
    }

@router.get("/couple-status")
async def get_couple_status(db: AsyncSession = Depends(get_db)):
    await ensure_profiles(db)
    murat = await db.get(UserProfile, settings.USER_MURAT)
    selin = await db.get(UserProfile, settings.USER_SELIN)

    distance_km = None
    if (
        murat
        and selin
        and murat.current_lat is not None
        and murat.current_lon is not None
        and selin.current_lat is not None
        and selin.current_lon is not None
    ):
        distance_km = haversine_distance(
            murat.current_lat, murat.current_lon,
            selin.current_lat, selin.current_lon
        )

    def person(profile):
        return {
            "lat": profile.current_lat if profile else None,
            "lon": profile.current_lon if profile else None,
            "place": (profile.place_name or "") if profile else "",
            "battery": profile.battery_level if profile else 100,
            "status": (profile.status_text or "") if profile else "",
            "last_seen": profile.last_seen.isoformat() if (profile and profile.last_seen) else None,
        }

    return {
        settings.USER_MURAT: person(murat),
        settings.USER_SELIN: person(selin),
        "distance_km": distance_km,
    }
