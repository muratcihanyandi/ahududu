import json
import logging
from typing import Dict, List, Set
from fastapi import WebSocket

logger = logging.getLogger("ahududu.websocket")

class ConnectionManager:
    def __init__(self):
        # user_id -> list of active WebSockets (phone, watch, browser)
        self.active_connections: Dict[str, List[WebSocket]] = {
            "murat": [],
            "sevgilim": []
        }

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)
        logger.info(f"User '{user_id}' connected. Total for user: {len(self.active_connections[user_id])}")
        
        # Broadcast online status to partner
        partner_id = "sevgilim" if user_id == "murat" else "murat"
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
            partner_id = "sevgilim" if user_id == "murat" else "murat"
            import asyncio
            asyncio.create_task(self.send_to_user(partner_id, {
                "type": "partner_status",
                "user_id": user_id,
                "is_online": False
            }))

    async def send_to_user(self, user_id: str, message: dict):
        connections = self.active_connections.get(user_id, [])
        dead_connections = []
        payload = json.dumps(message, ensure_ascii=False)
        for ws in connections:
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
        for user_id, connections in self.active_connections.items():
            dead_connections = []
            for ws in connections:
                try:
                    await ws.send_text(payload)
                except Exception as e:
                    dead_connections.append(ws)
            for dead in dead_connections:
                if dead in connections:
                    connections.remove(dead)

ws_manager = ConnectionManager()
