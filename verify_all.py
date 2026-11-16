import sys
import json
import urllib.request
import urllib.error

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = 'http://192.168.2.170:33470'

failures = []


def check(name, path, method='GET', data=None):
    url = f"{BASE}{path}"
    req = urllib.request.Request(
        url,
        data=json.dumps(data).encode('utf-8') if data else None,
        headers={'Content-Type': 'application/json'} if data else {},
        method=method
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as res:
            raw = res.read().decode('utf-8')
            try:
                parsed = json.loads(raw)
                print(f"[OK] {name}: {json.dumps(parsed, ensure_ascii=False)[:100]}...")
            except Exception:
                print(f"[OK] {name}: HTML/Raw response ({len(raw)} bytes)")
    except Exception as e:
        failures.append(f"{name}: {e}")
        print(f"[FAIL] {name}: {e}")


def check_api_removed(name, path):
    """Kaldırılan API uçlarının artık SPA yanıtına düştüğünü doğrular.

    API rotası yoksa catch-all route index.html döndürür; JSON dönerse uç hala yaşıyordur.
    """
    url = f"{BASE}{path}"
    try:
        with urllib.request.urlopen(url, timeout=5) as res:
            content_type = res.headers.get("Content-Type", "")
            raw = res.read().decode('utf-8', errors='replace')
        if "application/json" in content_type:
            failures.append(f"{name}: hala JSON yanıt veriyor -> {raw[:80]}")
            print(f"[FAIL] {name}: hala aktif")
        else:
            print(f"[OK] {name}: kaldırıldı")
    except urllib.error.HTTPError as e:
        if e.code in (404, 405):
            print(f"[OK] {name}: kaldırıldı ({e.code})")
        else:
            failures.append(f"{name}: beklenmeyen durum kodu {e.code}")
            print(f"[FAIL] {name}: {e.code}")
    except Exception as e:
        failures.append(f"{name}: {e}")
        print(f"[FAIL] {name}: {e}")


print("=== VERIFYING AHUDUDU PRODUCTION ON RASPBERRY PI 5 ===")
check("System Version", "/api/system/version")
check("Profiles List", "/api/auth/profiles")
check("Murat Profile", "/api/auth/profile/murat")
check("Selin Profile", "/api/auth/profile/selin")
check("Couple Status", "/api/location/couple-status")
check("Letters List", "/api/letters")
check("Chat Messages", "/api/chat/messages")
check("Gallery Items", "/api/gallery")
check("Shared Notes", "/api/notes")
# Yeni özellikler
check("Anlık Fotoğraflar", "/api/snaps")
check("An Akışı", "/api/snaps/feed?user_id=murat")
check("Günlük", "/api/diary")
check("Günlük İstatistikleri", "/api/diary/stats")
check("Hayvan Albümü", "/api/pets")
check("Hayvan Kategorileri", "/api/pets/categories")
check("Sinema Salonları", "/api/cinema")
check("Frontend Web App", "/")

check_api_removed("Watch Biometrics Removed", "/api/watch/biometrics/murat")
check_api_removed("Watch Route Removed", "/api/watch/nudge")

if failures:
    print("\nSORUNLAR:")
    for failure in failures:
        print(f" - {failure}")
    sys.exit(1)

print("\nALL SYSTEMS FULLY OPERATIONAL!")
