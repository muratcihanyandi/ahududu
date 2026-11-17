"""İmzalı CDN adresini sunucudan çekmeyi dene (referer'lı / referersız).

Karar noktası: sunucu bu akışı alabiliyor mu? Alabiliyorsa uygulama içinde
oynatmak mümkün; alamıyorsa video ancak tarayıcı bağlamında oynar.
"""

import sys
import urllib.error
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

URL = (
    "https://srv9.cdnimages2655.cyou/hls/theodyssey-2026-bluray-tt33764258mp4-eLTbK1Nxgyg.mp4/"
    "txt/master.txt?s=AVmU2GSXiApJNQZnRCo-cFfqKigdEUD7dOD237LJx0HOb62Jma-Kj3"
)
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

CASES = {
    "referer yok": {},
    "referer=hdfilmcehennemi.nl": {"Referer": "https://www.hdfilmcehennemi.nl/"},
    "referer=mobi embed": {"Referer": "https://hdfilmcehennemi.mobi/"},
    "origin+mobi": {
        "Referer": "https://hdfilmcehennemi.mobi/",
        "Origin": "https://hdfilmcehennemi.mobi",
    },
}

for label, extra in CASES.items():
    headers = {"User-Agent": UA, "Accept": "*/*"}
    headers.update(extra)
    try:
        req = urllib.request.Request(URL, headers=headers)
        with urllib.request.urlopen(req, timeout=25) as res:
            body = res.read(400)
            ok = body.lstrip().startswith(b"#EXTM3U")
            print(f"[{label}] {res.status} {res.headers.get('content-type')} "
                  f"m3u8={ok} -> {body[:80]!r}")
    except urllib.error.HTTPError as exc:
        print(f"[{label}] HTTP {exc.code} {exc.reason}")
    except Exception as exc:  # noqa: BLE001
        print(f"[{label}] HATA {type(exc).__name__}: {str(exc)[:90]}")
