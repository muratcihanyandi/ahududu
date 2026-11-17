"""Embed HTML'inde akış adresi nasıl yazılmış? Ham bağlamı gör."""

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
        print("durum:", r.status_code, "len:", len(r.text))
        html = r.text

        for kw in ("playmix", "master.txt", "m3u8", "hls"):
            idx = html.find(kw)
            print(f"\n--- '{kw}' ilk konum: {idx} ---")
            if idx >= 0:
                print(repr(html[max(0, idx - 220): idx + 220]))

        print("\n--- tüm https:// adayları (ilk 15) ---")
        for m in re.findall(r"https?://[^\s\"'<>\\]+", html)[:15]:
            print("   ", m[:150])


asyncio.run(main())
