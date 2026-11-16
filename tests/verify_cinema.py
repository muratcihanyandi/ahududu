"""Sinema salonu görsel doğrulama.

Yerel dev sunucusu gerekli (bkz. tests/dev_server.py).
Kanıtlar: tests/screenshots_verify/cinema_*.png
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33475")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_verify")
os.makedirs(OUT, exist_ok=True)

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
    with urllib.request.urlopen(req, timeout=15) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def main() -> int:
    # Test odası: doğrudan video (html5) — senkron motorunu gerçekten çalıştırır.
    room = api(
        "/api/cinema",
        "POST",
        {
            "title": "Senkron Test Filmi",
            "video_url": "/api/media/file/test.mp4",
            "source": "file",
            "kind": "file",
            "created_by": "murat",
        },
    )
    room_id = room.get("id")
    print(f"[OK]   oda oluşturuldu: {room_id}")

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(
                    channel=channel,
                    args=["--autoplay-policy=no-user-gesture-required"],
                )
                print(f"[OK]   tarayıcı: {channel}")
                break
            except Exception as exc:  # noqa: BLE001
                print(f"[..]   {channel}: {str(exc)[:80]}")
        if browser is None:
            return 1

        ctx = browser.new_context(viewport={"width": 412, "height": 915})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.setItem('ahududu_user','murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1200)

        # Anılar → Sinema
        page.get_by_role("button", name="Anılar").first.click()
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Sinema Salonumuz").first.click()
        page.wait_for_timeout(2000)
        page.screenshot(path=os.path.join(OUT, "cinema_01_lobby.png"))
        log("sinema lobisi açıldı", page.locator("text=Sinema Salonu").count() > 0)

        # Salona gir
        enter = page.get_by_role("button", name="Salona Gir")
        if not enter.count():
            enter = page.get_by_role("button", name="Perdeyi Aç")
        if enter.count():
            enter.first.click()
            page.wait_for_timeout(3000)
            page.screenshot(path=os.path.join(OUT, "cinema_02_screen.png"))
            log("salon açıldı", page.locator("text=Salondan Çık").count() > 0)
        else:
            log("salona giriş düğmesi bulundu", False)

        controls = page.locator('[title="10 saniye ileri"]').count()
        log("senkron kontrol çubuğu (ileri/geri) var", controls > 0, f"count={controls}")
        log("sayfada JS hatası yok", not errors, "; ".join(errors[:3]))

        ctx.close()
        browser.close()

    # Temizlik
    try:
        api(f"/api/cinema/{room_id}", "DELETE")
    except Exception:
        pass

    print(f"\n{len(failures)} hata")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
