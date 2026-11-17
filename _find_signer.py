"""uzr5 (imzalı akış adresi) nasıl üretiliyor? Tam çözülmüş kodu ara."""

import asyncio
import re
import sys

sys.path.insert(0, ".")

import httpx  # noqa: E402

from backend.app.services.site_stream import _headers_for  # noqa: E402

EMBED = "https://hdfilmcehennemi.mobi/video/embed/eLTbK1Nxgyg/?rapidrame_id=78ctgbzfug8i"
PAGE = "https://www.hdfilmcehennemi.nl/the-odyssey-3/"


def unbase(c: int, base: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        r = c % base
        out = (chr(r + 29) if r > 35 else digits[r]) + out
        c //= base
        if c == 0:
            return out


async def main():
    async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
        r = await client.get(EMBED, headers=_headers_for(EMBED, PAGE))
        html = r.text
        blocks = re.findall(r"<script(?![^>]*src)[^>]*>(.*?)</script>", html, re.I | re.S)
        big = max(blocks, key=len)
        m = re.search(r"\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)", big, re.S)
        packed, base, count, words = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4).split("|")
        mapping = {}
        for i in range(count):
            key = unbase(i, base)
            mapping[key] = words[i] if i < len(words) and words[i] else key
        unpacked = re.sub(r"\b[a-zA-Z0-9_]+\b", lambda mo: mapping.get(mo.group(0), mo.group(0)), packed)

        print("uzunluk:", len(unpacked))

        # uzr5 ve p20w fonksiyonunu bul
        for kw in ("uzr5", "p20w", "function p20w", "c5yq"):
            for m2 in re.finditer(re.escape(kw), unpacked):
                k = m2.start()
                print(f"\n--- {kw} @ {k} ---")
                print(unpacked[max(0, k - 300): k + 500])
                break

        # p20w tanımı (şifre çözücü) ayrıntılı
        dm = re.search(r"function p20w\((.{0,2500}?)\}\s*;", unpacked, re.S)
        if dm:
            print("\n=== p20w TANIMI ===")
            print(dm.group(0)[:2500])
        else:
            idx = unpacked.find("p20w")
            # fonksiyon ataması olabilir: var p20w=function(...)
            fm = re.search(r"p20w\s*=\s*function\s*\((.{0,2000})", unpacked, re.S)
            if fm:
                print("\n=== p20w (atama) ===")
                print(fm.group(0)[:2000])


asyncio.run(main())
