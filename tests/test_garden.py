"""Bahçe (My Bibi esintili demo özellikler) API testleri."""

import json
import os
import sys
import tempfile

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

DB_PATH = os.path.join(tempfile.gettempdir(), "ahududu_test_garden.db")
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
    # ---- Günlük Soru ----
    r = client.get("/api/garden/question?viewer=murat")
    check("günlük soru", r.status_code == 200 and r.json()["prompt"], r.text[:200])
    q = r.json()
    check("demo etiketi", q.get("demo") is True)

    r = client.post("/api/garden/question/answer", json={"user_id": "murat", "answer": "Deniz kenarı"})
    check("soru cevaplama", r.status_code == 200, r.text[:200])

    r = client.get("/api/garden/question?viewer=murat")
    q = r.json()
    check("kendi cevabım görünür", q["my_answer"] == "Deniz kenarı", str(q)[:200])
    check("partner cevabı gizli", q["partner_answer"] is None, str(q)[:200])
    check("henüz ikisi de yok", q["both_answered"] is False)

    client.post("/api/garden/question/answer", json={"user_id": "selin", "answer": "Yıldızlar"})
    r = client.get("/api/garden/question?viewer=murat")
    q = r.json()
    check("ikisi cevaplayınca açılır", q["both_answered"] is True and q["partner_answer"] == "Yıldızlar",
          str(q)[:250])

    # ---- Zaman Kapsülü ----
    r = client.post("/api/garden/capsules", json={
        "sender": "murat", "title": "Doğum günün için",
        "content": "Bu mesajı o gün okuyacaksın ❤️",
        "open_date": "2030-01-01T00:00:00",
    })
    check("kapsül oluşturma", r.status_code == 200, r.text[:200])
    capsule_id = r.json()["id"]

    r = client.get("/api/garden/capsules?viewer=selin")
    caps = r.json()
    check("kapsül listeleniyor", len(caps) == 1, str(caps)[:200])
    check("erken açılamaz", caps[0]["can_open"] is False and caps[0]["content"] is None, str(caps[0])[:200])

    r = client.post("/api/garden/capsules", json={
        "sender": "murat", "title": "Geçmiş", "content": "açık",
        "open_date": "2020-01-01T00:00:00",
    })
    check("geçmiş tarihli kapsül", r.status_code == 200)

    r = client.get("/api/garden/capsules?viewer=selin")
    opened = [c for c in r.json() if c["can_open"]]
    check("vadesi gelince açılır", len(opened) == 1 and opened[0]["content"] == "açık", str(opened)[:200])

    r = client.delete(f"/api/garden/capsules/{capsule_id}?user_id=selin")
    check("başkasının kapsülü silinemez", r.status_code == 403, r.text[:150])

    # ---- Şarkılar ----
    r = client.post("/api/garden/songs", json={
        "added_by": "selin", "title": "Perfect", "artist": "Ed Sheeran",
        "url": "https://www.youtube.com/watch?v=2Vv-BfVoq4g", "note": "İlk dansımız",
    })
    check("şarkı ekleme", r.status_code == 200, r.text[:200])

    r = client.get("/api/garden/songs")
    songs = r.json()
    check("şarkı listesi", len(songs) == 1 and songs[0]["title"] == "Perfect", str(songs)[:200])
    check("şarkı demo etiketi", songs[0].get("demo") is True)

    # ---- Bugün Yıllar Önce ----
    r = client.get("/api/garden/on-this-day")
    check("bugün yıllar önce", r.status_code == 200 and "items" in r.json(), r.text[:200])

    # ---- Duygu Havası ----
    r = client.post("/api/garden/mood", json={"user_id": "murat", "mood": "sunny"})
    check("hava seçimi", r.status_code == 200, r.text[:200])

    r = client.post("/api/garden/mood", json={"user_id": "murat", "mood": "saçma"})
    check("geçersiz hava reddedildi", r.status_code == 400, r.text[:150])

    r = client.get("/api/garden/mood?user_id=murat")
    mood = r.json()
    check("hava bugün kayıtlı", mood["today"] == "sunny", str(mood)[:200])
    check("hava geçmişi", len(mood["history"]) == 1, str(mood)[:200])

    # ---- Özet ----
    r = client.get("/api/garden/summary?viewer=murat")
    summary = r.json()
    check("bahçe özeti", r.status_code == 200 and summary["demo"] is True, r.text[:250])
    check("soru bekliyor değil", summary["question_pending"] is False, str(summary)[:200])
    check("bekleyen kapsül", summary["waiting_capsules"] == 1, str(summary)[:200])
    check("şarkı sayısı", summary["song_count"] == 1, str(summary)[:200])

    # ---- Regresyon ----
    for path in ["/api/system/version", "/api/auth/profiles", "/api/letters", "/api/chat/messages",
                 "/api/snaps", "/api/diary", "/api/pets", "/api/cinema/calendar"]:
        r = client.get(path)
        check(f"regresyon {path}", r.status_code == 200, r.text[:120])

import asyncio  # noqa: E402

asyncio.run(engine.dispose())

print()
if failures:
    print(f"{len(failures)} SORUN: {', '.join(failures)}")
    sys.exit(1)
print("BAHÇE ÖZELLİKLERİ ÇALIŞIYOR ✅")
sys.exit(0)
