"""Sarma sonrası segment neden yüklenmiyor? (rs=1 takılı kalıyor)

hls.js'i sarma sonrası izler: buffer, istek durumu, hata.
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
SEEK_TO = 420


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
        "title": "Arabalar - segment teshis",
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

        net = []
        page.on("response", lambda r: net.append({
            "url": r.url[:70], "status": r.status,
            "len": r.headers.get("content-length", "?"),
            "type": r.headers.get("content-type", "")[:30],
        }) if "/api/cinema/hls" in r.url else None)
        page.on("requestfailed", lambda r: net.append({
            "url": r.url[:70], "status": "FAILED", "len": "-", "type": str(r.failure)[:40],
        }) if "/api/cinema/hls" in r.url else None)
        page.on("console", lambda m: print("  [konsol]", m.type, m.text[:160])
                if m.type in ("error", "warning") else None)

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.get_by_role("button", name="Salona Gir").first.click()
        page.wait_for_timeout(10000)

        # hls.js iç durumunu oku
        def hls_state():
            return page.evaluate(
                """() => {
                    const p = window.__ahududuCinemaPlayer;
                    if (!p || !p.hls) return { hls: false };
                    const h = p.hls;
                    const lvls = h.levels || [];
                    return {
                        hls: true,
                        currentLevel: h.currentLevel,
                        levelCount: lvls.length,
                        levelHeights: lvls.map(l => l.height),
                        levelBitrates: lvls.map(l => Math.round((l.bitrate||0)/1000)),
                        autoLevel: h.autoLevelEnabled,
                        loadLevel: h.loadLevel,
                        nextLoadLevel: h.nextLoadLevel,
                        started: h.media ? !h.media.paused : null,
                    };
                }"""
            )

        print("BAŞLANGIÇ hls:", json.dumps(hls_state(), ensure_ascii=False))

        # 7. dakikaya sar
        page.evaluate(
            """(target) => {
                const v = document.querySelector('video');
                const bar = [...v.parentElement.querySelectorAll('button')]
                    .find(b => (b.getAttribute('title') || '') === 'Sarma');
                const r = bar.getBoundingClientRect();
                bar.dispatchEvent(new MouseEvent('click', {
                    bubbles: true, cancelable: true,
                    clientX: r.left + r.width * (target / v.duration),
                    clientY: r.top + r.height / 2,
                }));
            }""",
            SEEK_TO,
        )
        net.clear()

        print("\n>>> 15 saniye izleniyor")
        for i in range(15):
            page.wait_for_timeout(1000)
            st = page.evaluate(
                """() => {
                    const v = document.querySelector('video');
                    const b = v.buffered;
                    let ranges = [];
                    for (let i = 0; i < b.length; i++) ranges.push([+b.start(i).toFixed(0), +b.end(i).toFixed(0)]);
                    return { t: +v.currentTime.toFixed(1), rs: v.readyState,
                             paused: v.paused, seeking: v.seeking,
                             ranges: ranges.slice(0, 4), nRanges: b.length };
                }"""
            )
            print(f"  {i+1:2}s t={st['t']:7.1f} rs={st['rs']} paused={st['paused']} "
                  f"seeking={st['seeking']} tampon_aralik={st['ranges']}")

        print("\n>>> hls.js durumu:", json.dumps(hls_state(), ensure_ascii=False))

        print(f"\n>>> AĞ İSTEKLERİ ({len(net)}):")
        for n in net[:15]:
            print(f"  {str(n['status']):>6} {str(n['len']):>10}B {n['type']:<28} {n['url']}")

        browser.close()


if __name__ == "__main__":
    main()
