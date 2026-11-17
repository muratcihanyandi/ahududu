"""Gerçekçi mobil koşulda sarma + oynat dayanıklılık testi.

Telefon çoğu zaman mobil hatta: ağ yavaş ve dalgalı. Bu test ağı yavaşlatıp
(defansif ayar) sarma sonrası oynatmanın takılmadan sürdüğünü doğrular.

Senaryo:
  1. Ağı yavaşlat (Chrome DevTools ağ emülasyonu).
  2. 7. dakikaya sar.
  3. Oynat.
  4. 30 saniye izle: ilerleme oranı ve takılma sayısı.
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
# "Yavaş 3G" benzeri: 1.5 Mbps indirme, 150 ms gecikme
LATENCY_MS = 150
THROUGHPUT = 190_000  # bayt/sn ≈ 1.5 Mbps


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
        "title": "Arabalar - mobil kosul",
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

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.get_by_role("button", name="Salona Gir").first.click()
        page.wait_for_timeout(9000)

        # AĞI YAVAŞLAT (mobil hat benzetimi)
        cdp = page.context.new_cdp_session(page)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {
            "offline": False,
            "latency": LATENCY_MS,
            "downloadThroughput": THROUGHPUT,
            "uploadThroughput": THROUGHPUT // 4,
        })
        print(f"Ağ yavaşlatıldı: {LATENCY_MS} ms gecikme, "
              f"{THROUGHPUT*8/1_000_000:.1f} Mbps")

        # takılma sayacı
        page.evaluate(
            """() => {
                const v = document.querySelector('video');
                window.__st = { waiting: 0, waitMs: 0 };
                let s = null;
                v.addEventListener('waiting', () => {
                    window.__st.waiting++; s = performance.now();
                });
                v.addEventListener('playing', () => {
                    if (s) { window.__st.waitMs += performance.now() - s; s = null; }
                });
            }"""
        )

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
        page.wait_for_timeout(1500)

        # sarma sürerken OYNAT
        page.evaluate(
            """() => {
                const v = document.querySelector('video');
                const btn = [...v.parentElement.querySelectorAll('button')]
                    .find(b => /Oynat|Duraklat/i.test(b.getAttribute('title') || ''));
                if (btn && v.paused) btn.click();
            }"""
        )

        # 20 sn bekle (yükleme)
        page.wait_for_timeout(20000)

        # 30 sn ölç
        print("\n>>> 30 SN İZLEME (yavaş ağda)")
        t0 = page.evaluate("() => document.querySelector('video').currentTime")
        wall_start = page.evaluate("() => performance.now()")
        for i in range(6):
            page.wait_for_timeout(5000)
            s = page.evaluate(
                """() => {
                    const v = document.querySelector('video');
                    return { t: +v.currentTime.toFixed(1), paused: v.paused, rs: v.readyState };
                }"""
            )
            print(f"  {(i+1)*5:2}s t={s['t']:7.1f} rs={s['rs']} paused={s['paused']}")

        t1 = page.evaluate("() => document.querySelector('video').currentTime")
        wall = (page.evaluate("() => performance.now()") - wall_start) / 1000
        stalls = page.evaluate("() => window.__st")

        gained = t1 - t0
        ratio = gained / wall if wall else 0
        print(f"\n>>> SONUÇ")
        print(f"  duvar süresi: {wall:.1f} sn")
        print(f"  video ilerlemesi: {gained:.1f} sn")
        print(f"  oran: {ratio:.2f}x  (1.00 = tam hız)")
        print(f"  takılma: {stalls['waiting']} kez, toplam {stalls['waitMs']/1000:.1f} sn")

        ok = ratio > 0.85 and not page.evaluate("() => document.querySelector('video').paused")
        print(f"\n  {'✅ YAVAŞ AĞDA DA OYNUYOR' if ok else '❌ TAKILIYOR'}")
        browser.close()
        return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
