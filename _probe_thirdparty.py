"""hdfilmcehennemi gibi sitelerde film sayfası -> gerçek video kaynağı keşfi.

Amaç: bu tür sitelerin videosunu uygulama içinde oynatmanın hangi katmanda
çözüleceğini ölçmek (embed iframe mi, doğrudan mp4/m3u8 mi, yoksa JS ile mi).
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


def main():
    site = sys.argv[1] if len(sys.argv) > 1 else "https://www.hdfilmcehennemi.nl"
    status, final, html = get(site)
    print(f"ana sayfa: {status} {final} ({len(html)} bayt)")

    # Film sayfası adayları
    links = re.findall(r'href="([^"]+)"', html)
    cands = []
    for link in links:
        low = link.lower()
        if any(x in low for x in ("/film", "/izle", "-izle", "/dizi")):
            if link not in cands:
                cands.append(link)
    print("aday film sayfaları:")
    for c in cands[:10]:
        print("   ", c)

    if not cands:
        print("\nhref örnekleri:", links[:15])
        return

    target = cands[0]
    if target.startswith("/"):
        target = site.rstrip("/") + target
    print(f"\n>>> film sayfası: {target}")
    st, fin, page = get(target)
    print(f"durum: {st} {fin} ({len(page)} bayt)")

    signals = {
        "iframe": re.findall(r"<iframe[^>]+src=[\"']([^\"']+)[\"']", page, re.I)[:8],
        "data-src": re.findall(r"data-(?:src|video|lazy-src)=[\"']([^\"']+)[\"']", page, re.I)[:8],
        "mp4/m3u8": re.findall(r"https?://[^\"'\s<>]+\.(?:mp4|m3u8)[^\"'\s<>]*", page, re.I)[:8],
        "player_hosts": re.findall(
            r"https?://[^\"'\s<>]*(?:rapidvid|vidmoly|dood|sibnet|streamtape|filemoon|voe|"
            r"luluvdo|uqload|ok\.ru|youtube|vimeo|sibnet|alycdn|hls)[^\"'\s<>]*",
            page,
            re.I,
        )[:10],
        "video_tag": "<video" in page.lower(),
        "script_count": page.lower().count("<script"),
    }
    print(json.dumps(signals, ensure_ascii=False, indent=2)[:2500])

    print("\nilk 600 karakter:")
    print(page[:600])


if __name__ == "__main__":
    main()
