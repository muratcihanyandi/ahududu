import math
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
from backend.app.database import get_db
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
    partner_id = "sevgilim" if payload.user_id == "murat" else "murat"
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
    murat = await db.get(UserProfile, "murat")
    sevgilim = await db.get(UserProfile, "sevgilim")
    
    distance_km = None
    if murat and sevgilim and murat.current_lat and sevgilim.current_lat:
        distance_km = haversine_distance(
            murat.current_lat, murat.current_lon,
            sevgilim.current_lat, sevgilim.current_lon
        )
        
    return {
        "murat": {
            "lat": murat.current_lat if murat else None,
            "lon": murat.current_lon if murat else None,
            "place": murat.place_name if murat else "Bilinmiyor",
            "battery": murat.battery_level if murat else 100,
            "status": murat.status_text if murat else "Beklemede",
            "last_seen": murat.last_seen.isoformat() if (murat and murat.last_seen) else None
        },
        "sevgilim": {
            "lat": sevgilim.current_lat if sevgilim else None,
            "lon": sevgilim.current_lon if sevgilim else None,
            "place": sevgilim.place_name if sevgilim else "Bilinmiyor",
            "battery": sevgilim.battery_level if sevgilim else 100,
            "status": sevgilim.status_text if sevgilim else "Beklemede",
            "last_seen": sevgilim.last_seen.isoformat() if (sevgilim and sevgilim.last_seen) else None
        },
        "distance_km": distance_km
    }
