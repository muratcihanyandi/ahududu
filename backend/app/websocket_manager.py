import asyncio
import json
import logging
from typing import Dict, List
from fastapi import WebSocket
from backend.app.config import settings

logger = logging.getLogger("ahududu.websocket")

class ConnectionManager:
    def __init__(self):
        # user_id -> list of active WebSockets (phone, browser)
        self.active_connections: Dict[str, List[WebSocket]] = {
            user_id: [] for user_id in settings.USER_IDS
        }
        self._tasks: set[asyncio.Task] = set()

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.info(f"User '{user_id}' connected. Total for user: {len(self.active_connections[user_id])}")
        
        partner_id = settings.partner_of(user_id)
        # Immediately inform the newly connected client of the partner's current status
        try:
            await websocket.send_text(json.dumps({
                "type": "partner_status",
                "user_id": partner_id,
                "is_online": bool(self.active_connections.get(partner_id)),
            }, ensure_ascii=False))
        except Exception as e:
            logger.warning(f"Error sending initial partner_status to {user_id}: {e}")

        # Broadcast online status to partner
        await self.send_to_user(partner_id, {
            "type": "partner_status",
            "user_id": user_id,
            "is_online": True
        })

    def disconnect(self, websocket: WebSocket, user_id: str):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
                logger.info(f"User '{user_id}' disconnected. Remaining: {len(self.active_connections[user_id])}")

        # If no more connections for this user, notify partner
        if not self.active_connections.get(user_id):
            partner_id = settings.partner_of(user_id)
            task = asyncio.create_task(self._announce_offline(user_id, partner_id))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _announce_offline(self, user_id: str, partner_id: str):
        """Bağlantı kapandı: son görülme zamanını kaydet ve partner'e bildir.

        "Son görülme" yalnızca batarya/konum güncellemelerinde tazelenirse,
        uygulama kapatıldığında saat saatlerce eski kalırdı. Bu yüzden en son
        bağlantı düştüğünde de zamanı yazıyoruz ve aynı bildirimde gönderiyoruz;
        partner'in ekranı ek bir istek yapmadan doğru saati gösterir.
        """
        if self.active_connections.get(user_id):
            return

        last_seen_iso = None
        try:
            from backend.app.database import AsyncSessionLocal
            from backend.app.models import UserProfile, now_utc

            async with AsyncSessionLocal() as db:
                profile = await db.get(UserProfile, user_id)
                if profile:
                    profile.last_seen = now_utc()
                    await db.commit()
                    last_seen_iso = profile.last_seen.isoformat()
        except Exception as e:  # noqa: BLE001 - durum bildirimi asla düşmesin
            logger.warning(f"Could not persist last_seen for '{user_id}': {e}")

        # Clear stale cinema presence if the user disconnected without leaving cleanly
        if not self.active_connections.get(user_id):
            try:
                from backend.app.routes.cinema import set_cinema_presence
                await set_cinema_presence(user_id, False)
            except Exception:  # noqa: BLE001
                pass

        # Abort offline notification if user reconnected while DB work was in flight
        if self.active_connections.get(user_id):
            return

        await self.send_to_user(partner_id, {
            "type": "partner_status",
            "user_id": user_id,
            "is_online": False,
            "last_seen": last_seen_iso,
        })

    async def send_to_user(self, user_id: str, message: dict):
        connections = self.active_connections.get(user_id)
        if not connections:
            return
        dead_connections = []
        payload = json.dumps(message, ensure_ascii=False)
        for ws in list(connections):
            try:
                await ws.send_text(payload)
            except Exception as e:
                logger.warning(f"Error sending to {user_id}: {e}")
                dead_connections.append(ws)
        
        for dead in dead_connections:
            if dead in connections:
                connections.remove(dead)

    async def broadcast(self, message: dict):
        payload = json.dumps(message, ensure_ascii=False)
        for user_id, connections in list(self.active_connections.items()):
            dead_connections = []
            for ws in list(connections):
                try:
                    await ws.send_text(payload)
                except Exception:
                    dead_connections.append(ws)
            for dead in dead_connections:
                if dead in connections:
                    connections.remove(dead)

ws_manager = ConnectionManager()
