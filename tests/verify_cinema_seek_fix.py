"""Sarma sonrası "başlamıyor / başlıyor duruyor" hatası — düzeltme doğrulaması.

Gerçek kullanıcı senaryosu:
  1. Filmi aç, biraz oynasın.
  2. İlerleme çubuğundan 7. dakikaya sar.
  3. Oynat.
  4. Video kendiliğinden devam ediyor mu? (durup kalmıyor mu?)
  5. Ara vermeden 20 sn oynuyor mu?
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33484")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_verify")
os.makedirs(OUT, exist_ok=True)

FILM_PAGE = "https://www.fullhdfilmizlesene.now/film/arabalar/"
SEEK_TO = 420

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
    if not resolved.get("stream_url"):
        log("akış çözüldü", False, str(resolved)[:150])
        return 1
    room = api("/api/cinema", "POST", {
        "title": "Arabalar - sarma duzeltme",
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

        if not page.evaluate("() => !!document.querySelector('video')"):
            log("salonda video var", False)
            browser.close()
            return 1

        # --- 7. dakikaya sar ---
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
        print(f"7. dakikaya ({SEEK_TO} sn) sarıldı, yükleme bekleniyor...")
        page.wait_for_timeout(1200)

        # --- Sarma sürerken OYNAT'a bas (kullanıcının yaptığı) ---
        page.evaluate(
            """() => {
                const v = document.querySelector('video');
                const btn = [...v.parentElement.querySelectorAll('button')]
                    .find(b => /Oynat|Duraklat/i.test(b.getAttribute('title') || ''));
                if (btn) btn.click();
            }"""
        )
        page.wait_for_timeout(2500)
        page.screenshot(path=os.path.join(OUT, "cinema_seek_busy.png"))

        # --- Yükleme bitince kendiliğinden oynamalı ---
        print("Yükleme bitişi bekleniyor (≤25 sn)...")
        state = None
        for _ in range(25):
            state = page.evaluate(
                """() => {
                    const v = document.querySelector('video');
                    return { t: +v.currentTime.toFixed(1), paused: v.paused,
                             rs: v.readyState, seeking: v.seeking };
                }"""
            )
            if not state["seeking"] and not state["paused"] and state["rs"] >= 3:
                break
            page.wait_for_timeout(1000)

        print("SARMA SONRASI:", state)
        log("7. dakikaya yakın konum", abs((state.get("t") or 0) - SEEK_TO) < 25, str(state))
        log("sarma bitince KENDİLİĞİNDEN oynadı", state.get("paused") is False, str(state))

        # --- 20 saniye kesintisiz oynuyor mu? ---
        run = page.evaluate(
            """async () => {
                const v = document.querySelector('video');
                const t0 = v.currentTime;
                let pausedCount = 0;
                for (let i = 0; i < 20; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    if (v.paused) pausedCount++;
                }
                return { progressed: +(v.currentTime - t0).toFixed(2),
                         pausedCount, finalT: +v.currentTime.toFixed(1),
                         finalPaused: v.paused };
            }"""
        )
        print("\n20 SN OYNATMA:", json.dumps(run, ensure_ascii=False))
        log("20 sn kesintisiz oynadı", float(run.get("progressed") or 0) > 15, str(run))
        log("kendi kendine durmadı", run.get("pausedCount") == 0, str(run))

        page.screenshot(path=os.path.join(OUT, "cinema_seek_after.png"))
        browser.close()

    print("\n" + ("SARMA DÜZELTMESİ GEÇTİ ✅" if not failures else f"BAŞARISIZ: {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
