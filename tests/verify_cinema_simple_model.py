"""SADE MODEL doğrulaması — iki cihaz (Murat + Selin).

Murat'ın istediği sistem:
  1. Film başlatılınca İKİSİ DE yükleme ekranında bekler; ikisi de hazır
     olunca AYNI ANDA başlar.
  2. Oynarken SENKRON YOK (biri 20:11, diğeri 20:22 olabilir).
  3. Biri DURDURURSA ikisi de durur.
  4. Biri OYNATIRSA geride olana hizalanır ve birlikte devam eder.

Yerel dev sunucusu gerekli.
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


def video_state(page):
    return page.evaluate(
        """() => {
            const v = document.querySelector('video');
            if (!v) return { noVideo: true };
            return { t: +v.currentTime.toFixed(1), paused: v.paused,
                     rs: v.readyState, dur: +v.duration.toFixed(0) };
        }"""
    )


def main():
    resolved = api("/api/cinema/resolve", "POST", {"video_url": FILM_PAGE})
    if not resolved.get("stream_url"):
        log("akış çözüldü", False, str(resolved)[:150])
        return 1
    room = api("/api/cinema", "POST", {
        "title": "Arabalar - sade model",
        "video_url": resolved["video_url"],
        "created_by": "murat",
        "kind": resolved["kind"],
        "source": resolved["source"],
        "stream_url": resolved["stream_url"],
        "stream_referer": resolved.get("stream_referer"),
    })
    print(f"Salon: {room['id']}")

    with sync_playwright() as p:
        exe = next((x for x in [r"C:\Program Files\Google\Chrome\Application\chrome.exe"]
                    if os.path.exists(x)), None)
        launch = {"headless": True, "args": ["--disable-gpu", "--autoplay-policy=no-user-gesture-required"]}
        if exe:
            launch["executable_path"] = exe
        browser = p.chromium.launch(**launch)

        # İki ayrı kullanıcı: Murat ve Selin
        murat = browser.new_context(viewport={"width": 1280, "height": 800})
        selin = browser.new_context(viewport={"width": 1280, "height": 800})
        pm = murat.new_page()
        ps = selin.new_page()

        for pg, who in ((pm, "murat"), (ps, "selin")):
            pg.goto(BASE, wait_until="domcontentloaded", timeout=60000)
            pg.wait_for_timeout(2500)
            label = "Ben Murat" if who == "murat" else "Ben Selin"
            pg.get_by_text(label).first.click()
            pg.wait_for_timeout(2500)
            pg.get_by_text("🎬", exact=False).first.click()
            pg.wait_for_timeout(3000)

        # Murat salona girer (film başlatır)
        print("\n>>> Murat 'Salona Gir'")
        pm.get_by_role("button", name="Salona Gir").first.click()
        pm.wait_for_timeout(3000)

        print("Murat:", video_state(pm))

        # Selin salona girer
        print(">>> Selin 'Salona Gir'")
        try:
            ps.get_by_role("button", name="Salona Gir").first.click(timeout=8000)
        except Exception:
            # Selin'de düğme görünmüyorsa "Sahnedeki Filme Dön" olabilir
            try:
                ps.get_by_role("button", name="Sahnedeki Filme Dön").first.click(timeout=5000)
            except Exception as e:
                print("  Selin salona giremedi:", e)
        ps.wait_for_timeout(3000)
        print("Selin:", video_state(ps))

        # --- 1) İKİSİ DE HAZIR OLUNCA BAŞLA ---
        print("\n>>> İki cihazın hazır olması bekleniyor (≤20 sn)")
        for _ in range(20):
            pm.wait_for_timeout(1000)
            sm, ss = video_state(pm), video_state(ps)
            if not sm.get("noVideo") and not ss.get("noVideo"):
                if not sm.get("paused") and not ss.get("paused"):
                    break

        sm, ss = video_state(pm), video_state(ps)
        print(f"  Murat: {sm}")
        print(f"  Selin: {ss}")

        log("Murat'ta video oynuyor", not sm.get("noVideo") and not sm.get("paused"), str(sm))
        log("Selin'de video oynuyor", not ss.get("noVideo") and not ss.get("paused"), str(ss))
        # İkisi de 0'a yakın başlamalı (aynı anda)
        both_near_start = sm.get("t", 999) < 25 and ss.get("t", 999) < 25
        log("İkisi de AYNI ANDA başladı (ikisi de ~0'da)",
            both_near_start, f"murat={sm.get('t')} selin={ss.get('t')}")

        # --- 2) OYNARKEN SENKRON YOK ---
        print("\n>>> 12 saniye serbest oynatma (senkron olmamalı)")
        pm.wait_for_timeout(12000)
        sm, ss = video_state(pm), video_state(ps)
        print(f"  Murat: {sm}")
        print(f"  Selin: {ss}")
        log("oynarken ikisi de ilerliyor",
            not sm.get("paused") and not ss.get("paused"), f"{sm} | {ss}")

        # --- 3) BİRİ DURDURURSA İKİSİ DE DURUR ---
        print("\n>>> Murat DURDURUYOR")
        pm.evaluate(
            """() => {
                const v = document.querySelector('video');
                const btn = [...v.parentElement.querySelectorAll('button')]
                    .find(b => /Duraklat/i.test(b.getAttribute('title') || ''));
                if (btn) btn.click();
            }"""
        )
        pm.wait_for_timeout(4000)
        sm, ss = video_state(pm), video_state(ps)
        print(f"  Murat: {sm}")
        print(f"  Selin: {ss}")
        log("Murat durdu", sm.get("paused") is True, str(sm))
        log("Selin de durdu", ss.get("paused") is True, str(ss))

        # --- 4) BİRİ OYNATIRSA GERİDE OLANA HİZALANIR ---
        # Murat biraz sarsın (geride kalsın), sonra oynatsın.
        print("\n>>> Murat 30 saniye geriye sarıyor (geride kalan o olacak)")
        pm.evaluate(
            """() => {
                const v = document.querySelector('video');
                const bar = [...v.parentElement.querySelectorAll('button')]
                    .find(b => (b.getAttribute('title') || '') === 'Sarma');
                const r = bar.getBoundingClientRect();
                const target = Math.max(5, v.currentTime - 30);
                bar.dispatchEvent(new MouseEvent('click', {
                    bubbles: true, cancelable: true,
                    clientX: r.left + r.width * (target / v.duration),
                    clientY: r.top + r.height / 2,
                }));
            }"""
        )
        pm.wait_for_timeout(3000)
        before = {"murat": video_state(pm), "selin": video_state(ps)}
        print(f"  sarma sonrası Murat: {before['murat']}")
        print(f"  sarma sonrası Selin: {before['selin']}")

        print("\n>>> Murat OYNATIYOR (geride olan o)")
        pm.evaluate(
            """() => {
                const v = document.querySelector('video');
                const btn = [...v.parentElement.querySelectorAll('button')]
                    .find(b => /Oynat/i.test(b.getAttribute('title') || ''));
                if (btn) btn.click();
            }"""
        )
        pm.wait_for_timeout(6000)
        after = {"murat": video_state(pm), "selin": video_state(ps)}
        print(f"  oynatma sonrası Murat: {after['murat']}")
        print(f"  oynatma sonrası Selin: {after['selin']}")

        log("Murat oynuyor", after["murat"].get("paused") is False, str(after["murat"]))
        log("Selin oynuyor", after["selin"].get("paused") is False, str(after["selin"]))

        diff = abs(after["murat"].get("t", 0) - after["selin"].get("t", 0))
        log("iki cihaz GERİDE OLANA hizalandı (fark ≤ 8 sn)", diff <= 8,
            f"murat={after['murat'].get('t')} selin={after['selin'].get('t')} fark={diff:.1f}")

        pm.screenshot(path="tests/screenshots_verify/simple_murat.png")
        ps.screenshot(path="tests/screenshots_verify/simple_selin.png")
        browser.close()

    print("\n" + ("SADE MODEL TESTİ GEÇTİ ✅" if not failures else f"BAŞARISIZ: {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
