"""Canlı Pi üzerinde 4 görevin uçtan uca doğrulaması (gerçek PostgreSQL)."""

import datetime
import json
import sys
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://192.168.2.170:33470"
failures = []


def call(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        BASE + path, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def check(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


today = datetime.date.today().isoformat()
month = today[:7]
created_ids = []
room_id = None

try:
    # 1) OpenClaw tarzı bütün ayı ayarlama
    imp = call("/api/cinema/calendar/import", "POST", {
        "month": month,
        "replace_existing": False,
        "created_by": "openclaw",
        "showtimes": [{
            "title": "Canlı Takvim Doğrulama Filmi",
            "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
            "show_date": today,
            "show_time": "21:00",
            "description": "Otomatik doğrulama",
        }],
    })
    check("OpenClaw import (canlı)", imp.get("created") == 1, str(imp)[:250])
    created_ids = [s["id"] for s in imp.get("showtimes", [])]

    # 2) Takvimde görünüyor mu
    shows = call(f"/api/cinema/calendar?month={month}&viewer=murat")
    mine = [s for s in shows if s["title"] == "Canlı Takvim Doğrulama Filmi"]
    check("Takvimde listeleniyor", len(mine) == 1, str([s["title"] for s in shows]))
    show = mine[0] if mine else None
    check("YouTube afişi geldi", bool(show and show.get("poster_url")), str(show.get("poster_url")))

    # 3) Bu akşam / sıradaki
    tonight = call(f"/api/cinema/calendar/tonight?viewer=murat")
    check("Bu akşam seansı", bool(tonight and tonight["id"] == show["id"]), str(tonight)[:200])

    # 4) Bilet
    t1 = call(f"/api/cinema/calendar/{show['id']}/ticket", "POST", {"user_id": "selin"})
    check("Selin bilet aldı", t1.get("booked_count") == 1 and t1.get("ticket_code"), str(t1)[:250])

    t2 = call(f"/api/cinema/calendar/{show['id']}/ticket", "POST", {"user_id": "murat"})
    check("Murat bilet aldı", t2.get("booked_count") == 2, str(t2)[:250])
    check("Bilet kodu AHU-", (t2.get("ticket_code") or "").startswith("AHU-"), str(t2.get("ticket_code")))

    # 5) Salona gir
    opened = call(f"/api/cinema/calendar/{show['id']}/open", "POST", {"user_id": "murat"})
    room_id = opened.get("room_id")
    check("Seans salonda açıldı", bool(room_id), str(opened)[:250])

    current = call("/api/cinema/current")
    check("Aktif salon", bool(current and current["id"] == room_id), str(current)[:200])
    check("Salon başlığı takvimden", bool(current and current["title"] == "Canlı Takvim Doğrulama Filmi"),
          str(current.get("title") if current else None))

    # 6) Senkron komutları
    paused = call(f"/api/cinema/{room_id}/control", "POST",
                  {"user_id": "selin", "action": "pause", "position": 7.5})
    check("Partner duraklatma senkron", paused.get("is_playing") is False
          and abs(paused.get("position", 0) - 7.5) < 0.01, str(paused)[:200])

    playing = call(f"/api/cinema/{room_id}/control", "POST",
                   {"user_id": "murat", "action": "play", "position": 7.5})
    check("Oynatma senkron", playing.get("is_playing") is True, str(playing)[:200])

    embed = call(f"/api/cinema/{room_id}/embed")
    check("Gömme oynatıcı hazır", "iframe" in (embed.get("html") or ""), str(embed)[:200])

finally:
    # Temizlik: canlı veriyi kirletmeyelim
    if room_id:
        try:
            call(f"/api/cinema/{room_id}/control", "POST", {"user_id": "murat", "action": "stop"})
            call(f"/api/cinema/{room_id}", "DELETE")
        except Exception:
            pass
    for sid in created_ids:
        try:
            call(f"/api/cinema/calendar/{sid}", "DELETE")
        except Exception:
            pass
    remaining = call(f"/api/cinema/calendar?month={month}")
    check("Test verisi temizlendi",
          not [s for s in remaining if s["title"] == "Canlı Takvim Doğrulama Filmi"],
          str([s["title"] for s in remaining]))

# Regresyon: eski uçlar
for path in ["/api/snaps", "/api/diary", "/api/pets", "/api/letters", "/api/chat/messages"]:
    try:
        call(path)
        check(f"regresyon {path}", True)
    except Exception as e:
        check(f"regresyon {path}", False, str(e))

print()
if failures:
    print(f"{len(failures)} SORUN: {', '.join(failures)}")
    sys.exit(1)
print("CANLIDA 4 GÖREV + SİNEMA TAKVİMİ ÇALIŞIYOR ✅")
