"""SALINIM HATASI: video 7-8. saniyeye gelip 2. saniyeye dönüyor, tekrar.

Kullanıcının tarifi: "film başlıyor 7-8. saniyeye geliyor, yeniden 2. saniyeye
dönüyor, devam ediyor 7-8'e geliyor, yine 2'ye dönüyor."

Bu bir geri-çekme (rubber-band) döngüsüdür: senkron motoru beklenen konumu
videonun ilerisinde sanıp sürekli geriye sarıyor.

Test:
  - Oynatma boyunca her 250 ms currentTime örnekler
  - GERİYE sıçramaları (t < önceki t) ve setTime çağrılarını kaydeder
  - Sıçramanın kaynağını (stack) yazar
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
        "title": "Arabalar - salinim",
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
        page.wait_for_timeout(9000)

        # İzleyici kur
        page.evaluate(
            """() => {
                const v = document.querySelector('video');
                window.__trace = [];
                window.__seeks = [];
                const t0 = performance.now();
                const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
                Object.defineProperty(v, 'currentTime', {
                    configurable: true,
                    get() { return d.get.call(this); },
                    set(x) {
                        const st = (new Error().stack || '').split('\\n')
                            .filter(l => l.includes('assets/'))
                            .slice(0, 4).map(l => l.trim().replace(/^at /, '').slice(0, 100));
                        window.__seeks.push({ at: +((performance.now()-t0)/1000).toFixed(2),
                                              from: +d.get.call(this).toFixed(2),
                                              to: +(+x).toFixed(2), stack: st });
                        return d.set.call(this, x);
                    },
                });
                window.__timer = setInterval(() => {
                    window.__trace.push({ at: +((performance.now()-t0)/1000).toFixed(2),
                                          t: +v.currentTime.toFixed(2),
                                          paused: v.paused, rs: v.readyState });
                }, 250);
            }"""
        )

        print(">>> 25 saniye izleniyor (baştan, sarma YOK)")
        page.wait_for_timeout(25000)

        trace = page.evaluate("() => window.__trace")
        seeks = page.evaluate("() => window.__seeks")

        # Geriye sıçramaları bul
        jumps = []
        for i in range(1, len(trace)):
            prev, cur = trace[i - 1], trace[i]
            if cur["t"] < prev["t"] - 0.5:
                jumps.append({"at": cur["at"], "from": prev["t"], "to": cur["t"]})

        print(f"\n>>> ÖRNEK: {len(trace)} | GERİYE SIÇRAMA: {len(jumps)}")
        for j in jumps[:12]:
            print(f"   t={j['at']:6.2f}s  {j['from']:7.2f} -> {j['to']:7.2f}")

        print(f"\n>>> SETTIME ÇAĞRILARI: {len(seeks)}")
        for s in seeks[:12]:
            print(f"   t={s['at']:6.2f}s  {s['from']:7.2f} -> {s['to']:7.2f}")
            for line in s["stack"][:3]:
                print(f"        {line}")

        # Zaman çizelgesi (kısa)
        print("\n>>> ZAMAN ÇİZELGESİ (ilk 40 örnek)")
        for e in trace[:40]:
            print(f"   t={e['at']:6.2f}s  video={e['t']:7.2f}  paused={e['paused']}  rs={e['rs']}")

        browser.close()
        return 1 if jumps else 0


if __name__ == "__main__":
    sys.exit(main())
