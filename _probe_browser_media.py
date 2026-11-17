"""Embed oynatıcı GERÇEK tarayıcıda açılıyor mu? Video akışını yakala.

Tarayıcı ağını dinleyip m3u8/mp4 isteklerini yakalar. Böylece videonun
hangi adresten geldiği kesin olarak öğrenilir.
"""

import json
import os
import sys

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

FILM = sys.argv[1] if len(sys.argv) > 1 else "https://www.hdfilmcehennemi.nl/the-odyssey-3/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ui_shots")
os.makedirs(OUT, exist_ok=True)

with sync_playwright() as p:
    browser = None
    for channel in ("chrome", "msedge"):
        try:
            browser = p.chromium.launch(channel=channel, args=["--mute-audio"])
            break
        except Exception as exc:  # noqa: BLE001
            print(f"[..] {channel}: {str(exc)[:70]}")

    ctx = browser.new_context(
        viewport={"width": 1280, "height": 720},
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        ),
    )
    page = ctx.new_page()

    media = []
    embeds = []

    def on_request(req):
        url = req.url
        low = url.lower()
        if any(x in low for x in (".m3u8", ".mp4", ".ts?")) or "/video/embed" in low:
            media.append({"url": url[:160], "type": req.resource_type})

    def on_response(res):
        low = res.url.lower()
        if "/video/embed" in low:
            embeds.append({"status": res.status, "url": res.url[:140]})

    page.on("request", on_request)
    page.on("response", on_response)

    try:
        page.goto(FILM, wait_until="domcontentloaded", timeout=45000)
    except Exception as exc:  # noqa: BLE001
        print("goto hata:", str(exc)[:120])
    page.wait_for_timeout(6000)
    page.screenshot(path=os.path.join(OUT, "tp_film_page.png"))

    print("embed cevapları:", json.dumps(embeds, ensure_ascii=False, indent=1)[:1200])
    print("\nmedya istekleri:", json.dumps(media[:10], ensure_ascii=False, indent=1)[:1500])

    # Oynat'a bas
    for sel in ('.play-that-video', '[aria-label="Play video"]', 'video'):
        try:
            if page.locator(sel).count():
                page.locator(sel).first.click(timeout=3000)
                print("tıklandı:", sel)
                break
        except Exception:
            pass
    page.wait_for_timeout(8000)
    page.screenshot(path=os.path.join(OUT, "tp_film_clicked.png"))

    print("\n--- tıklama sonrası medya ---")
    print(json.dumps(media[-12:], ensure_ascii=False, indent=1)[:2000])

    frames = [f.url[:140] for f in page.frames]
    print("\nframe'ler:", json.dumps(frames, ensure_ascii=False, indent=1)[:1200])

    videos = page.evaluate(
        """() => Array.from(document.querySelectorAll('video')).map(v => ({
            src: (v.currentSrc || v.src || '').slice(0, 140), paused: v.paused, ready: v.readyState
        }))"""
    )
    print("\nvideo öğeleri:", json.dumps(videos, ensure_ascii=False))

    ctx.close()
    browser.close()
