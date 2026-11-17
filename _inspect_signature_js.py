"""İmza üretim mantığını çözebilir miyiz? uzr5 değişkenini incele.

Eğer bu saf JS ise (sunucu imzası değilse), aynı hesabı Python'da yapabiliriz.
"""

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

        blocks = re.findall(r"<script(?![^>]*src)[^>]*>(.*?)</script>", html, re.I | re.S)
        big = max(blocks, key=len)
        print("=== en büyük script bloğu (uzunluk %d) ===" % len(big))
        print(big.strip()[:3000])


asyncio.run(main())
