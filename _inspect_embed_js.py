"""Embed, imzalı akış adresini nasıl üretiyor? JS tarafını incele."""

import asyncio
import re
import sys

sys.path.insert(0, ".")

import httpx  # noqa: E402

from backend.app.services.site_stream import _headers_for  # noqa: E402

EMBED = "https://hdfilmcehennemi.mobi/video/embed/eLTbK1Nxgyg/?rapidrame_id=78ctgbzfug8i"
PAGE = "https://www.hdfilmcehennemi.nl/the-odyssey-3/"


async def main():
    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
        r = await client.get(EMBED, headers=_headers_for(EMBED, PAGE))
        html = r.text

        print("=== script src'leri ===")
        for m in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.I):
            print("  ", m)

        print("\n=== satır içi script'lerde imza/parametre izleri ===")
        for kw in ("?s=", "&o=", "signature", "token", "playmix", "loadPlayer", "jwplayer(", "setup"):
            idx = html.find(kw)
            if idx >= 0:
                print(f"\n--- {kw} ---")
                print(repr(html[max(0, idx - 160): idx + 200]))

        print("\n=== görünür script blokları (ilk 2) ===")
        blocks = re.findall(r"<script(?![^>]*src)[^>]*>(.*?)</script>", html, re.I | re.S)
        for b in blocks[:2]:
            print("  ---")
            print("  ", b.strip()[:700].replace("\n", "\n   "))

        # JS dosyasını indir
        for src in re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html, re.I):
            if "player" in src or "jw" in src or "app" in src or "main" in src:
                full = src if src.startswith("http") else "https://hdfilmcehennemi.mobi" + src
                print(f"\n>>> JS: {full[:100]}")
                try:
                    jr = await client.get(full, headers=_headers_for(full, EMBED))
                    js = jr.text
                    print("   boyut:", len(js))
                    for kw in ("?s=", "&o=", "contentUrl", "master.txt"):
                        k = js.find(kw)
                        if k >= 0:
                            print(f"   [{kw}]", repr(js[max(0, k - 150): k + 150]))
                except Exception as exc:  # noqa: BLE001
                    print("   JS alınamadı:", str(exc)[:60])


asyncio.run(main())
