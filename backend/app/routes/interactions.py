from fastapi import APIRouter

from backend.app.schemas import NudgeRequest, RemoteHapticRequest
from backend.app.config import settings
from backend.app.websocket_manager import ws_manager

router = APIRouter(prefix="/api/interactions", tags=["interactions"])

# Pre-defined vibration patterns shared by nudge and remote vibration
VIBRATION_PATTERNS = {
    "heartbeat": [120, 100, 180, 800, 120, 100, 180],
    "hug": [400, 200, 400],
    "kiss": [80, 80, 80, 80, 150],
    "sos": [300, 100, 300, 100, 300, 100, 600],
    "buzz": [500],
}


@router.post("/nudge")
async def send_nudge(payload: NudgeRequest):
    """Beni Sev / İlgi İsteme butonu ve özel bildirim"""
    recipient = settings.partner_of(payload.sender)
    await ws_manager.send_to_user(recipient, {
        "type": "nudge",
        "sender": payload.sender,
        "nudge_type": payload.nudge_type,
        "message": payload.message,
        "vibration_pattern": VIBRATION_PATTERNS["heartbeat"]
    })
    return {"success": True, "notified": recipient}


@router.post("/haptic")
async def trigger_remote_haptic(payload: RemoteHapticRequest):
    """Uzaktan partnerin telefonunu titretme"""
    recipient = settings.partner_of(payload.sender)
    vibe = VIBRATION_PATTERNS.get(payload.pattern, [200, 200])

    await ws_manager.send_to_user(recipient, {
        "type": "remote_vibrate",
        "sender": payload.sender,
        "pattern_name": payload.pattern,
        "vibration_pattern": vibe,
        "target_device": payload.target_device
    })
    return {"success": True, "target": recipient}
