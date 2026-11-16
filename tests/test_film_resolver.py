"""Film sitesi çözümleyicisinin gerçek sitelerde testi."""

import asyncio
import os
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from backend.app.services.film_resolver import extract_candidates, resolve_page_video  # noqa: E402

URLS = [
    "https://www.fullhdfilmizlesene.now/film/arabalar/",
    "https://www.fullhdfilmizlesene.now/film/inception/",
]

HTML_SAMPLES = {
    "mp4 json": '<script>var player = {"file":"/video/arabalar.mp4","type":"video/mp4"}</script>',
    "iframe host": '<iframe src="https://vidsrc.to/embed/movie/920"></iframe>',
    "protocol relative": '<iframe src="//player.example.com/embed/abc"></iframe>',
    "data-src": '<video data-src="https://cdn.example.com/film.m3u8"></video>',
    "relative iframe": '<iframe src="/embed/player/123"></iframe>',
}

failures = []


def check(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def test_extract():
    base = "https://www.fullhdfilmizlesene.now/film/arabalar/"
    for label, html in HTML_SAMPLES.items():
        cands = extract_candidates(html, base)
        check(f"çıkarım: {label}", len(cands) > 0, str(cands)[:150])

    cands = extract_candidates(HTML_SAMPLES["mp4 json"], base)
    check("mp4 en yüksek öncelik", cands and cands[0]["kind"] == "file", str(cands[:2]))

    cands = extract_candidates(HTML_SAMPLES["protocol relative"], base)
    check("protocol-relative https'e çevrildi",
          cands and cands[0]["url"].startswith("https://"), str(cands[:1]))

    cands = extract_candidates(HTML_SAMPLES["relative iframe"], base)
    check("göreli adres tamamlandı",
          cands and cands[0]["url"] == "https://www.fullhdfilmizlesene.now/embed/player/123",
          str(cands[:1]))


async def test_live():
    for url in URLS:
        result = await resolve_page_video(url)
        print(f"[..]   {url}")
        print(f"       -> {str(result)[:260]}")
        check(f"canlı çözümleme: {url.split('/film/')[-1]}",
              result.get("ok") is True or "engel" in str(result.get("reason", "")).lower()
              or "403" in str(result.get("reason", "")),
              str(result)[:200])


test_extract()
asyncio.run(test_live())

print()
if failures:
    print(f"{len(failures)} SORUN: {', '.join(failures)}")
    sys.exit(1)
print("FİLM ÇÖZÜMLEYİCİ TESTİ GEÇTİ ✅")
