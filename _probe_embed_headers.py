"""Embed neden sunucudan 404, tarayıcıdan 200? Farkı bul.

Headers / cookie / referer zinciri karşılaştırması.
"""

import gzip
import sys
import urllib.error
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
EMBED = "https://hdfilmcehennemi.mobi/video/embed/eLTbK1Nxgyg/?rapidrame_id=78ctgbzfug8i"

CASES = {
    "yalin": {},
    "referer .nl": {"Referer": "https://www.hdfilmcehennemi.nl/"},
    "referer kendisi": {"Referer": EMBED},
    "referer .nl + sec-fetch": {
        "Referer": "https://www.hdfilmcehennemi.nl/",
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Upgrade-Insecure-Requests": "1",
    },
    "accept-language dolu": {"Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8"},
}


def try_one(label, extra):
    headers = {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Encoding": "gzip",
    }
    headers.update(extra)
    req = urllib.request.Request(EMBED, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=25) as res:
            data = res.read()
            if res.headers.get("Content-Encoding") == "gzip":
                data = gzip.decompress(data)
            text = data.decode("utf-8", "replace")
            print(f"[{label}] {res.status} len={len(data)}")
            print("   ilk:", text[:150].replace("\n", " "))
    except urllib.error.HTTPError as exc:
        print(f"[{label}] HTTP {exc.code}")
    except Exception as exc:  # noqa: BLE001
        print(f"[{label}] {type(exc).__name__}: {str(exc)[:70]}")


for label, extra in CASES.items():
    try_one(label, extra)
