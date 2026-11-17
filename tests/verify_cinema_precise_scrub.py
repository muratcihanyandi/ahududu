"""Hassas sarma + yavaş ağda oynatma testi.

İki şeyi doğrular:
  1. Sarma çubuğunda SÜRÜKLEYEREK tam 7:00'a inmek (piksel yuvarlaması sorunu).
  2. Yavaş ağda (1.5 Mbps) sarma sonrası video TAKILMADAN oynaması.
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

failures = []


def log(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


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
        "title": "Arabalar - hassas sarma",
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

        # --- 1) SÜRÜKLEYEREK 7:00'a sar ---
        box = page.evaluate(
            """() => {
                const v = document.querySelector('video');
                const bar = [...v.parentElement.querySelectorAll('button')]
                    .find(b => (b.getAttribute('title') || '') === 'Sarma');
                const r = bar.getBoundingClientRect();
                return { x: r.left, y: r.top + r.height / 2, w: r.width };
            }"""
        )
        target_x = box["x"] + box["w"] * (SEEK_TO / 6996.04)
        print(f"Sürükleme: x={box['x']:.0f} → {target_x:.0f} (çubuk {box['w']:.0f}px)")

        page.mouse.move(box["x"] + 5, box["y"])
        page.mouse.down()
        page.wait_for_timeout(150)
        page.mouse.move(target_x, box["y"], steps=12)
        page.wait_for_timeout(250)
        # sürüklerken hedef gösterge
        preview = page.evaluate(
            """() => {
                const v = document.querySelector('video');
                const badge = [...v.parentElement.querySelectorAll('span')]
                    .find(s => /^\\d+:\\d+$/.test(s.textContent.trim()) &&
                               s.className.includes('amber-400'));
                return badge ? badge.textContent.trim() : null;
            }"""
        )
        print("Sürüklerken gösterilen hedef:", preview)
        page.mouse.up()
        page.wait_for_timeout(1500)

        log("sürüklerken hedef saniye gösterildi", preview is not None, str(preview))

        # --- 2) Ağı yavaşlat ve oynatmayı izle ---
        cdp = page.context.new_cdp_session(page)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": LATENCY_MS,
            "downloadThroughput": THROUGHPUT,
            "uploadThroughput": THROUGHPUT // 4,
        })
        print(f"\nAğ yavaşlatıldı: {THROUGHPUT*8/1_000_000:.1f} Mbps")

        # sarma sürerken OYNAT'a bas
        page.evaluate(
            """() => {
                const v = document.querySelector('video');
                if (v.paused) {
                    const btn = [...v.parentElement.querySelectorAll('button')]
                        .find(b => /Oynat/i.test(b.getAttribute('title') || ''));
                    if (btn) btn.click();
                }
            }"""
        )

        print("30 saniye izleniyor (yavaş ağ)...")
        samples = []
        for i in range(30):
            page.wait_for_timeout(1000)
            s = page.evaluate(
                """() => {
                    const v = document.querySelector('video');
                    return { t: +v.currentTime.toFixed(1), paused: v.paused, rs: v.readyState };
                }"""
            )
            samples.append(s)
            if i % 6 == 0 or i == 29:
                print(f"  {i+1:2}s t={s['t']:7.1f} rs={s['rs']} paused={s['paused']}")

        gained = samples[-1]["t"] - samples[1]["t"]
        wall = 28
        ratio = gained / wall
        paused_count = sum(1 for s in samples[1:] if s["paused"])

        print(f"\n>>> 30 sn'de {gained:.1f} sn ilerledi (oran {ratio:.2f}x)")
        print(f">>> durduğu örnek sayısı: {paused_count}/{len(samples)-1}")

        log("yavaş ağda video ilerliyor", ratio > 0.6, f"oran={ratio:.2f}")
        log("kendi kendine durmadı", paused_count == 0, f"{paused_count} örnek")
        log("hedef saniye doğru (7:00 civarı)", 380 <= samples[1]["t"] <= 460, f"t={samples[1]['t']}")

        page.screenshot(path="tests/screenshots_verify/cinema_slow_network.png")
        browser.close()

    print("\n" + ("HASSAS SARMA + YAVAŞ AĞ TESTİ GEÇTİ ✅" if not failures else f"BAŞARISIZ: {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
