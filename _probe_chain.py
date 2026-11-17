"""Taze akış: ana sayfa -> film -> data-src embed -> gerçek video kaynağı.

Tek seferde uçtan uca dener; embed adresi muhtemelen kısa ömürlü.
"""

import gzip
import json
import re
import sys
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
BASE = "https://www.hdfilmcehennemi.nl"


def get(url, referer=BASE + "/"):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip",
            "Referer": referer,
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        data = res.read()
        if res.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
        return res.status, str(res.url), data.decode("utf-8", "replace")


def film_pages(home):
    out = []
    skip = ("category", "yil", "tur", "ulke", "dil", "dizi", "assets", "dist", "images",
            "wp-", "iletisim", "film-robotu", "site.", "search", "giris")
    for h in re.findall(r'href="([^"]+)"', home):
        path = re.sub(r"^https?://[^/]+", "", h).strip("/")
        if not path or "/" in path:
            continue
        if any(s in path for s in skip):
            continue
        full = BASE + "/" + path + "/"
        if full not in out:
            out.append(full)
    return out


_, _, home = get(BASE)
films = film_pages(home)
print(f"film adayı: {len(films)}")

for film in films[:4]:
    try:
        st, _, page = get(film)
    except Exception as exc:  # noqa: BLE001
        print(f"\n{film}: HATA {exc}")
        continue

    embeds = re.findall(r'<iframe[^>]+data-src=["\']([^"\']+)["\']', page, re.I)
    embeds += re.findall(r'<iframe[^>]+src=["\']([^"\']+)["\']', page, re.I)
    print(f"\n=== {film} [{st}] iframe: {embeds[:3]}")
    if not embeds:
        continue

    embed = embeds[0]
    try:
        est, efin, ehtml = get(embed, referer=film)
    except Exception as exc:  # noqa: BLE001
        print(f"   embed HATA: {exc}")
        continue

    print(f"   embed [{est}] {efin} ({len(ehtml)} bayt)")
    found = re.findall(r'https?://[^"\'\s<>\\]+\.(?:m3u8|mp4)[^"\'\s<>\\]*', ehtml, re.I)
    print(f"   m3u8/mp4: {found[:4]}")
    for pat in (r'"file"\s*:\s*"([^"]+)"', r'"source"\s*:\s*"([^"]+)"',
                r'sources\s*:\s*\[([^\]]{0,200})\]'):
        f = re.findall(pat, ehtml, re.I)[:3]
        if f:
            print(f"   {pat[:18]}: {f}")
    for m in re.findall(r"<iframe[^>]*>", ehtml, re.I)[:3]:
        print("   iç iframe:", m[:200])
    for kw in ("jwplayer", "plyr", "hls", "videojs", "playerjs", "m3u8"):
        if kw in ehtml.lower():
            print("   keyword:", kw)
    print("   özet:", ehtml[:300].replace("\n", " "))
