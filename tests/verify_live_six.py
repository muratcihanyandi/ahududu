"""Canlı sunucuda 6 görevin uçtan uca doğrulaması."""

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
    with urllib.request.urlopen(req, timeout=25) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def check(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


# G5: Telsiz özelliği kaldırıldı
version = call("/api/system/version")
check("G5: walkie_talkie özelliği kaldırıldı", "walkie_talkie" not in version["features"],
      str(version["features"]))
check("G6: yeni özellik bayrakları", "cinema_salonu" in version["features"])

# G6: Bahçe özellikleri (canlı PostgreSQL)
try:
    q = call("/api/garden/question?viewer=murat")
    check("G6: günün sorusu", bool(q.get("prompt")) and q.get("demo") is True, str(q)[:200])

    summary = call("/api/garden/summary?viewer=murat")
    check("G6: bahçe özeti", summary.get("demo") is True, str(summary)[:200])

    mood = call("/api/garden/mood?user_id=murat")
    check("G6: duygu havası", "history" in mood and mood.get("demo") is True, str(mood)[:200])

    songs = call("/api/garden/songs")
    check("G6: şarkılar ucu", isinstance(songs, list), str(songs)[:100])

    capsules = call("/api/garden/capsules?viewer=murat")
    check("G6: kapsüller ucu", isinstance(capsules, list), str(capsules)[:100])

    otd = call("/api/garden/on-this-day")
    check("G6: yıllar önce bugün", otd.get("demo") is True, str(otd)[:150])
except Exception as e:
    check("G6: bahçe uçları", False, str(e))

# G1 + G4: Sinema takvimi ve film çözümleme
try:
    cal = call("/api/cinema/calendar")
    check("G1: takvim ucu", isinstance(cal, list), str(cal)[:100])

    # Film sitesi çözümleme (gerçek film linki)
    resolved = call("/api/cinema/resolve", "POST",
                    {"video_url": "https://www.fullhdfilmizlesene.now/film/arabalar/"})
    print("       film çözümleme:", json.dumps(resolved, ensure_ascii=False)[:260])
    check("G4: film sitesinden video yakalama",
          bool(resolved.get("embed_url")) or resolved.get("kind") == "file",
          str(resolved)[:250])
except Exception as e:
    check("G1/G4: sinema uçları", False, str(e))

# G2/G3: Arayüz metinlerinde teknik kelime yok
try:
    with urllib.request.urlopen(BASE + "/", timeout=15) as res:
        html = res.read().decode("utf-8", errors="replace")
    check("G3: ana sayfa HTML'de OpenClaw yok", "OpenClaw" not in html and "openclaw" not in html.lower())
except Exception as e:
    check("G3: ana sayfa HTML", False, str(e))

# Regresyon
for path in ["/api/snaps", "/api/diary", "/api/pets", "/api/letters", "/api/chat/messages", "/api/gallery"]:
    try:
        call(path)
        check(f"regresyon {path}", True)
    except Exception as e:
        check(f"regresyon {path}", False, str(e))

print()
if failures:
    print(f"{len(failures)} SORUN: {', '.join(failures)}")
    sys.exit(1)
print("CANLIDA 6 GÖREV DOĞRULANDI ✅")
