"""applyState'e gelen POSITION değerini doğrudan yakala.

Eğer effect'e position=0 geliyorsa sorun CinemaStage'de DEĞİL, gelen state'te.
Eğer position=20 gelip 0'a sarıyorsa sorun release build'inde `fresh` mantığında.
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33485")
FILM_PAGE = "https://www.fullhdfilmizlesene.now/film/arabalar/"


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}", data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=180) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def main():
    resolved = api("/api/cinema/resolve", "POST", {"video_url": FILM_PAGE})
    room = api("/api/cinema", "POST", {
        "title": "Arabalar - position izleme",
        "video_url": resolved["video_url"],
        "created_by": "murat",
        "kind": resolved["kind"],
        "source": resolved["source"],
        "stream_url": resolved["stream_url"],
        "stream_referer": resolved.get("stream_referer"),
    })
    api(f"/api/cinema/{room['id']}/start", "POST", {"user_id": "murat"})

    with sync_playwright() as p:
        exe = next((x for x in [r"C:\Program Files\Google\Chrome\Application\chrome.exe"]
                    if os.path.exists(x)), None)
        launch = {"headless": True, "args": ["--disable-gpu", "--autoplay-policy=no-user-gesture-required"]}
        if exe:
            launch["executable_path"] = exe
        browser = p.chromium.launch(**launch)
        page = browser.new_page(viewport={"width": 1280, "height": 800})

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.get_by_role("button", name="Salona Gir").first.click()
        page.wait_for_timeout(8000)

        # HLS adaptörünün applyState'ini DEĞİL, motor seviyesinde izle:
        # video.currentTime setter + expectedPosition
        page.evaluate(
            """() => {
                window.__t0 = performance.now();
                const st = () => +((performance.now() - window.__t0) / 1000).toFixed(2);
                const v = document.querySelector('video');
                window.__log = [];

                const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
                Object.defineProperty(v, 'currentTime', {
                    configurable: true,
                    get() { return d.get.call(this); },
                    set(x) {
                        window.__log.push({ at: st(), kind: 'SET', from: +d.get.call(this).toFixed(2),
                                            to: +(+x).toFixed(2),
                                            stack: (new Error().stack||'').split('\\n').slice(1,7)
                                                     .map(l=>l.trim().replace(/^at /,'').slice(0,80)) });
                        return d.set.call(this, x);
                    },
                });
                window.__trace = [];
                setInterval(() => {
                    window.__trace.push({ at: st(), t: +v.currentTime.toFixed(2), paused: v.paused });
                }, 250);
            }"""
        )

        print(">>> 40 saniye izleniyor")
        page.wait_for_timeout(40000)

        trace = page.evaluate("() => window.__trace")
        log = page.evaluate("() => window.__log")

        jumps = [(trace[i-1], trace[i]) for i in range(1, len(trace))
                 if trace[i]["t"] < trace[i-1]["t"] - 0.5]
        print(f"\n>>> SIÇRAMA: {len(jumps)}")
        for a, b in jumps[:6]:
            print(f"   t={b['at']:6.2f}s  {a['t']:7.2f} -> {b['t']:7.2f}")

        print(f"\n>>> SET ÇAĞRILARI: {len(log)}")
        for e in log[:6]:
            print(f"   t={e['at']:6.2f}s  {e['from']:7.2f} -> {e['to']:7.2f}")
            for line in e.get("stack", [])[:6]:
                print(f"        {line}")
            print()

        browser.close()
        return 1 if jumps else 0


if __name__ == "__main__":
    sys.exit(main())
