"""Yeni uçların uçtan uca doğrulaması (yerel, SQLite üzerinde).

Çalıştırma:
    python tests/test_new_features.py
"""

import asyncio
import os
import sys
import tempfile

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

DB_PATH = os.path.join(tempfile.gettempdir(), "ahududu_test_new.db")
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{DB_PATH}"
os.environ["UPLOAD_DIR"] = os.path.join(tempfile.gettempdir(), "ahududu_test_uploads")
os.environ["STATIC_DIR"] = os.path.join(ROOT, "backend", "static")

from fastapi.testclient import TestClient  # noqa: E402

import backend.app.database as db_module  # noqa: E402
from backend.app.database import engine  # noqa: E402

# SQLite için pool ayarları geçersiz olabilir; engine'i yeniden kur
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession  # noqa: E402

test_engine = create_async_engine(os.environ["DATABASE_URL"], echo=False)
db_module.engine = test_engine
db_module.AsyncSessionLocal = async_sessionmaker(bind=test_engine, class_=AsyncSession, expire_on_commit=False)

from backend.app.main import app  # noqa: E402

failures = []


def check(name, condition, detail=""):
    if condition:
        print(f"[OK] {name}")
    else:
        failures.append(f"{name} {detail}")
        print(f"[FAIL] {name} {detail}")


with TestClient(app) as client:
    # ---------------- Anlık Fotoğraf ----------------
    r = client.post("/api/snaps", json={
        "sender": "murat",
        "media_url": "/api/media/file/demo.jpg",
        "media_type": "image",
        "caption": "Şu an seni düşünüyorum",
        "mood": "özledim",
    })
    check("snap create", r.status_code == 200, r.text[:200])
    snap = r.json()
    check("snap has expiry", bool(snap.get("expires_at")))

    r = client.get("/api/snaps")
    check("snap list", r.status_code == 200 and len(r.json()) == 1, r.text[:200])

    r = client.post(f"/api/snaps/{snap['id']}/seen")
    check("snap seen", r.status_code == 200 and r.json()["is_seen"] is True, r.text[:200])

    r = client.get("/api/snaps/feed?user_id=selin")
    feed = r.json() if r.status_code == 200 else {}
    check("snap feed", r.status_code == 200 and feed["partner"]["count"] == 1, r.text[:200])

    r = client.post(f"/api/snaps/{snap['id']}/react", json={"sender": "selin", "reaction": "❤️"})
    check("snap react", r.status_code == 200, r.text[:200])

    r = client.delete(f"/api/snaps/{snap['id']}?user_id=selin")
    check("snap delete forbidden for partner", r.status_code == 403, r.text[:200])
    r = client.delete(f"/api/snaps/{snap['id']}?user_id=murat")
    check("snap delete own", r.status_code == 200, r.text[:200])

    # ---------------- Günlük ----------------
    r = client.post("/api/diary", json={
        "author": "selin",
        "title": "Bugün çok güzeldi",
        "content": "Birlikte kahve içtik.",
        "mood": "mutlu",
        "mood_score": 5,
        "entry_date": "2026-11-14",
    })
    check("diary create", r.status_code == 200, r.text[:200])
    entry = r.json()

    r = client.post("/api/diary", json={
        "author": "selin",
        "title": "Sadece benim",
        "content": "Gizli not",
        "is_locked": True,
        "entry_date": "2026-11-13",
    })
    check("diary locked create", r.status_code == 200, r.text[:200])
    locked = r.json()

    r = client.get("/api/diary?viewer=murat")
    titles = [e["title"] for e in r.json()]
    check("locked diary hidden from partner", "Sadece benim" not in titles, str(titles))
    check("open diary visible", "Bugün çok güzeldi" in titles, str(titles))

    r = client.get("/api/diary?viewer=selin")
    own_titles = [e["title"] for e in r.json()]
    check("locked diary visible to author", "Sadece benim" in own_titles, str(own_titles))

    r = client.put(f"/api/diary/{entry['id']}", json={"title": "Bugün harikaydı"})
    check("diary update", r.status_code == 200 and r.json()["title"] == "Bugün harikaydı", r.text[:200])

    r = client.get("/api/diary/stats")
    check("diary stats", r.status_code == 200 and r.json()["total"] == 2, r.text[:200])

    r = client.delete(f"/api/diary/{locked['id']}")
    check("diary delete", r.status_code == 200, r.text[:200])

    # ---------------- Hayvan Albümü ----------------
    r = client.post("/api/pets", json={
        "name": "Pamuk",
        "category": "köpek",
        "owner": "bizim",
        "bio": "En tatlı kız",
    })
    check("pet create", r.status_code == 200, r.text[:300])
    pet = r.json()
    check("pet emoji auto", pet.get("emoji") == "🐶", str(pet.get("emoji")))

    r = client.post("/api/pets", json={"name": "Mırmır", "category": "kedi"})
    cat = r.json()
    check("second pet emoji", cat.get("emoji") == "🐱", str(cat.get("emoji")))

    r = client.post(f"/api/pets/{pet['id']}/photos", json={
        "uploader": "murat",
        "media_url": "/api/media/file/pamuk1.jpg",
        "caption": "Denizde",
    })
    check("pet photo add", r.status_code == 200, r.text[:300])

    r = client.get("/api/pets")
    pets = r.json()
    check("pet list with photos", r.status_code == 200 and len(pets) == 2, r.text[:300])
    pamuk = next(p for p in pets if p["pet"]["name"] == "Pamuk")
    check("pet photo count", pamuk["photo_count"] == 1, str(pamuk["photo_count"]))
    check("pet cover from first photo", pamuk["pet"]["photo_url"] == "/api/media/file/pamuk1.jpg")

    r = client.get("/api/pets?category=kedi")
    check("pet category filter", len(r.json()) == 1 and r.json()[0]["pet"]["name"] == "Mırmır", r.text[:200])

    r = client.put(f"/api/pets/{pet['id']}", json={"category": "kuş"})
    check("pet update re-emoji", r.json().get("emoji") == "🐦", r.text[:200])

    r = client.delete(f"/api/pets/{cat['id']}")
    check("pet delete", r.status_code == 200, r.text[:200])

    # ---------------- Sinema Salonu ----------------
    resolve_cases = {
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ": "youtube",
        "https://youtu.be/dQw4w9WgXcQ?t=42": "youtube",
        "https://vimeo.com/123456789": "vimeo",
        "https://www.dailymotion.com/video/x8abcd1": "dailymotion",
        "https://www.bilibili.com/video/BV1xx411c7mD": "bilibili",
        "https://ok.ru/video/1234567890": "okru",
        "https://streamable.com/abcd12": "streamable",
        "https://www.twitch.tv/somechannel": "twitch",
        "https://example.com/movie.mp4": "link",
        "https://cdn.example.com/hls/stream.m3u8": "link",
    }
    for url, expected in resolve_cases.items():
        r = client.post("/api/cinema/resolve", json={"video_url": url})
        got = r.json().get("source") if r.status_code == 200 else r.text
        check(f"resolve {expected}", got == expected, f"{url} -> {got}")

    r = client.post("/api/cinema/resolve", json={"video_url": "https://youtu.be/dQw4w9WgXcQ?t=42"})
    embed = r.json().get("embed_url", "")
    check("youtube embed with start", "embed/dQw4w9WgXcQ" in embed and "start=42" in embed, embed)

    r = client.post("/api/cinema", json={
        "title": "Inception",
        "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
        "created_by": "murat",
    })
    check("cinema create", r.status_code == 200, r.text[:300])
    room = r.json()

    r = client.post("/api/cinema", json={
        "title": "Inception",
        "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
        "created_by": "selin",
    })
    check("cinema dedupe same link", r.json()["id"] == room["id"], r.text[:200])

    r = client.post(f"/api/cinema/{room['id']}/start", json={"user_id": "murat"})
    check("cinema start", r.status_code == 200 and r.json()["is_active"] is True, r.text[:200])

    r = client.post(f"/api/cinema/{room['id']}/control", json={
        "user_id": "murat", "action": "play", "position": 12.5, "duration": 8880,
    })
    check("cinema control play", r.status_code == 200 and abs(r.json()["position"] - 12.5) < 0.01, r.text[:200])

    r = client.post(f"/api/cinema/{room['id']}/control", json={
        "user_id": "selin", "action": "pause", "position": 30.0,
    })
    body = r.json()
    check("cinema pause syncs position", body["is_playing"] is False and abs(body["position"] - 30.0) < 0.01, r.text[:200])

    r = client.get("/api/cinema/current")
    check("cinema current room", r.status_code == 200 and r.json() and r.json()["id"] == room["id"], r.text[:200])

    r = client.get(f"/api/cinema/{room['id']}/embed")
    check("cinema embed html", "iframe" in (r.json().get("html") or ""), r.text[:200])

    r = client.post(f"/api/cinema/{room['id']}/control", json={"user_id": "murat", "action": "stop"})
    check("cinema stop", r.json()["is_active"] is False, r.text[:200])

    r = client.delete(f"/api/cinema/{room['id']}")
    check("cinema delete", r.status_code == 200, r.text[:200])

    # ---------------- Regresyon: mevcut uçlar hâlâ çalışıyor ----------------
    for path in ["/api/system/version", "/api/auth/profiles", "/api/letters", "/api/chat/messages", "/api/gallery", "/api/notes"]:
        r = client.get(path)
        check(f"regression {path}", r.status_code == 200, r.text[:150])

    version = client.get("/api/system/version").json()
    for feature in ["snap_stories", "shared_diary", "pet_album", "cinema_salonu"]:
        check(f"feature flag {feature}", feature in version["features"], str(version["features"]))

asyncio.run(test_engine.dispose())

print()
if failures:
    print(f"{len(failures)} SORUN:")
    for f in failures:
        print(" -", f)
    sys.exit(1)
print("TÜM YENİ ÖZELLİK UÇLARI ÇALIŞIYOR ✅")
sys.exit(0)
