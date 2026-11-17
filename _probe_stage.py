"""
Sinema Salonu — tarayıcıda gezinme + seçtiğin videoyu tek ekran dokunuşuyla
perdeye alma ("sahne").

Akış
----
1. Kullanıcı bir film sitesi linki yapıştırır.
2. Salonda açılırken perde, ASKIYA ALINMIŞ bir tarayıcı önizlemesi göstermek
   yerine "Sahne al" kartı gösterir: "Siteyi salonda aç →" (dış bağlantı) ya da
   "Doğrudan açıcıyı dene".
3. Kullanıcı linki tarayıcıda/sitede gezinip DOĞRU videoyu kendi açar ve
   adresini paylaş (YouTube uygulaması → Paylaş → Bağlantıyı kopyala) ile
   uygulamaya döner.
4. "Sahneye al" düğmesine bastığında perde o videoya geçer. Tek dokunuş olduğu
   için otomatik oynatma engeli de aşılır; oynat/duraklat düğmeleri çalışır.
"""

import asyncio
import json
import sys
from urllib.parse import urlparse, parse_qs

sys.path.insert(0, r"C:\Users\Murat\Documents\Ahududu")

import httpx  # noqa: E402

from backend.app.routes.cinema import resolve_link_deep, resolve_video  # noqa: E402

API = "http://192.168.2.170:33470"
SITE = "https://www.fullhdfilmizlesene.now/film/arabalar/"


def log(name, ok, detail=""):
    print(("[OK]  " if ok else "[FAIL]") + f" {name}" + (f"  -> {detail}" if detail else ""))
    return ok


async def live_checks():
    results = []
    async with httpx.AsyncClient(timeout=90.0) as client:
        # 1) Site linki: gömülemez sayfa → "sahne" akışına düşmeli
        r = await client.post(f"{API}/api/cinema/resolve", json={"video_url": SITE})
        data = r.json()
        results.append(log("site linki çözümleniyor", r.status_code == 200, str(data.get("embed_url"))))

        # 2) Kullanıcının sitede gezip bulacağı gerçek oynatıcı: /embed/ItemId=
        page = await client.get(SITE, headers={"User-Agent": "Mozilla/5.0"})
        if page.status_code == 200:
            marker = "/embed/ItemId="
            idx = page.text.find(marker)
            results.append(log("sayfada gerçek oynatıcı adresi var", idx > 0, page.text[max(0, idx - 40): idx + 40] if idx > 0 else "yok"))

        # 3) YouTube linki → doğrudan oynatıcı, senkronlu sahne
        r = await client.post(f"{API}/api/cinema/resolve",
                              json={"video_url": "https://www.youtube.com/watch?v=SbXIj2T-_uk"})
        yt = r.json()
        results.append(log("YouTube linki doğrudan oynatıcıya gider",
                           "youtube.com/embed/" in (yt.get("embed_url") or ""),
                           str(yt.get("embed_url"))))
    return results


def unit_checks():
    results = []
    # Sahne çözümleyicisinin kapalı (offline) testi: bilinen siteler ağa çıkmadan
    for url, expect_source, expect_embed in (
        ("https://www.youtube.com/watch?v=SbXIj2T-_uk", "youtube", True),
        ("https://youtu.be/SbXIj2T-_uk?t=42", "youtube", True),
        ("https://vimeo.com/123456789", "vimeo", True),
        ("https://ornek.com/film.mp4", "link", False),
    ):
        r = resolve_video(url)
        ok = r["source"] == expect_source and bool(r.get("embed_url")) == expect_embed
        results.append(log(f"sahne çözümleyici: {url[:40]}…", ok, f"{r['source']} / {r.get('embed_url')}"))
    return results


async def main():
    results = unit_checks()
    try:
        results += await live_checks()
    except Exception as exc:  # noqa: BLE001
        print("[FAIL] canlı sunucuya ulaşılamadı:", type(exc).__name__, exc)
        results.append(False)
    print()
    print(f"{sum(1 for ok in results if ok)}/{len(results)} kontrol geçti")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
