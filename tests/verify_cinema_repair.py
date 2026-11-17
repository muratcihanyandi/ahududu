"""Boş `stream_url`'li (Pi'deki bozuk) oda — kendini onarabiliyor mu?

Pi'de oda 40 şöyle: source=stream, kind=hls, stream_url=BOŞ, video_url=film
sayfası. Bu durumda salon sitenin sayfasını gösterip kara ekrana düşüyordu.

Bu test o durumu BİREBİR kurar ve salonun kendiliğinden akışı çözüp filmi
oynatmaya başladığını doğrular. Yerel dev sunucusu gerekli.
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33482")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_verify")
os.makedirs(OUT, exist_ok=True)

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


def main():
    # Pi'deki bozuk kaydın BİREBİR aynısı: akış yok, site sayfası var.
    # `kind=hls` gönderiyoruz ki eski hatayı (html5 sanıp <video src=sayfa>)
    # da yeniden üretelim.
    room = api("/api/cinema", "POST", {
        "title": "Arabalar (bozuk kayit)",
        "video_url": FILM_PAGE,
        "created_by": "murat",
        "kind": "hls",
        "source": "stream",
        # stream_url YOK — Pi'deki durum
    })
    log("bozuk oda kuruldu (stream_url boş)",
        not room.get("stream_url"), f"stream={room.get('stream_url')}")
    api(f"/api/cinema/{room['id']}/start", "POST", {"user_id": "murat"})

    with sync_playwright() as p:
        chrome_paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ]
        exe = next((x for x in chrome_paths if os.path.exists(x)), None)
        launch = {"headless": True, "args": ["--disable-gpu", "--autoplay-policy=no-user-gesture-required"]}
        if exe:
            launch["executable_path"] = exe
        browser = p.chromium.launch(**launch)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.get_by_role("button", name="Salona Gir").first.click()

        # Onarım akışı: sitenin çözümlenmesi + hls.js yüklenmesi zaman alır.
        print("  onarım bekleniyor (≤45 sn)...")
        result = None
        for _ in range(15):
            page.wait_for_timeout(3000)
            result = page.evaluate(
                """async () => {
                    const v = document.querySelector('video');
                    if (!v) return { stage: 'video yok (site iframe görünüyor olabilir)' };
                    const t0 = v.currentTime;
                    await new Promise(r => setTimeout(r, 3000));
                    const t1 = v.currentTime;
                    return {
                        src: (v.currentSrc || '').slice(0, 90),
                        w: v.videoWidth, h: v.videoHeight,
                        dur: v.duration, paused: v.paused,
                        progressed: +(t1 - t0).toFixed(2),
                    };
                }"""
            )
            if result and (result.get("progressed") or 0) > 1:
                break

        page.screenshot(path=os.path.join(OUT, "cinema_repair_fixed.png"))
        browser.close()

    print("\n--- ÖLÇÜM ---")
    for k, val in (result or {}).items():
        print(f"  {k}: {val}")

    log("salonda <video> oluştu", "src" in (result or {}), str((result or {}).get("stage")))
    log("çözülen akış oynatıldı", float((result or {}).get("progressed") or 0) > 1.0,
        str(result))
    log("video boyutu geçerli", int((result or {}).get("w") or 0) > 0, str(result))

    # Sunucudaki kayıt da onarılmış olmalı
    rooms = api("/api/cinema")
    fixed = next((r for r in rooms if r["id"] == room["id"]), None)
    log("sunucu kaydına akış yazıldı", bool(fixed and fixed.get("stream_url")),
        str(fixed.get("stream_url"))[:80] if fixed else "kayit yok")

    if errors:
        print("\nsayfa hataları:", errors[:5])

    print("\n" + ("ONARIM TESTİ GEÇTİ ✅" if not failures else f"BAŞARISIZ: {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
