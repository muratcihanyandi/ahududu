"""SARMA sonrası takılma teşhisi: seek -> yükleme -> oynatma zinciri.

"7. dakikaya alıyorum, başlamıyor / başlıyor sonra duruyor" şikayetinin
kökünü bulmak için HLS oynatıcı olaylarını tek tek izler.

Ölçülenler:
  - seek sonrası readyState ne zaman 3+ oluyor (oynatmaya hazır)?
  - 'waiting' / 'stalled' / 'canplay' olayları ne zaman?
  - hls.js hata veriyor mu?
"""

import json
import os
import sys
import time
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
        "title": "Arabalar - teshis",
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
        page.on("console", lambda m: print("  [konsol]", m.type, m.text[:180])
                if m.type in ("error", "warning") else None)

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.get_by_role("button", name="Salona Gir").first.click()
        page.wait_for_timeout(9000)

        # Olay kayıt cihazı kur
        page.evaluate(
            """() => {
                const v = document.querySelector('video');
                window.__ev = [];
                const t0 = performance.now();
                ['loadstart','loadedmetadata','loadeddata','canplay','canplaythrough',
                 'seeking','seeked','waiting','stalled','playing','pause','play',
                 'progress','suspend','emptied','error'].forEach(name => {
                    v.addEventListener(name, () => {
                        window.__ev.push({
                            ev: name,
                            ms: Math.round(performance.now() - t0),
                            t: +v.currentTime.toFixed(1),
                            rs: v.readyState,
                            paused: v.paused,
                        });
                    });
                });
            }"""
        )
        page.wait_for_timeout(500)

        # 7. dakikaya sar
        print(f"\n>>> {SEEK_TO} saniyeye sarılıyor")
        page.evaluate(
            """(target) => {
                const v = document.querySelector('video');
                const stage = v.parentElement;
                const bar = [...stage.querySelectorAll('button')].find(
                    b => (b.getAttribute('title') || '') === 'Sarma');
                const r = bar.getBoundingClientRect();
                bar.dispatchEvent(new MouseEvent('click', {
                    bubbles: true, cancelable: true,
                    clientX: r.left + r.width * (target / v.duration),
                    clientY: r.top + r.height / 2,
                }));
            }""",
            SEEK_TO,
        )

        # 12 saniye boyunca her 500 ms örnekle
        samples = []
        for i in range(24):
            page.wait_for_timeout(500)
            s = page.evaluate(
                """() => {
                    const v = document.querySelector('video');
                    return { t: +v.currentTime.toFixed(1), rs: v.readyState,
                             paused: v.paused, seeking: v.seeking,
                             buffered: v.buffered.length ? +v.buffered.end(v.buffered.length-1).toFixed(1) : 0 };
                }"""
            )
            samples.append(s)

        print("\n>>> ZAMAN ÇİZELGESİ (her 500ms)")
        for i, s in enumerate(samples):
            print(f"  {(i+1)*0.5:4.1f}s  t={s['t']:7.1f}  rs={s['rs']}  "
                  f"paused={str(s['paused']):5}  seeking={str(s['seeking']):5}  buf={s['buffered']:.0f}")

        events = page.evaluate("() => window.__ev")
        print("\n>>> OYNATICI OLAYLARI")
        for e in events:
            print(f"  {e['ms']:6}ms  {e['ev']:16} t={e['t']:7.1f} rs={e['rs']} paused={e['paused']}")

        # Sonuç
        final = samples[-1]
        stalled_ms = 0
        for i, s in enumerate(samples):
            if s["rs"] < 3 or s["paused"]:
                stalled_ms += 500

        print("\n>>> SONUÇ")
        print(f"  son t: {final['t']}")
        print(f"  son readyState: {final['rs']}")
        print(f"  takılı kaldığı süre: {stalled_ms} ms")
        print(f"  hedefi geçti mi: {final['t'] > SEEK_TO + 2}")

        browser.close()


if __name__ == "__main__":
    main()
