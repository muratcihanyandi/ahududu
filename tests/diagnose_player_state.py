"""Canlı sunucuda oynatıcı iç durumu: kalite, tampon, takılma sebebi.

"Oynuyor ama ilerlemiyor" durumunda hls.js'in iç durumunu okur:
  - seçili kalite (bant genişliği)
  - tampon uzunluğu
  - kaç kez 'waiting' (takılma) oldu
  - segment istekleri ne kadar sürdü
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://192.168.2.170:33470")
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
        "title": "Arabalar - oynatici teshis",
        "video_url": resolved["video_url"],
        "created_by": "murat",
        "kind": resolved["kind"],
        "source": resolved["source"],
        "stream_url": resolved["stream_url"],
        "stream_referer": resolved.get("stream_referer"),
    })
    api(f"/api/cinema/{room['id']}/start", "POST", {"user_id": "murat"})

    with sync_playwright() as p:
        exe = next((x for x in [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ] if os.path.exists(x)), None)
        launch = {"headless": True, "args": ["--disable-gpu", "--autoplay-policy=no-user-gesture-required"]}
        if exe:
            launch["executable_path"] = exe
        browser = p.chromium.launch(**launch)
        page = browser.new_page(viewport={"width": 1280, "height": 800})

        # Ağ isteklerini izle: segment süreleri
        net = []

        def on_response(resp):
            u = resp.url
            if "/api/cinema/hls" in u:
                try:
                    cl = int(resp.headers.get("content-length") or 0)
                except Exception:
                    cl = 0
                net.append({"url": u[:60], "status": resp.status, "bytes": cl,
                            "t": round(resp.request.timing.get("responseEnd", 0))})

        page.on("response", on_response)

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.get_by_role("button", name="Salona Gir").first.click()
        page.wait_for_timeout(9000)

        # waiting/stalled sayacı
        page.evaluate(
            """() => {
                const v = document.querySelector('video');
                window.__stalls = { waiting: 0, stalled: 0, totalWaitMs: 0 };
                let waitStart = null;
                v.addEventListener('waiting', () => {
                    window.__stalls.waiting++;
                    waitStart = performance.now();
                });
                v.addEventListener('playing', () => {
                    if (waitStart) {
                        window.__stalls.totalWaitMs += performance.now() - waitStart;
                        waitStart = null;
                    }
                });
                v.addEventListener('stalled', () => { window.__stalls.stalled++; });
            }"""
        )

        # 7. dakikaya sar
        print(f">>> {SEEK_TO} sn'ye sarılıyor")
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
        page.wait_for_timeout(2000)

        # 25 saniye izle, her saniye örnekle
        print("\n>>> 25 SN İZLEME (her saniye)")
        samples = []
        for i in range(25):
            page.wait_for_timeout(1000)
            s = page.evaluate(
                """() => {
                    const v = document.querySelector('video');
                    const p = window.__ahududuCinemaPlayer;
                    let hlsInfo = null;
                    try {
                        const h = p && p.hls;
                        if (h) {
                            const lvl = h.levels && h.levels[h.currentLevel];
                            hlsInfo = {
                                level: h.currentLevel,
                                bitrate: lvl ? Math.round(lvl.bitrate / 1000) : null,
                                height: lvl ? lvl.height : null,
                                auto: h.autoLevelEnabled,
                            };
                        }
                    } catch (e) { hlsInfo = 'err'; }
                    const b = v.buffered;
                    let ahead = 0;
                    for (let i = 0; i < b.length; i++) {
                        if (b.start(i) <= v.currentTime && v.currentTime <= b.end(i)) {
                            ahead = +(b.end(i) - v.currentTime).toFixed(1);
                            break;
                        }
                    }
                    return { t: +v.currentTime.toFixed(1), paused: v.paused,
                             rs: v.readyState, bufAhead: ahead, hls: hlsInfo };
                }"""
            )
            samples.append(s)
            if i % 5 == 0 or i == 24:
                print(f"  {i+1:2}s t={s['t']:7.1f} rs={s['rs']} paused={str(s['paused']):5} "
                      f"tampon_ileri={s['bufAhead']:5}s kalite={s['hls']}")

        stalls = page.evaluate("() => window.__stalls")
        print("\n>>> TAKILMA SAYAÇLARI:", stalls)

        # İlerleme
        if len(samples) >= 2:
            gained = samples[-1]["t"] - samples[0]["t"]
            wall = 24
            print(f"\n>>> {wall} sn duvarda {gained:.1f} sn video ilerledi "
                  f"(oran {gained/wall:.2f}x)")
            if gained / wall < 0.85:
                print(">>> SORUN: video gerçek zamandan yavaş oynuyor!")

        seg_reqs = [n for n in net if n["bytes"] > 5000]
        print(f"\n>>> HLS İSTEKLERİ: {len(net)} (segment: {len(seg_reqs)})")
        for n in net[-8:]:
            print(f"  {n['status']} {n['bytes']:8} B  {n['url']}")

        browser.close()


if __name__ == "__main__":
    main()
