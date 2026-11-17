"""playmix.uno akışı sunucudan tamamen alınabiliyor mu? (segment dahil)"""

import sys
import urllib.error
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
MASTER = "https://hls8.playmix.uno/hls/filmakinesimp4-f9gx1M12BwC.mp4/master.txt"

CASES = {
    "referer mobi": {"Referer": "https://hdfilmcehennemi.mobi/"},
    "referer yok": {},
    "referer playmix": {"Referer": "https://hls8.playmix.uno/"},
}

for label, extra in CASES.items():
    headers = {"User-Agent": UA, "Accept": "*/*"}
    headers.update(extra)
    try:
        req = urllib.request.Request(MASTER, headers=headers)
        with urllib.request.urlopen(req, timeout=25) as res:
            body = res.read(500)
            print(f"[{label}] {res.status} ct={res.headers.get('content-type')} m3u8={body.startswith(b'#EXTM3U')}")
            print("   ", body[:150].replace(b"\n", b" | "))
    except urllib.error.HTTPError as exc:
        print(f"[{label}] HTTP {exc.code}")
    except Exception as exc:  # noqa: BLE001
        print(f"[{label}] {type(exc).__name__}: {str(exc)[:70]}")
