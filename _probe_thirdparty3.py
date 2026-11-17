"""Ana sayfadaki tüm href'leri sınıflandır: gerçek film sayfası hangisi?"""

import gzip
import re
import sys
import urllib.request
from collections import Counter

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)


def get(url):
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept-Encoding": "gzip", "Accept-Language": "tr-TR,tr;q=0.9"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        data = res.read()
        if res.headers.get("Content-Encoding") == "gzip":
            data = gzip.decompress(data)
        return data.decode("utf-8", "replace")


home = get("https://www.hdfilmcehennemi.nl")
hrefs = re.findall(r'href="([^"]+)"', home)

# İlk yol parçasına göre grupla
groups = Counter()
for h in hrefs:
    path = re.sub(r"^https?://[^/]+", "", h).lstrip("/")
    first = path.split("/")[0] if path else ""
    groups[first] += 1

print("yol grupları (ilk parça, adet):")
for k, v in groups.most_common(25):
    print(f"   {k!r}: {v}")

print("\n/ ile başlayan, bilinen bölümler DEĞİL olan örnekler:")
skip = ("category", "yil", "etiket", "sayfa", "dist", "images", "wp-", "page", "search", "giris", "film-robotu")
for h in hrefs:
    path = re.sub(r"^https?://[^/]+", "", h)
    if path.startswith("/") and not any(s in path for s in skip):
        print("   ", h)
