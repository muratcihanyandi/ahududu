"""Görev 4c: Partner sinemaya girdiğinde bildirim + 'Sinemada' durumu."""

import json
import os
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:33471"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "testfilm60.mp4")

failures = []


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        BASE + path, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=15) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def log(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def upload_video():
    boundary = "----AhududuPresence"
    with open(FIXTURE, "rb") as f:
        data = f.read()
    head = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="media_category"\r\n\r\ncinema\r\n'
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="presence.mp4"\r\n'
        "Content-Type: video/mp4\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        BASE + "/api/media/upload", data=head + data + tail, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode())["url"]


def main():
    for room in api("/api/cinema") or []:
        try:
            api(f"/api/cinema/{room['id']}", "DELETE")
        except Exception:
            pass

    import datetime
    today = datetime.date.today().isoformat()
    video = upload_video()
    api("/api/cinema/calendar/import", "POST", {
        "month": today[:7],
        "replace_existing": True,
        "created_by": "test",
        "showtimes": [{
            "title": "Sinemada Durum Testi",
            "video_url": video,
            "show_date": today,
            "show_time": "21:00",
        }],
    })

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])

        def phone(user):
            ctx = browser.new_context(viewport={"width": 412, "height": 915}, is_mobile=True, has_touch=True)
            page = ctx.new_page()
            page.goto(BASE, wait_until="networkidle")
            page.evaluate(f"localStorage.setItem('ahududu_user', '{user}')")
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(1800)
            return page

        murat = phone("murat")
        selin = phone("selin")

        # Selin ana ekranda bekliyor
        selin.wait_for_timeout(1000)

        # Murat: bilet al + salona gir
        murat.get_by_role("button", name="Sinema").click()
        murat.wait_for_timeout(1800)
        # Takvim artık "Takvimi Gör" ile açılır
        if murat.get_by_role("button", name="Takvimi Gör").count() > 0:
            murat.get_by_role("button", name="Takvimi Gör").click()
            murat.wait_for_timeout(1500)
        murat.get_by_role("button", name="Bilet Al").first.click()
        murat.wait_for_timeout(1200)
        murat.evaluate("() => window.__ahududuBack && window.__ahududuBack()")
        murat.wait_for_timeout(800)

        # Selin'in ana ekranda kaldığını doğrula, sonra salona gir
        selin.locator("nav button").filter(has_text="Ana sayfa").click()
        selin.wait_for_timeout(600)
        murat.get_by_role("button", name="Salona Gir").first.click()

        # Bildirimi hemen yakala (toast göründüğü anda)
        selin.wait_for_timeout(1200)
        selin.screenshot(path=os.path.join(OUT, "p01_selin_bildirim.png"))
        selin_body = selin.locator("body").inner_text()
        has_toast = "sinema salonuna girdi" in selin_body
        log("G4c: Selin giriş bildirimi aldı", has_toast, selin_body[:400])

        murat.wait_for_timeout(3000)

        # Murat'ın profili 'Sinemada' olmalı
        prof = api("/api/auth/profile/murat")
        log("G4c: Murat durumu 'Sinemada'",
            "Sinemada" in (prof.get("status_text") or ""), str(prof.get("status_text")))

        # Selin'in profil kartında da görünmeli
        selin.wait_for_timeout(1500)
        selin.screenshot(path=os.path.join(OUT, "p02_selin_durum.png"))
        selin_body2 = selin.locator("body").inner_text()
        log("G4c: Murat 'Sinemada' Selin ekranında",
            "Sinemada" in selin_body2, selin_body2[:400])

        # Murat salondan çıkınca durum normale dönmeli
        murat.get_by_role("button", name="Salondan Çık").click()
        murat.wait_for_timeout(3000)
        prof2 = api("/api/auth/profile/murat")
        log("G4c: çıkışta durum normale döndü",
            "Sinemada" not in (prof2.get("status_text") or ""), str(prof2.get("status_text")))

        browser.close()

    print()
    if failures:
        print(f"{len(failures)} SORUN: {', '.join(failures)}")
        sys.exit(1)
    print("SİNEMA DURUM/BİLDİRİM TESTİ GEÇTİ ✅")


if __name__ == "__main__":
    main()
