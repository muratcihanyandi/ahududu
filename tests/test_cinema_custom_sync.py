"""Sinema Yeni Senkronizasyon Mantığı Testi.

Doğrulanacak kurallar:
1. Takvimsiz hızlı izle:
   - Filmi kim açarsa yönetici odur.
   - Durdurma ve başlatma işlemini iki kişi de yapabilir.
   - Süre senkronizasyonu filmi açan kişiye göre yapılır:
     Başlata tıklandığında filmi açan kişinin süresine eşitlenir.
2. Takvim seansı:
   - Saati geldiğinde yeni salon otomatik açılır ve direkt başlatılır (is_playing=True).
   - Takvim salonunda sarma (seek) engellenir.
   - Durdurup başlatıldığında geride olan kişinin 3 saniye gerisinden devam eder:
     (örn. 11:08 ve 11:03 ise -> 11:00).
"""

import asyncio
from datetime import datetime
import os
import sys
import tempfile

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

DB_PATH = os.path.join(tempfile.gettempdir(), "ahududu_test_custom_sync.db")
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{DB_PATH}"
os.environ["UPLOAD_DIR"] = os.path.join(tempfile.gettempdir(), "ahududu_test_uploads")
os.environ["STATIC_DIR"] = os.path.join(ROOT, "frontend", "dist")

from httpx import AsyncClient, ASGITransport

from backend.app.main import app
from backend.app.database import init_db
from backend.app.routes.cinema import _device_positions, record_device_position
from backend.app.routes.cinema_calendar import check_and_start_due_showtimes


async def run_tests():
    await init_db()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://testserver") as client:
        # -------------------------------------------------------------
        # TEST 1: Takvimsiz Hızlı İzle
        # -------------------------------------------------------------
        print("\n--- TEST 1: Takvimsiz Hızlı İzle ---")
        # Murat filmi açar
        resp = await client.post("/api/cinema", json={
            "title": "Hızlı İzle Test Filmi",
            "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
            "created_by": "murat",
        })
        assert resp.status_code == 200, resp.text
        room = resp.json()
        room_id = room["id"]
        assert room["created_by"] == "murat"
        assert room["is_calendar"] is False
        print("[OK] Murat filmi açtı (yönetici: murat)")

        # Selin durdurur: 120. saniyede olduğunu bildirir
        resp = await client.post(f"/api/cinema/{room_id}/control", json={
            "user_id": "selin",
            "action": "pause",
            "position": 120.0,
        })
        assert resp.status_code == 200
        paused_room = resp.json()
        assert paused_room["is_playing"] is False
        print("[OK] Selin durdurdu, film iki tarafta da durdu")

        # Murat'ın durduğu anki konumu 125.0 saniye olarak sunucuya iletilmiş olsun
        record_device_position(room_id, "murat", 125.0)

        # Selin başlata tıklar
        resp = await client.post(f"/api/cinema/{room_id}/control", json={
            "user_id": "selin",
            "action": "play",
            "position": 120.0,
        })
        assert resp.status_code == 200
        played_room = resp.json()
        assert played_room["is_playing"] is True
        # Filmi açan Murat'a göre eşitlenmeli (125.0s)!
        assert played_room["position"] == 125.0, f"Beklenen 125.0, gelen {played_room['position']}"
        print("[OK] Selin başlata bastığında süre filmi açan Murat'a (125.0s) eşitlendi!")

        # -------------------------------------------------------------
        # TEST 2: Takvim Seansı Senkronizasyonu
        # -------------------------------------------------------------
        print("\n--- TEST 2: Takvim Seansı Senkronizasyonu ---")
        # Takvim seansı ekle
        now_local = datetime.now()
        today_str = now_local.date().isoformat()
        show_resp = await client.post("/api/cinema/calendar", json={
            "title": "Takvim Seans Filmi",
            "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
            "show_date": today_str,
            "show_time": f"{now_local.hour:02d}:{now_local.minute:02d}",
            "created_by": "murat",
        })
        assert show_resp.status_code == 200, show_resp.text
        show = show_resp.json()
        show_id = show["id"]

        # Bilet al ve seansı salonda aç
        await client.post(f"/api/cinema/calendar/{show_id}/ticket", json={"user_id": "murat"})
        open_resp = await client.post(f"/api/cinema/calendar/{show_id}/open", json={"user_id": "murat"})
        assert open_resp.status_code == 200, open_resp.text
        cal_room_id = open_resp.json()["room_id"]

        # Odayı getir ve kontrol et
        r_resp = await client.get("/api/cinema/current")
        assert r_resp.status_code == 200
        cal_room = r_resp.json()
        assert cal_room["id"] == cal_room_id
        assert cal_room["is_calendar"] is True
        assert cal_room["showtime_id"] == show_id
        print("[OK] Takvim salonu açıldı (is_calendar: True, showtime_id ayarlandı)")

        # Takvim salonunda sarma (seek) işlemi denenir -> 400 Bad Request dönmeli!
        seek_resp = await client.post(f"/api/cinema/{cal_room_id}/control", json={
            "user_id": "murat",
            "action": "seek",
            "position": 500.0,
        })
        assert seek_resp.status_code == 400, "Takvim salonunda seek engellenmeliydi!"
        print("[OK] Takvim salonunda ileri/geri sarma engellendi (400 Bad Request)")

        # Kullanıcı senaryosu:
        # Biri 11:08 (668s), diğeri 11:03 (663s) deyken durdurulur
        # Murat durdurur (668s)
        await client.post(f"/api/cinema/{cal_room_id}/control", json={
            "user_id": "murat",
            "action": "pause",
            "position": 668.0,
        })
        # Selin'in durduğu saniye (663s)
        record_device_position(cal_room_id, "selin", 663.0)

        # Başlata basılır:
        # Geride olan kişinin (663s) 3 saniye gerisinden: 663 - 3 = 660s (11:00) başlamalı!
        play_resp = await client.post(f"/api/cinema/{cal_room_id}/control", json={
            "user_id": "murat",
            "action": "play",
        })
        assert play_resp.status_code == 200
        resumed = play_resp.json()
        assert resumed["is_playing"] is True
        assert resumed["position"] == 660.0, f"Beklenen 660.0 (11:00), gelen {resumed['position']}"
        print("[OK] Durdurup başlatıldığında geride olanın (11:03 = 663s) 3 saniye gerisinden (11:00 = 660s) devam etti!")

        # -------------------------------------------------------------
        # TEST 3: Takvim Saati Geldiğinde Otomatik Salon Açma ve Başlatma
        # -------------------------------------------------------------
        print("\n--- TEST 3: Takvim Saati Geldiğinde Otomatik Salon Açma ---")
        # Yeni bir seans ekle: saati şu anki saat olsun
        auto_show_resp = await client.post("/api/cinema/calendar", json={
            "title": "Otomatik Başlayan Gece Seansı",
            "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
            "show_date": today_str,
            "show_time": f"{now_local.hour:02d}:{now_local.minute:02d}",
            "created_by": "murat",
        })
        assert auto_show_resp.status_code == 200
        auto_show = auto_show_resp.json()
        assert auto_show["room_id"] is None

        # Scheduler fonksiyonunu çağır
        await check_and_start_due_showtimes()

        # Seansın room_id'si atanmış mı ve salon otomatik başlamış mı?
        show_check = await client.get(f"/api/cinema/calendar/{auto_show['id']}")
        assert show_check.status_code == 200
        show_data = show_check.json()
        assert show_data["room_id"] is not None
        assert show_data["started_at"] is not None

        # Açılan salonun özelliklerini kontrol et
        auto_room_resp = await client.get("/api/cinema/current")
        assert auto_room_resp.status_code == 200
        auto_room = auto_room_resp.json()
        assert auto_room["id"] == show_data["room_id"]
        assert auto_room["is_calendar"] is True
        assert auto_room["is_playing"] is True
        assert auto_room["is_active"] is True
        assert auto_room["position"] == 0.0
        print("[OK] Seans saati geldiğinde otomatik yeni salon açıldı ve direkt oynatılmaya başlandı!")

    print("\nTÜM SENKRONİZASYON VE TAKVİM TESTLERİ BAŞARIYLA GEÇTİ! 🎉\n")


if __name__ == "__main__":
    asyncio.run(run_tests())
