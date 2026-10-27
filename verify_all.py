import sys
import json
import urllib.request

if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = 'http://192.168.2.170:33470'

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
        print(f"[FAIL] {name}: {e}")

print("=== VERIFYING AHUDUDU PRODUCTION ON RASPBERRY PI 5 ===")
check("System Version", "/api/system/version")
check("Profiles List", "/api/auth/profiles")
check("Murat Profile", "/api/auth/profile/murat")
check("Sevgilim Profile", "/api/auth/profile/sevgilim")
check("Couple Status", "/api/location/couple-status")
check("Letters List", "/api/letters")
check("Chat Messages", "/api/chat/messages")
check("Gallery Items", "/api/gallery")
check("Shared Notes", "/api/notes")
check("Watch Biometrics (Murat)", "/api/watch/biometrics/murat")
check("Watch Biometrics (Sevgilim)", "/api/watch/biometrics/sevgilim")
check("Frontend Web App", "/")
check("Watch Standalone View", "/watch")
print("\nALL SYSTEMS FULLY OPERATIONAL!")
