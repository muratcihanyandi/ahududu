from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from datetime import datetime
from backend.app.database import get_db
from backend.app.models import WatchBiometrics, now_utc
from backend.app.schemas import WatchBiometricsUpdate, NudgeRequest, RemoteHapticRequest
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/watch", tags=["watch"])

@router.post("/biometrics")
async def update_biometrics(payload: WatchBiometricsUpdate, db: AsyncSession = Depends(get_db)):
    bio = WatchBiometrics(
        user_id=payload.user_id,
        heart_rate=payload.heart_rate,
        steps=payload.steps or 0,
        stress_level=payload.stress_level or 20,
        watch_model=payload.watch_model or "Galaxy Watch",
        battery=payload.battery or 100
    )
    db.add(bio)
    await db.commit()
    await db.refresh(bio)

    # Broadcast live heartbeat and biometrics to partner
    partner_id = "sevgilim" if payload.user_id == "murat" else "murat"
    await ws_manager.send_to_user(partner_id, {
        "type": "partner_watch_biometrics",
        "user_id": payload.user_id,
        "heart_rate": payload.heart_rate,
        "steps": payload.steps,
        "stress_level": payload.stress_level,
        "battery": payload.battery,
        "watch_model": payload.watch_model
    })
    return {"success": True, "recorded_id": bio.id}

@router.get("/biometrics/{user_id}")
async def get_latest_biometrics(user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(WatchBiometrics)
        .where(WatchBiometrics.user_id == user_id)
        .order_by(desc(WatchBiometrics.recorded_at))
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    if not latest:
        # Default fallback
        return {
            "user_id": user_id,
            "heart_rate": 74,
            "steps": 4820,
            "stress_level": 22,
            "battery": 90,
            "watch_model": "Galaxy Watch"
        }
    return {
        "user_id": latest.user_id,
        "heart_rate": latest.heart_rate,
        "steps": latest.steps,
        "stress_level": latest.stress_level,
        "battery": latest.battery,
        "watch_model": latest.watch_model,
        "recorded_at": latest.recorded_at.isoformat()
    }

@router.post("/nudge")
async def send_nudge(payload: NudgeRequest):
    """Beni Sev / İlgi İsteme butonu ve özel bildirim"""
    recipient = "sevgilim" if payload.sender == "murat" else "murat"
    await ws_manager.send_to_user(recipient, {
        "type": "nudge",
        "sender": payload.sender,
        "nudge_type": payload.nudge_type,
        "message": payload.message,
        "vibration_pattern": [300, 150, 300, 150, 600]
    })
    return {"success": True, "notified": recipient}

@router.post("/haptic")
async def trigger_remote_haptic(payload: RemoteHapticRequest):
    """Uzaktan partnerin telefonunu veya saatini titretme"""
    recipient = "sevgilim" if payload.sender == "murat" else "murat"
    
    # Pre-defined vibration patterns
    patterns = {
        "heartbeat": [120, 100, 180, 800, 120, 100, 180],
        "hug": [400, 200, 400],
        "kiss": [80, 80, 80, 80, 150],
        "sos": [300, 100, 300, 100, 300, 100, 600],
        "buzz": [500]
    }
    vibe = patterns.get(payload.pattern, [200, 200])

    await ws_manager.send_to_user(recipient, {
        "type": "remote_vibrate",
        "sender": payload.sender,
        "pattern_name": payload.pattern,
        "vibration_pattern": vibe,
        "target_device": payload.target_device
    })
    return {"success": True, "target": recipient}
