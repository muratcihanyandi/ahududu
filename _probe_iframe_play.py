"""Uçtan uca test: bu akış uygulama içinde oynatılabilir mi?

1) Sunucudaki proxy /api/cinema/proxy ile embed'i iframe'de aç (tarayıcıda).
2) Gerçek HLS akışı geliyor mu, video oynuyor mu?
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

# Sunucu çalışıyor mu?
import urllib.request

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33481")


def alive():
    try:
        urllib.request.urlopen(BASE + "/api/cinema", timeout=5)
        return True
    except Exception:
        return False


print("sunucu ayakta mı:", alive())

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

    def on_req(req):
        low = req.url.lower()
        if ".m3u8" in low or "/hls/" in low or ".mp4" in low or "/txt/" in low:
            media.append(req.url[:130])

    page.on("request", on_req)

    # Doğrudan embed'i iframe içinde aç (uygulamanın yaptığı gibi)
    wrapper = f"""<!doctype html><html><body style="margin:0;background:#000">
    <iframe src="{EMBED}" style="width:100%;height:100vh;border:0"
      allow="autoplay; fullscreen; encrypted-media" allowfullscreen></iframe>
    </body></html>"""

    tmp = os.path.join(OUT, "_embed_wrapper.html")
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(wrapper)

    page.goto("file:///" + tmp.replace("\\", "/"), wait_until="domcontentloaded")
    page.wait_for_timeout(9000)
    page.screenshot(path=os.path.join(OUT, "tp_direct_iframe.png"))

    print("\nmedya istekleri:", json.dumps(media[:8], ensure_ascii=False, indent=1))
    print("frame'ler:", [f.url[:110] for f in page.frames])

    videos = page.evaluate(
        """() => Array.from(document.querySelectorAll('video')).map(v => ({
            src: (v.currentSrc || v.src || '').slice(0,120), paused: v.paused, ready: v.readyState
        }))"""
    )
    print("video:", json.dumps(videos, ensure_ascii=False))

    ctx.close()
    browser.close()
