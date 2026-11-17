"""Orijin gerçek sayfa olsun: embed'i http kaynağından iframe'de aç.

file:// yerine sunucudaki bir sayfadan açarak uygulamayla aynı koşulları kurar
(Sec-Fetch-Site / Referer gerçekçi olur).
"""

import json
import os
import sys
import urllib.parse

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ui_shots")
os.makedirs(OUT, exist_ok=True)

EMBED = "https://hdfilmcehennemi.mobi/video/embed/eLTbK1Nxgyg/?rapidrame_id=78ctgbzfug8i"
FILM = "https://www.hdfilmcehennemi.nl/the-odyssey-3/"
BASE = "http://127.0.0.1:33481"

# Sunucunun proxy ucundan embed (uygulamanın gerçek yolu)
proxy_embed = f"{BASE}/api/cinema/proxy?url={urllib.parse.quote(EMBED, safe='')}"
proxy_film = f"{BASE}/api/cinema/proxy?url={urllib.parse.quote(FILM, safe='')}"

with sync_playwright() as p:
    browser = None
    for channel in ("chrome", "msedge"):
        try:
            browser = p.chromium.launch(channel=channel, args=["--mute-audio"])
            break
        except Exception as exc:  # noqa: BLE001
            print(f"[..] {channel}: {str(exc)[:70]}")

    ctx = browser.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    media = []
    page.on("request", lambda r: media.append(r.url[:120])
            if any(k in r.url.lower() for k in ("/hls/", ".m3u8", "/txt/")) else None)

    print("=== 1) Embed doğrudan proxy ile ===")
    page.goto(proxy_embed, wait_until="domcontentloaded")
    page.wait_for_timeout(8000)
    page.screenshot(path=os.path.join(OUT, "tp_proxy_embed.png"))
    print("  medya:", json.dumps(media[:5], indent=1))
    vids = page.evaluate("() => Array.from(document.querySelectorAll('video')).map(v=>({src:(v.currentSrc||'').slice(0,100),paused:v.paused}))")
    print("  video:", vids)
    print("  metin:", page.evaluate("() => document.body.innerText.slice(0,150)"))

    print("\n=== 2) Film sayfası proxy ile ===")
    media.clear()
    page.goto(proxy_film, wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    page.screenshot(path=os.path.join(OUT, "tp_proxy_film.png"))
    print("  frames:", [f.url[:100] for f in page.frames])
    print("  metin:", page.evaluate("() => document.body.innerText.slice(0,150).replace(/\\n+/g,' | ')"))

    ctx.close()
    browser.close()
