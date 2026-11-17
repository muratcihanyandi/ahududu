"""İmzalı adres bir API'den mi geliyor? Muhtemel uçları dene.

Embed JS'inde "/ajax/..." benzeri bir uç görünüyor (packer içinde "3e/6T/4f/6Z").
Bu tür siteler genelde bir POST/GET ucuyla kaynak listesi verir.
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

        # packer'daki sözlük dizgesini çöz (p,a,c,k,e)
        m = re.search(r"\}\('(.*?)',(\d+),(\d+),'(.*?)'\.split\('\|'\)", big, re.S)
        if m:
            packed, base, count, words = m.group(1), int(m.group(2)), int(m.group(3)), m.group(4).split("|")
            print("packer: base=%d count=%d kelime=%d" % (base, count, len(words)))

            def unbase(c: int) -> str:
                out = ""
                while True:
                    out = (chr(c % base + 29) if c % base > 35 else _b36(c % base)) + out
                    c //= base
                    if c == 0:
                        return out

            def _b36(n: int) -> str:
                digits = "0123456789abcdefghijklmnopqrstuvwxyz"
                return digits[n] if n < 36 else _b36(n // 36) + digits[n % 36]

            mapping = {}
            for i in range(count):
                mapping[unbase(i)] = words[i] if i < len(words) and words[i] else unbase(i)

            def repl(mo):
                token = mo.group(0)
                return mapping.get(token, token)

            unpacked = re.sub(r"\b[a-zA-Z0-9_]+\b", repl, packed)
            print("\n=== çözülmüş kod (ilk 2500) ===")
            print(unpacked[:2500])

            print("\n=== URL yolları ===")
            for u in set(re.findall(r"[\"']([/][^\"']{2,60})[\"']", unpacked)):
                print("  ", u)
            print("\n=== ajax çağrıları ===")
            for a in re.findall(r"url\s*:\s*[\"']([^\"']+)[\"']", unpacked):
                print("  ", a)


asyncio.run(main())
