"""Sinema Takvimi uçlarının doğrulaması (yerel, SQLite)."""

import json
import os
import sys
import tempfile
import urllib.error

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

DB_PATH = os.path.join(tempfile.gettempdir(), "ahududu_test_calendar.db")
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{DB_PATH}"
os.environ["UPLOAD_DIR"] = os.path.join(tempfile.gettempdir(), "ahududu_test_uploads")
os.environ["STATIC_DIR"] = os.path.join(ROOT, "frontend", "dist")

from fastapi.testclient import TestClient  # noqa: E402
import backend.app.database as db_module  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession  # noqa: E402

engine = create_async_engine(os.environ["DATABASE_URL"], echo=False)
db_module.engine = engine
db_module.AsyncSessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

from backend.app.main import app  # noqa: E402

failures = []


def check(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


with TestClient(app) as client:
    # --- Manuel ekleme ---
    r = client.post("/api/cinema/calendar", json={
        "title": "Inception",
        "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
        "show_date": "2026-11-20",
        "show_time": "21:00",
        "created_by": "murat",
    })
    check("manuel seans ekleme", r.status_code == 200, r.text[:250])
    show = r.json()
    check("youtube otomatik çözümlendi", show["source"] == "youtube", str(show.get("source")))
    check("afiş otomatik geldi", bool(show.get("poster_url")), str(show.get("poster_url")))

    # --- Listeleme ---
    r = client.get("/api/cinema/calendar?month=2026-11&viewer=murat")
    check("takvim listesi", r.status_code == 200 and len(r.json()) == 1, r.text[:200])

    # --- Bilet ---
    r = client.post(f"/api/cinema/calendar/{show['id']}/ticket", json={"user_id": "selin"})
    check("bilet alma", r.status_code == 200 and "selin" in r.json()["booked_by"], r.text[:250])
    check("bilet kodu üretildi", bool(r.json().get("ticket_code")), str(r.json().get("ticket_code")))

    r = client.post(f"/api/cinema/calendar/{show['id']}/ticket", json={"user_id": "murat"})
    check("ikinci bilet", r.status_code == 200 and r.json()["booked_count"] == 2, r.text[:250])

    r = client.post(f"/api/cinema/calendar/{show['id']}/ticket", json={"user_id": "murat"})
    check("çift bilet reddedildi", r.status_code == 400, r.text[:200])

    r = client.get(f"/api/cinema/calendar/{show['id']}?viewer=selin")
    check("viewer bilet görünümü", r.json()["my_ticket"] is True and r.json()["partner_ticket"] is True, r.text[:250])

    # --- Biletsiz seansı açma reddi ---
    r = client.post("/api/cinema/calendar", json={
        "title": "Biletsiz Film", "video_url": "https://vimeo.com/123456789",
        "show_date": "2026-11-21", "show_time": "20:00",
    })
    biletsiz = r.json()
    client.post(f"/api/cinema/calendar/{biletsiz['id']}/ticket", json={"user_id": "murat"})
    r = client.post(f"/api/cinema/calendar/{biletsiz['id']}/open", json={"user_id": "selin"})
    check("biletsiz giriş reddedildi", r.status_code == 403, r.text[:200])

    # --- Seansı salonda açma ---
    r = client.post(f"/api/cinema/calendar/{show['id']}/open", json={"user_id": "murat"})
    check("seansı salonda açma", r.status_code == 200 and r.json()["room_id"], r.text[:250])
    room_id = r.json()["room_id"]

    r = client.get("/api/cinema/current")
    check("salon aktif", r.status_code == 200 and r.json() and r.json()["id"] == room_id, r.text[:200])
    check("salon başlığı takvimden", r.json()["title"] == "Inception", str(r.json()["title"]))

    # --- Takvim zenginliği: yarın / bu akşam ---
    r = client.get("/api/cinema/calendar/next?viewer=murat")
    check("sonraki seans", r.status_code == 200, r.text[:200])

    # --- OpenClaw toplu import ---
    r = client.post("/api/cinema/calendar/import", json={
        "month": "2026-12",
        "replace_existing": True,
        "created_by": "openclaw",
        "showtimes": [
            {"title": "Film A", "video_url": "https://youtu.be/dQw4w9WgXcQ", "show_date": "2026-12-05", "show_time": "21:00"},
            {"title": "Film B", "video_url": "https://vimeo.com/111222333", "show_date": "2026-12-12", "show_time": "21:30"},
            {"title": "Film C", "video_url": "https://example.com/movie.mp4", "show_date": "2026-12-20", "show_time": "20:00"},
        ],
    })
    check("OpenClaw toplu import", r.status_code == 200 and r.json()["created"] == 3, r.text[:300])

    r = client.get("/api/cinema/calendar?month=2026-12")
    check("import edilen ay listelendi", len(r.json()) == 3, r.text[:200])
    check("import sıralı", [s["title"] for s in r.json()] == ["Film A", "Film B", "Film C"],
          str([s["title"] for s in r.json()]))

    # --- Otomatik plan ---
    r = client.post("/api/cinema/calendar/auto-schedule", json={
        "month": "2027-01",
        "day": 8,
        "time": "21:00",
        "replace_existing": True,
        "films": [
            {"title": "Oto 1", "video_url": "https://youtu.be/dQw4w9WgXcQ"},
            {"title": "Oto 2", "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0"},
        ],
    })
    check("otomatik plan", r.status_code == 200 and r.json()["created"] == 2, r.text[:250])
    dates = [s["show_date"] for s in r.json()["showtimes"]]
    check("tarihler dağıtıldı", dates == ["2027-01-08", "2027-01-12"], str(dates))

    # --- Export ---
    r = client.get("/api/cinema/calendar/export?month=2026-12")
    check("takvim dışa aktarma", r.status_code == 200 and r.json()["count"] == 3, r.text[:200])

    # --- Güncelleme ---
    r = client.put(f"/api/cinema/calendar/{biletsiz['id']}", json={"show_time": "22:30", "title": "Biletsiz Film v2"})
    check("seans güncelleme", r.status_code == 200 and r.json()["show_time"] == "22:30", r.text[:250])

    # --- Silme ---
    r = client.delete(f"/api/cinema/calendar/{biletsiz['id']}")
    check("seans silme", r.status_code == 200, r.text[:200])

    # --- Hatalı girdiler ---
    r = client.post("/api/cinema/calendar", json={
        "title": "Kötü Tarih", "video_url": "https://youtu.be/dQw4w9WgXcQ",
        "show_date": "20.11.2026",
    })
    check("geçersiz tarih reddedildi", r.status_code == 400, r.text[:200])

asyncio_engine = engine
import asyncio  # noqa: E402

asyncio.run(asyncio_engine.dispose())

print()
if failures:
    print(f"{len(failures)} SORUN: {', '.join(failures)}")
    sys.exit(1)
print("SİNEMA TAKVİMİ API'LERİ ÇALIŞIYOR ✅")
sys.exit(0)
