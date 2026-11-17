"""SALONA SONRADAN GİREN — tek seferlik senkron testi.

Senaryo (Murat'ın tarifi):
  1. Murat filmi izliyor, 11. dakikada (660 sn).
  2. Selin odaya giriyor.
  3. TEK SEFERLİK senkron: Murat'ın videosu durur, Selin'e hizalanır,
     ikisi de 11. dakikadan devam eder.
  4. Sonrasında senkron YOK (ikisi serbest ilerler).

Ayrıca: otomatik salona girme OLMAMALI (bildirim yeter).
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33489")
FILM_PAGE = "https://www.fullhdfilmizlesene.now/film/arabalar/"
SEEK_TO = 660  # 11. dakika

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


def vstate(page):
    return page.evaluate(
        """() => {
            const v = document.querySelector('video');
            if (!v) return { noVideo: true };
            return { t: +v.currentTime.toFixed(1), paused: v.paused, rs: v.readyState };
        }"""
    )


def main():
    resolved = api("/api/cinema/resolve", "POST", {"video_url": FILM_PAGE})
    room = api("/api/cinema", "POST", {
        "title": "Arabalar - giris senkronu",
        "video_url": resolved["video_url"],
        "created_by": "murat",
        "kind": resolved["kind"],
        "source": resolved["source"],
        "stream_url": resolved["stream_url"],
        "stream_referer": resolved.get("stream_referer"),
    })
    api(f"/api/cinema/{room['id']}/start", "POST", {"user_id": "murat"})
    print(f"Salon: {room['id']}")

    with sync_playwright() as p:
        exe = next((x for x in [r"C:\Program Files\Google\Chrome\Application\chrome.exe"]
                    if os.path.exists(x)), None)
        launch = {"headless": True, "args": ["--disable-gpu", "--autoplay-policy=no-user-gesture-required"]}
        if exe:
            launch["executable_path"] = exe
        browser = p.chromium.launch(**launch)

        murat = browser.new_context(viewport={"width": 1280, "height": 800})
        selin = browser.new_context(viewport={"width": 1280, "height": 800})
        pm, ps = murat.new_page(), selin.new_page()

        for pg, who in ((pm, "murat"), (ps, "selin")):
            pg.goto(BASE, wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_timeout(2500)
            pg.get_by_text("Ben Murat" if who == "murat" else "Ben Selin").first.click()
            pg.wait_for_timeout(2500)
            pg.get_by_text("🎬", exact=False).first.click()
            pg.wait_for_timeout(3000)

        # ---- 1) Murat salona girer, 11. dakikaya sarar, oynatır ----
        print("\n>>> Murat salona giriyor")
        pm.get_by_role("button", name="Salona Gir").first.click()
        pm.wait_for_timeout(9000)
        print("  Murat:", vstate(pm))

        # 11. dakikaya sar
        pm.evaluate(
            """(target) => {
                const v = document.querySelector('video');
                if (!v) return;
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
        pm.wait_for_timeout(6000)

        # oynat
        pm.evaluate(
            """() => {
                const v = document.querySelector('video');
                if (v && v.paused) {
                    const btn = [...v.parentElement.querySelectorAll('button')]
                        .find(b => /Oynat/i.test(b.getAttribute('title') || ''));
                    if (btn) btn.click();
                }
            }"""
        )
        pm.wait_for_timeout(5000)
        m_before = vstate(pm)
        print(f"  Murat 11. dakikada oynuyor: {m_before}")
        log("Murat 11. dakikada oynuyor",
            m_before.get("paused") is False and 600 <= m_before.get("t", 0) <= 720,
            str(m_before))

        # ---- 2) Selin otomatik girmemeli ----
        ps.wait_for_timeout(1500)
        selin_video_early = ps.evaluate("() => !!document.querySelector('video')")
        log("Selin OTOMATİK salona girmedi", selin_video_early is False,
            f"video var mı: {selin_video_early}")

        # ---- 3) Selin kendisi salona girer ----
        print("\n>>> Selin kendisi salona giriyor")
        try:
            ps.get_by_role("button", name="Salona Gir").first.click(timeout=8000)
        except Exception:
            ps.get_by_role("button", name="Sahnedeki Filme Dön").first.click(timeout=8000)

        # Tek seferlik senkron için bekle
        print("  senkron bekleniyor (≤20 sn)...")
        for _ in range(20):
            ps.wait_for_timeout(1000)
            sm, ss = vstate(pm), vstate(ps)
            if (not ss.get("noVideo") and not ss.get("paused")
                    and not sm.get("paused") and abs(sm.get("t", 0) - ss.get("t", 0)) < 12):
                break

        sm, ss = vstate(pm), vstate(ps)
        print(f"  Murat: {sm}")
        print(f"  Selin: {ss}")

        diff = abs(sm.get("t", 0) - ss.get("t", 0))
        log("Selin 11. dakikaya hizalandı", ss.get("t", 0) >= 600, str(ss))
        log("ikisi de 11. dakikadan oynuyor",
            not sm.get("paused") and not ss.get("paused") and diff < 12,
            f"murat={sm.get('t')} selin={ss.get('t')} fark={diff:.1f}")

        # ---- 4) Sonrasında senkron yok: 15 sn izle ----
        print("\n>>> 15 saniye serbest oynatma (senkron OLMAMALI)")
        pm.wait_for_timeout(15000)
        sm2, ss2 = vstate(pm), vstate(ps)
        print(f"  Murat: {sm2}")
        print(f"  Selin: {ss2}")
        log("ikisi de hâlâ oynuyor",
            sm2.get("paused") is False and ss2.get("paused") is False,
            f"{sm2} | {ss2}")

        pm.screenshot(path="tests/screenshots_verify/joinsync_murat.png")
        ps.screenshot(path="tests/screenshots_verify/joinsync_selin.png")
        browser.close()

    print("\n" + ("GİRİŞ SENKRONU TESTİ GEÇTİ ✅" if not failures else f"BAŞARISIZ: {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
