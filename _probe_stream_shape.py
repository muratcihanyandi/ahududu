"""Akış yapısını netleştir: master.txt bir JPEG kare dizisi mi?

image000.jpg 2.8 MB ve içinde FFmpeg/MKV başlığı var -> muhtemelen bu
karelerin her biri videonun bir parçası (yanlış isimlendirme). Doğrulayalım.
"""

import sys
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
REF = {"Referer": "https://hdfilmcehennemi.mobi/", "Origin": "https://hdfilmcehennemi.mobi"}
BASE = "https://srv9.cdnimages2655.cyou/hls/theodyssey-2026-bluray-tt33764258mp4-eLTbK1Nxgyg.mp4"
Q = "?s=AVmU2GSXiApJNQZnRCo-cFfqKigdEUD7dOD237LJx0HOb62Jma-Kj3"


def head(url):
    headers = {"User-Agent": UA, "Accept": "*/*", "Range": "bytes=0-64"}
    headers.update(REF)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as res:
        first = res.read(120)
        return {
            "status": res.status,
            "ct": res.headers.get("content-type"),
            "len": res.headers.get("content-length"),
            "first": first[:40],
            "hex": first[:12].hex(),
        }


for name in ("image000.jpg", "image000.ts", "text.txt", "text0.txt", "video.mp4"):
    try:
        info = head(f"{BASE}/{name}{Q}")
        print(f"{name:16} -> {info['status']} ct={info['ct']} len={info['len']} hex={info['hex']} {info['first'][:20]!r}")
    except Exception as exc:  # noqa: BLE001
        print(f"{name:16} -> HATA {type(exc).__name__} {str(exc)[:60]}")
