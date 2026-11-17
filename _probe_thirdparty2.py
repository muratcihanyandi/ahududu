"""hdfilmcehennemi ana sayfadaki GERÇEK film linklerini bul ve birini incele."""

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


def get(url):
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
            "Accept-Encoding": "gzip",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        data = res.read()
        if res.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
        return res.status, str(res.url), data.decode("utf-8", "replace")


site = "https://www.hdfilmcehennemi.nl"
_, _, home = get(site)

# "/xxx-izle" ile biten tekil film linkleri
films = re.findall(r'href="(https?://[^"]*?-izle[^"]*)"', home)
if not films:
    films = re.findall(r'href="(/[^"/]+-izle[^"]*)"', home)
uniq = []
for f in films:
    if f not in uniq:
        uniq.append(f)
print("film linkleri:", len(uniq))
for f in uniq[:8]:
    print("   ", f)

if uniq:
    target = uniq[0]
    if target.startswith("/"):
        target = site + target
    st, fin, page = get(target)
    print(f"\n>>> {target}  [{st}] {len(page)} bayt")
    checks = {
        "iframe": re.findall(r"<iframe[^>]+src=[\"']([^\"']+)[\"']", page, re.I)[:6],
        "video": "<video" in page.lower(),
        "mp4/m3u8": re.findall(r"https?://[^\"'\s<>]+\.(?:mp4|m3u8)[^\"'\s<>]*", page, re.I)[:6],
        "player": re.findall(
            r"https?://[^\"'\s<>]*(?:rapidvid|vidmoly|dood|sibnet|streamtape|filemoon|voe|"
            r"luluvdo|uqload|ok\.ru|sibnet|alycdn|trplayer|player)[^\"'\s<>]*",
            page,
            re.I,
        )[:8],
    }
    print(json.dumps(checks, ensure_ascii=False, indent=2)[:2000])

    # Alternatif kaynak sekmeleri (Altyazılı / Dublaj) ve AJAX uçları
    for pat in (r"ajax[^\"'\s<>]{0,60}", r"action=[\"']([^\"']+)[\"']", r"data-[a-z-]*id=[\"']([^\"']+)[\"']"):
        found = re.findall(pat, page, re.I)[:5]
        if found:
            print(f"{pat}: {found}")
