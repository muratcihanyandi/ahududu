"""Canlı Pi üzerinde yeni özelliklerin uçtan uca doğrulaması (gerçek PostgreSQL)."""

import json
import sys
import urllib.error
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
    with urllib.request.urlopen(req, timeout=15) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def check(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


# 1) YouTube linki çözümleme (canlı)
try:
    resolved = call("/api/cinema/resolve", "POST",
                    {"video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0"})
    check("YouTube çözümleme", resolved.get("source") == "youtube"
          and "embed/YoHD9XEInc0" in (resolved.get("embed_url") or ""), str(resolved)[:150])
except Exception as e:
    check("YouTube çözümleme", False, str(e))

# 2) Oda oluştur → embed → başlat → duraklat → sür
try:
    room = call("/api/cinema", "POST", {
        "title": "Canlı Doğrulama Filmi",
        "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
        "created_by": "murat",
    })
    check("Salon oluşturma", room.get("kind") == "embed", str(room)[:150])

    embed = call(f"/api/cinema/{room['id']}/embed")
    check("Gömme (iframe) adresi", "iframe" in (embed.get("html") or ""), str(embed)[:150])

    started = call(f"/api/cinema/{room['id']}/start", "POST", {"user_id": "murat"})
    check("Film başlatma", started.get("is_active") is True, str(started)[:150])

    paused = call(f"/api/cinema/{room['id']}/control", "POST",
                  {"user_id": "selin", "action": "pause", "position": 42.0})
    check("Partner duraklatma", paused.get("is_playing") is False
          and abs(paused.get("position", 0) - 42.0) < 0.01, str(paused)[:150])

    call(f"/api/cinema/{room['id']}", "DELETE")
    check("Salon temizliği", True)
except Exception as e:
    check("Sinema canlı akışı", False, str(e))

# 3) Hayvan albümü (canlı PostgreSQL)
try:
    pet = call("/api/pets", "POST", {"name": "Doğrulama Kedisi", "category": "kedi", "owner": "bizim"})
    check("Hayvan ekleme", pet.get("emoji") == "🐱", str(pet)[:150])
    call(f"/api/pets/{pet['id']}", "DELETE")
    check("Hayvan silme", True)
except Exception as e:
    check("Hayvan albümü", False, str(e))

# 4) Günlük (canlı)
try:
    entry = call("/api/diary", "POST", {
        "author": "murat", "title": "Canlı Doğrulama", "content": "test",
        "mood": "mutlu", "entry_date": "2026-11-15",
    })
    check("Günlük yazma", entry.get("id") is not None, str(entry)[:150])
    call(f"/api/diary/{entry['id']}", "DELETE")
    check("Günlük silme", True)
except Exception as e:
    check("Günlük", False, str(e))

# 5) Anlık fotoğraf (canlı)
try:
    snap = call("/api/snaps", "POST", {
        "sender": "murat", "media_url": "/logo.png", "media_type": "image", "mood": "mutlu",
    })
    check("An paylaşma", snap.get("id") is not None, str(snap)[:150])
    call(f"/api/snaps/{snap['id']}?user_id=murat", "DELETE")
    check("An silme", True)
except Exception as e:
    check("Anlık fotoğraf", False, str(e))

# 6) Regresyon: eski uçlar
for path in ["/api/auth/profiles", "/api/letters", "/api/chat/messages", "/api/gallery", "/api/notes"]:
    try:
        call(path)
        check(f"regresyon {path}", True)
    except Exception as e:
        check(f"regresyon {path}", False, str(e))

# 7) Medya HEAD + Range desteği (video oynatma için kritik)
try:
    import tempfile, os as _os
    # Küçük bir dosyayı /api/media/upload ile yükle, sonra HEAD ile sor
    boundary = "----AhududuVerify"
    payload = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="media_category"\r\n\r\n'
        "verify\r\n"
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="verify.txt"\r\n'
        "Content-Type: text/plain\r\n\r\n"
        "merhaba ahududu\r\n"
        f"--{boundary}--\r\n"
    ).encode()
    req = urllib.request.Request(
        BASE + "/api/media/upload", data=payload, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        uploaded = json.loads(res.read().decode())
    media_path = uploaded["url"]

    req = urllib.request.Request(BASE + media_path, method="HEAD")
    with urllib.request.urlopen(req, timeout=10) as res:
        check("Medya HEAD destekleniyor", res.status == 200,
              f"status={res.status} accept-ranges={res.headers.get('Accept-Ranges')}")
        check("Medya Range (parça) destekliyor", res.headers.get("Accept-Ranges") == "bytes",
              str(res.headers.get("Accept-Ranges")))
except Exception as e:
    check("Medya HEAD destekleniyor", False, str(e))

print()
if failures:
    print(f"{len(failures)} SORUN: {', '.join(failures)}")
    sys.exit(1)
print("CANLI SUNUCUDA TÜM YENİ ÖZELLİKLER ÇALIŞIYOR ✅")
