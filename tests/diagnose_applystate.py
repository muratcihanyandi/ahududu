"""applyState'e gelen position değerlerini doğrudan izle.

Senkron effect'i her state.position değişiminde çalışıyor. Hangi değerler
geliyor, hangisi videoyu 0'a çekiyor? Krasyı yakaladığında tüm zinciri yazar.
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
        "title": "Arabalar - applyState izleme",
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

        # Sinema motorunu bul ve applyState'i sar
        page.evaluate(
            """() => {
                const p = window.__ahududuCinemaPlayer;
                window.__apply = [];
                const t0 = performance.now();
                window.__t0 = t0;
                // Motor adaptör üzerinden erişilebilir değil; prototype'ı sar.
                if (p && p.constructor && p.constructor.prototype) {
                    // setTime'ı sar (applyState içinden çağrılıyor)
                    const proto = Object.getPrototypeOf(p);
                    const origSet = proto.setTime;
                    proto.setTime = function(s) {
                        window.__apply.push({
                            at: +((performance.now()-window.__t0)/1000).toFixed(2),
                            to: +(+s).toFixed(2),
                            cur: +this.getTime().toFixed(2),
                            stack: (new Error().stack||'').split('\\n').slice(1,6)
                                     .map(l=>l.trim().replace(/^at /,'').slice(0,90)),
                        });
                        return origSet.call(this, s);
                    };
                }
                // video konum izleme
                const v = document.querySelector('video');
                window.__trace = [];
                window.__timer2 = setInterval(() => {
                    window.__trace.push({ at: +((performance.now()-window.__t0)/1000).toFixed(2),
                                          t: +v.currentTime.toFixed(2) });
                }, 250);
            }"""
        )

        print(">>> 40 saniye izleniyor (sıçramayı yakalamak için)")
        page.wait_for_timeout(40000)

        trace = page.evaluate("() => window.__trace")
        applies = page.evaluate("() => window.__apply")

        jumps = []
        for i in range(1, len(trace)):
            if trace[i]["t"] < trace[i-1]["t"] - 0.5:
                jumps.append((trace[i-1], trace[i]))

        print(f"\n>>> GERİYE SIÇRAMA: {len(jumps)}")
        for a, b in jumps[:10]:
            print(f"   t={b['at']:6.2f}s  {a['t']:7.2f} -> {b['t']:7.2f}")

        print(f"\n>>> setTime ÇAĞRILARI: {len(applies)}")
        for a in applies[:15]:
            print(f"   t={a['at']:6.2f}s  {a['cur']:7.2f} -> {a['to']:7.2f}")
            for line in a["stack"][:4]:
                print(f"        {line}")

        browser.close()
        return 1 if jumps else 0


if __name__ == "__main__":
    sys.exit(main())
