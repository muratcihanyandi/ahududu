"""Proxy'ye Sec-Fetch başlıkları eklenirse embed açılır mı? (kanıt)

Sunucu tarafında başlıkları elle göndererek doğrula.
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
    "sec-fetch iframe": {
        "Sec-Fetch-Dest": "iframe",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Referer": "https://www.hdfilmcehennemi.nl/",
    },
    "sec-fetch + dest document": {
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "cross-site",
        "Referer": "https://www.hdfilmcehennemi.nl/",
    },
    "yalnız iframe dest": {"Sec-Fetch-Dest": "iframe"},
}

for label, extra in CASES.items():
    headers = {"User-Agent": UA, "Accept": "text/html,*/*", "Accept-Encoding": "gzip"}
    headers.update(extra)
    try:
        with urllib.request.urlopen(urllib.request.Request(EMBED, headers=headers), timeout=25) as res:
            data = res.read()
            if res.headers.get("Content-Encoding") == "gzip":
                data = gzip.decompress(data)
            text = data.decode("utf-8", "replace")
            print(f"[{label}] {res.status} len={len(data)}")
            # embed içinde akış adresi var mı?
            import re
            urls = re.findall(r'https?://[^"\'\s<>]+(?:\.txt|/hls/)[^"\'\s<>]*', text, re.I)[:3]
            print("   akış izleri:", urls[:2])
            print("   baş:", text[:120].replace("\n", " "))
    except urllib.error.HTTPError as exc:
        print(f"[{label}] HTTP {exc.code}")
