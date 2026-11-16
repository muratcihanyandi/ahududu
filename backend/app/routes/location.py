import math
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from backend.app.database import get_db
from backend.app.config import settings
from backend.app.models import UserProfile, LocationLog, now_utc
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
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return round(R * c, 2)

@router.post("/update")
async def update_location(payload: LocationUpdate, db: AsyncSession = Depends(get_db)):
    profile = await db.get(UserProfile, payload.user_id)
    if profile:
        profile.current_lat = payload.latitude
        profile.current_lon = payload.longitude
        profile.place_name = payload.place_name or profile.place_name
        profile.battery_level = payload.battery or profile.battery_level
        profile.last_seen = now_utc()
    
    # Store in location logs
    log = LocationLog(
        user_id=payload.user_id,
        latitude=payload.latitude,
        longitude=payload.longitude,
        accuracy=payload.accuracy or 10.0,
        place_name=payload.place_name or "Konum",
        battery=payload.battery or 100,
        speed=payload.speed or 0.0
    )
    db.add(log)
    await db.commit()

    # Calculate distance if both coords exist
    partner_id = settings.partner_of(payload.user_id)
    partner = await db.get(UserProfile, partner_id)
    distance_km = None
    if profile and partner and profile.current_lat and partner.current_lat:
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
        "place_name": payload.place_name,
        "battery": payload.battery,
        "distance_km": distance_km
    })

    return {
        "success": True,
        "distance_km": distance_km
    }

@router.get("/couple-status")
async def get_couple_status(db: AsyncSession = Depends(get_db)):
    murat = await db.get(UserProfile, settings.USER_MURAT)
    selin = await db.get(UserProfile, settings.USER_SELIN)

    distance_km = None
    if murat and selin and murat.current_lat and selin.current_lat:
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
