"""Çözülen token'sız akış gerçekten oynatılabilir mi? (referer ile)

Ayrıca iki farklı film aynı master.txt verdi: gerçekten aynı akış mı,
yoksa token'sız adres yanlış mı?
"""

import re
import sys
import urllib.error
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

UA = (
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
)

MASTER = "https://hls8.playmix.uno/hls/filmakinesimp4-f9gx1M12BwC.mp4/master.txt"
REFERERS = {
    "mobi embed odyssey": "https://hdfilmcehennemi.mobi/video/embed/eLTbK1Nxgyg/?rapidrame_id=78ctgbzfug8i",
    "mobi embed kombat": "https://hdfilmcehennemi.mobi/video/embed/f6DjMZ4nuyQ/?rapidrame_id=61tnz5eb11dv",
    "referersız": "",
}


def fetch(url, referer):
    headers = {"User-Agent": UA, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
        headers["Origin"] = "https://hdfilmcehennemi.mobi"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as res:
        return res.status, res.headers.get("content-type"), res.read(400)


for label, ref in REFERERS.items():
    try:
        st, ct, body = fetch(MASTER, ref)
        print(f"[{label}] {st} ct={ct}")
        print("   ", body[:120].replace(b"\n", b" | "))
    except urllib.error.HTTPError as exc:
        print(f"[{label}] HTTP {exc.code}")
    except Exception as exc:  # noqa: BLE001
        print(f"[{label}] {type(exc).__name__}: {str(exc)[:60]}")
