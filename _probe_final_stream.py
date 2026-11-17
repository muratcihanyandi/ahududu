"""Embed'i iframe içinde açıp TAM akış adreslerini yakala (token'lar dahil)."""

import json
import os
import sys

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ui_shots")
os.makedirs(OUT, exist_ok=True)

EMBED = "https://hdfilmcehennemi.mobi/video/embed/eLTbK1Nxgyg/?rapidrame_id=78ctgbzfug8i"
BASE = "http://127.0.0.1:33481"
HOSTED = BASE + "/_embed_test.html"


def build_wrapper():
    html = (
        "<!doctype html><html><body style='margin:0;background:#000'>"
        "<iframe id='f' src='%s' style='width:100vw;height:100vh;border:0' "
        "allow='autoplay; fullscreen; encrypted-media' allowfullscreen></iframe>"
        "</body></html>" % EMBED
    )
    # Sunucunun statik dizinine yazma: doğrudan bir data URL yerine proxy sayfası kullan
    with open(os.path.join(OUT, "_embed_wrapper.html"), "w", encoding="utf-8") as fh:
        fh.write(html)


build_wrapper()

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

    reqs = []
    page.on(
        "request",
        lambda r: reqs.append({"url": r.url, "type": r.resource_type})
        if any(k in r.url.lower() for k in ("playmix", "/hls/", ".txt", ".m3u8"))
        else None,
    )

    # Film sayfasını gerçek siteden aç, oynat'a bas (en gerçekçi yol)
    page.goto("https://www.hdfilmcehennemi.nl/the-odyssey-3/", wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    try:
        page.locator(".play-that-video").first.click(timeout=4000)
        print("oynat'a basıldı")
    except Exception as exc:  # noqa: BLE001
        print("tıklama sorunu:", str(exc)[:80])

    page.wait_for_timeout(10000)
    page.screenshot(path=os.path.join(OUT, "tp_final.png"))

    print("\nyakalanan akış istekleri:")
    for r in reqs[:8]:
        print("  ", r["type"], r["url"][:220])

    # iframe içindeki video durumu
    for frame in page.frames:
        try:
            vids = frame.evaluate(
                "() => Array.from(document.querySelectorAll('video')).map(v=>({src:(v.currentSrc||v.src||'').slice(0,150),paused:v.paused,ready:v.readyState,t:v.currentTime}))"
            )
            if vids:
                print(f"\nframe {frame.url[:80]} video:", json.dumps(vids, ensure_ascii=False))
        except Exception:
            pass

    ctx.close()
    browser.close()
