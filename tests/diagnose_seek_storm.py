"""Sarma döngüsü teşhisi: setTime çağrılarını ve kaynaklarını yakala.

Video 413.9'da durup 406.4'e atıyor. Bu test her `setTime` çağrısını,
çağıran kodu (stack trace) ile birlikte kaydeder. Böylece sarmayı kimin
tetiklediği kesin olarak görülür.
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
LATENCY_MS = 150
THROUGHPUT = 190_000


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
        "title": "Arabalar - sarma dongusu",
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
        ] if os.path.exists(x)), None)
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

        # currentTime setter'ını sar: kim, hangi değere, nereden çekiyor?
        page.evaluate(
            """() => {
                const v = document.querySelector('video');
                window.__seeks = [];
                const proto = HTMLMediaElement.prototype;
                const desc = Object.getOwnPropertyDescriptor(proto, 'currentTime');
                Object.defineProperty(v, 'currentTime', {
                    configurable: true,
                    get() { return desc.get.call(this); },
                    set(val) {
                        const st = new Error().stack || '';
                        // Yalnızca bizim kodumuzun satırlarını al
                        const lines = st.split('\\n')
                            .filter(l => l.includes('assets/') || l.includes('cinema'))
                            .slice(0, 3).map(l => l.trim().slice(0, 120));
                        window.__seeks.push({
                            at: +(performance.now() / 1000).toFixed(1),
                            from: +desc.get.call(this).toFixed(1),
                            to: +(+val).toFixed(1),
                            stack: lines,
                        });
                        return desc.set.call(this, val);
                    },
                });
            }"""
        )

        # Ağı yavaşlat
        cdp = page.context.new_cdp_session(page)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": LATENCY_MS,
            "downloadThroughput": THROUGHPUT,
            "uploadThroughput": THROUGHPUT // 4,
        })

        print(f">>> {SEEK_TO} sn'ye sarılıyor (yavaş ağ)")
        page.evaluate(
            """(target) => {
                const v = document.querySelector('video');
                window.__seeks.length = 0;  // sadece kullanıcı sarmasından sonrası
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

        page.wait_for_timeout(30000)

        seeks = page.evaluate("() => window.__seeks")
        print(f"\n>>> SETTIME ÇAĞRILARI: {len(seeks)} adet\n")
        for s in seeks:
            print(f"  t={s['at']:5.1f}s  {s['from']:7.1f} -> {s['to']:7.1f}")
            for line in s.get("stack", []):
                print(f"        {line}")

        print(f"\n>>> YORUM")
        if len(seeks) > 3:
            print(f"  {len(seeks)} sarma çağrısı = SARMA FIRTINASI (asıl sorun)")
            # Kaynakları grupla
            srcs = {}
            for s in seeks:
                key = s.get("stack", ["(bilinmiyor)"])[0][:80] if s.get("stack") else "(bilinmiyor)"
                srcs[key] = srcs.get(key, 0) + 1
            print("\n  Sarmayı tetikleyen kodlar:")
            for k, cnt in sorted(srcs.items(), key=lambda x: -x[1]):
                print(f"    {cnt:3}x  {k}")
        else:
            print(f"  Yalnızca {len(seeks)} sarma — makul")

        browser.close()


if __name__ == "__main__":
    main()
