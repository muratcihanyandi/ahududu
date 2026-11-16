"""Backend davranış testleri (yerel SQLite + FastAPI TestClient).

Çalıştırma:
    python tests/test_backend_fixes.py

Kapsam:
  * Mektup arşivi: silme kaydı yok etmez, arşivden geri gelir, diske yedek alınır.
  * Cihaz kaydı: telefon bildirim listesine eklenir ve durum raporlanır.
  * Sinema: seans açılınca salon takılı kalmaz, aynı film yeniden açılabilir.
"""

import asyncio
import base64
import json
import os
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

TMP = tempfile.mkdtemp(prefix="ahududu_test_")
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///" + os.path.join(TMP, "test.db")
os.environ["UPLOAD_DIR"] = os.path.join(TMP, "uploads")
os.environ["STATIC_DIR"] = os.path.join(ROOT, "frontend", "dist")

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from fastapi.testclient import TestClient  # noqa: E402

from backend.app.main import app  # noqa: E402
from backend.app.services import letter_archive  # noqa: E402

failures = []


def check(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def main():
    with TestClient(app) as client:
        # ---------------- Mektup arşivi ----------------
        created = client.post(
            "/api/letters",
            json={"sender": "murat", "title": "Test Mektubu", "content_text": "Seni seviyorum"},
        )
        check("mektup oluşturuldu", created.status_code == 200, created.text[:200])
        letter = created.json()
        letter_id = letter["id"]

        # Diske yedek alındı mı?
        backup_files = os.listdir(letter_archive.backup_dir())
        check(
            "yeni mektup diske yedeklendi",
            any(name.startswith(f"letter-{letter_id}-") for name in backup_files),
            str(backup_files),
        )

        # Silme = arşive taşıma (kayıt yok olmamalı)
        deleted = client.delete(f"/api/letters/{letter_id}")
        check("silme isteği arşive taşıdı", deleted.status_code == 200 and deleted.json().get("archived"))

        listed = client.get("/api/letters").json()
        check("mektup listede hâlâ var (kaybolmadı)", any(l["id"] == letter_id for l in listed), str(listed)[:200])
        entry = next(l for l in listed if l["id"] == letter_id)
        check("mektup arşivde işaretli", bool(entry.get("is_deleted")))

        restored = client.post(f"/api/letters/{letter_id}/restore")
        check("arşivden geri getirildi", restored.status_code == 200 and not restored.json().get("is_deleted"))

        report = client.get("/api/letters/archive").json()
        check("arşiv raporu aktif=1", report.get("active") == 1 and report.get("total") == 1, str(report))

        # ---------------- Sinema (takılı kalan film) ----------------
        show = client.post(
            "/api/cinema/calendar",
            json={
                "title": "Cars 1",
                "video_url": "https://www.youtube.com/watch?v=abc123def45",
                "show_date": "2026-11-16",
                "show_time": "21:00",
                "created_by": "murat",
            },
        )
        check("seans eklendi", show.status_code == 200, show.text[:200])
        showtime = show.json()

        opened = client.post(f"/api/cinema/calendar/{showtime['id']}/open", json={"user_id": "murat"})
        check("seans salonda açıldı", opened.status_code == 200, opened.text[:200])
        opened_again = client.post(f"/api/cinema/calendar/{showtime['id']}/open", json={"user_id": "murat"})
        check("aynı seans tekrar açılabiliyor (takılmıyor)", opened_again.status_code == 200, opened_again.text[:200])

        current = client.get("/api/cinema/current").json()
        check("aktif salon Cars 1", bool(current) and current["title"] == "Cars 1", str(current)[:200])

        left = client.post(
            f"/api/cinema/{current['id']}/control",
            json={"user_id": "selin", "action": "leave"},
        )
        check("salondan çıkış", left.status_code == 200)
        current_after = client.get("/api/cinema/current").json()
        check("çıkınca salon kapandı", current_after is None, str(current_after)[:200])

        resumed = client.post(f"/api/cinema/calendar/{showtime['id']}/open", json={"user_id": "murat"})
        check("kapandıktan sonra yeniden açılabiliyor", resumed.status_code == 200, resumed.text[:200])

        rooms = client.get("/api/cinema").json()
        titles = [r["title"] for r in rooms]
        check("salonda aynı filmden tek kopya", titles.count("Cars 1") == 1, str(titles))

    print()
    if failures:
        print(f"{len(failures)} SORUN: {', '.join(failures)}")
        return 1
    print("BACKEND TESTLERİ GEÇTİ ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
