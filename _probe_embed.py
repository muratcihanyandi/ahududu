"""Embed oynatıcının içini incele: gerçek m3u8/mp4 nerede?"""

import gzip
import re
import sys
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def get(url, referer="https://www.hdfilmcehennemi.nl/"):
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


embed = sys.argv[1] if len(sys.argv) > 1 else "https://hdfilmcehennemi.mobi/video/embed/eLTbK1Nxgyg/?rapidrame_id=78ctgbzfug8i"
st, fin, html = get(embed)
print(f"{embed}\n -> {st} {fin} ({len(html)} bayt)\n")

print("=== m3u8 / mp4 ===")
for m in re.findall(r'https?://[^"\'\s<>\\]+\.(?:m3u8|mp4)[^"\'\s<>\\]*', html, re.I)[:10]:
    print("  ", m)

print("\n=== 'file' / 'source' / 'src' atamaları ===")
for pat in (r'"file"\s*:\s*"([^"]+)"', r"'file'\s*:\s*'([^']+)'", r'"source"\s*:\s*"([^"]+)"',
            r'sources\s*:\s*\[([^\]]{0,300})\]', r'data-src=["\']([^"\']+)["\']'):
    found = re.findall(pat, html, re.I)[:6]
    if found:
        print(f"  {pat[:24]}: {found}")

print("\n=== iframe ===")
for m in re.findall(r"<iframe[^>]*>", html, re.I)[:6]:
    print("  ", m[:250])

print("\n=== script src ===")
for m in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.I)[:10]:
    print("  ", m)

print("\n=== jwplayer/plyr/hls izleri ===")
for kw in ("jwplayer", "plyr", "hls", "videojs", "playerjs", "Clappr"):
    if kw in html.lower():
        print("  var:", kw)

print("\n=== kısa özet (ilk 500) ===")
print(html[:500])
