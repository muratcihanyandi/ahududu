"""Sinema: iki taraf arasında gerçek oynatma senkronu testi.

Yerel dev sunucusu gerekli. Test filmi API'ye yüklenir, iki ayrı tarayıcı
bağlamında (Murat ve Selin) aynı salona girilir ve oynat/duraklat/sarma
komutlarının karşı tarafta uygulandığı ölçülür.

Kanıtlar: tests/screenshots_verify/cinema_*.png
"""

import json
import os
import sys
import time
import urllib.request
import uuid

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33475")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_verify")
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "testfilm60.mp4")
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
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def upload_fixture() -> str:
    """Test filmini /api/media/upload ucuna yükler, dönen URL'yi verir."""
    boundary = "----ahududu" + uuid.uuid4().hex
    with open(FIXTURE, "rb") as f:
        content = f.read()
    parts = []
    parts.append(f"--{boundary}\r\n".encode())
    parts.append(b'Content-Disposition: form-data; name="file"; filename="testfilm60.mp4"\r\n')
    parts.append(b"Content-Type: video/mp4\r\n\r\n")
    parts.append(content)
    parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(
        f"{BASE}/api/media/upload?category=chat",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        data = json.loads(res.read().decode())
    return data.get("url") or ""


def open_app(browser, user_id):
    ctx = browser.new_context(viewport={"width": 412, "height": 915})
    page = ctx.new_page()
    page.goto(BASE, wait_until="networkidle")
    page.evaluate(f"localStorage.setItem('ahududu_user','{user_id}')")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)
    return ctx, page


def enter_cinema(page):
    page.get_by_role("button", name="Anılar").first.click()
    page.wait_for_timeout(1000)
    page.get_by_role("button", name="Sinema Salonumuz").first.click()
    page.wait_for_timeout(1800)


def join_room(page):
    """Lobideki filmden salona girer (varsa 'Salona Gir' / 'Perdeyi Aç')."""
    for label in ("Salona Gir", "Perdeyi Aç", "Katıl"):
        btn = page.get_by_role("button", name=label)
        if btn.count():
            btn.first.click()
            page.wait_for_timeout(2500)
            return True
    return False


def current_time(page) -> float:
    return page.evaluate(
        """() => {
            const v = document.querySelector('video');
            return v ? v.currentTime : -1;
        }"""
    )


def main() -> int:
    url = upload_fixture()
    log("test filmi yüklendi", bool(url), url)
    if not url:
        return 1

    room = api(
        "/api/cinema",
        "POST",
        {
            "title": "Senkron Test Filmi",
            "video_url": url,
            "source": "file",
            "kind": "file",
            "created_by": "murat",
        },
    )
    room_id = room["id"]
    print(f"[OK]   oda: {room_id} ({url})")

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(
                    channel=channel,
                    args=[
                        "--autoplay-policy=no-user-gesture-required",
                        "--mute-audio",
                    ],
                )
                print(f"[OK]   tarayıcı: {channel}")
                break
            except Exception as exc:  # noqa: BLE001
                print(f"[..]   {channel}: {str(exc)[:80]}")
        if browser is None:
            return 1

        ctx_a, page_a = open_app(browser, "murat")
        enter_cinema(page_a)
        # Murat filmi başlatır (salona girer)
        joined_a = join_room(page_a)
        log("Murat salona girdi", joined_a)
        page_a.wait_for_timeout(2500)
        page_a.screenshot(path=os.path.join(OUT, "cinema_a_salon.png"))
        a_time = current_time(page_a)
        log("Murat tarafında video oynuyor", a_time > 0, f"t={a_time:.2f}")

        # Selin aynı odaya girer
        ctx_b, page_b = open_app(browser, "selin")
        enter_cinema(page_b)
        joined_b = join_room(page_b)
        log("Selin salona girdi", joined_b)
        page_b.wait_for_timeout(4000)
        page_b.screenshot(path=os.path.join(OUT, "cinema_b_salon.png"))
        b_time = current_time(page_b)
        log("Selin tarafında video oynuyor", b_time > 0, f"t={b_time:.2f}")

        drift = abs(a_time - b_time)
        # Önceki ölçümden bu yana geçen süreyi de hesaba kat.
        log("iki tarafın saniyesi yakın (<= 3 sn)", drift <= 3.0, f"murat={a_time:.2f} selin={b_time:.2f}")

        # Murat duraklatır → Selin'de de duraklamalı
        pause_btn = page_a.locator('[title="Duraklat"]')
        if pause_btn.count():
            pause_btn.first.click()
            page_a.wait_for_timeout(2500)
            paused_b = page_b.evaluate("() => { const v=document.querySelector('video'); return v ? v.paused : null; }")
            log("duraklatma karşı tarafa yansıdı", paused_b is True, f"paused={paused_b}")
            page_a.screenshot(path=os.path.join(OUT, "cinema_a_duraklat.png"))
            page_b.screenshot(path=os.path.join(OUT, "cinema_b_duraklat.png"))
        else:
            log("duraklat düğmesi bulundu", False)

        # Murat 10 sn ileri sarar → Selin'in saniyesi de ilerlemeli
        before_b = current_time(page_b)
        fwd = page_a.locator('[title="10 saniye ileri"]')
        if fwd.count():
            fwd.first.click()
            page_a.wait_for_timeout(2500)
            after_b = current_time(page_b)
            log(
                "sarma karşı tarafa yansıdı",
                after_b - before_b >= 5,
                f"önce={before_b:.2f} sonra={after_b:.2f}",
            )
        else:
            log("ileri sarma düğmesi bulundu", False)

        for ctx in (ctx_a, ctx_b):
            ctx.close()
        browser.close()

    try:
        api(f"/api/cinema/{room_id}", "DELETE")
    except Exception:
        pass

    print(f"\n{len(failures)} hata")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
