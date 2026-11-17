"""Gerçek film sayfasında video kaynağı nerede? Derinlemesine incele."""

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
            "Referer": "https://www.hdfilmcehennemi.nl/",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        data = res.read()
        if res.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
        return res.status, str(res.url), data.decode("utf-8", "replace")


url = sys.argv[1] if len(sys.argv) > 1 else "https://www.hdfilmcehennemi.nl/the-odyssey-3/"
st, fin, page = get(url)
print(f"{url} -> {st} {fin} ({len(page)} bayt)\n")

print("=== iframe ===")
for m in re.findall(r"<iframe[^>]*>", page, re.I)[:10]:
    print("  ", m[:300])

print("\n=== video/script kaynak izleri ===")
for pat, label in [
    (r'https?://[^"\'\s<>]+\.(?:mp4|m3u8)[^"\'\s<>]*', "mp4/m3u8"),
    (r'"file"\s*:\s*"([^"]+)"', "file alanı"),
    (r'"source"\s*:\s*"([^"]+)"', "source alanı"),
    (r'src\s*:\s*[\'"]([^\'"]+)[\'"]', "src:"),
    (r'(?:data-id|data-post-id|data-film|data-url)=["\']([^"\']+)["\']', "data-*"),
]:
    found = re.findall(pat, page, re.I)[:8]
    if found:
        print(f"  {label}: {found}")

print("\n=== oynatıcı sağlayıcı ipuçları ===")
providers = re.findall(
    r"(rapidvid|vidmoly|doodstream|dood\.|sibnet|streamtape|filemoon|voe\.|luluvdo|uqload|"
    r"ok\.ru|alycdn|trplayer|hdplayer|play\.|players?)",
    page,
    re.I,
)
print("  ", sorted(set(p.lower() for p in providers)))

print("\n=== 'Altyazılı' / 'Dublaj' / sezon bölümleri ===")
for m in re.findall(r"<[^>]*(?:altyazil|dublaj|sezon|bolum|episode)[^>]*>", page, re.I)[:8]:
    print("  ", m.strip()[:200])

print("\n=== <video> / player div ===")
for m in re.findall(r"<(?:video|div)[^>]*(?:player|video|jw|plyr)[^>]*>", page, re.I)[:8]:
    print("  ", m.strip()[:200])

print("\n=== sayfadaki script src'leri ===")
for m in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', page, re.I)[:12]:
    print("  ", m)
