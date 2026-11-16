"""Sinema: geç katılan tarafın gecikmesini ölçer.

İki bağlam: Murat filmi 6-8 saniye oynattıktan SONRA Selin katılır.
Selin'in saniyesi Murat'a 2-3 saniye içinde yaklaşmalı (kalp atışı
yetişme mantığı). Ayrıca elle oynat/duraklat senkronu bozulmamalı.

Kullanım:
    $env:PORT=33475; python tests/dev_server.py
    python tests/verify_cinema_latejoin.py
"""

import json
import os
import sys
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
    boundary = "----ahududu" + uuid.uuid4().hex
    content = open(FIXTURE, "rb").read()
    body = b"".join([
        f"--{boundary}\r\n".encode(),
        b'Content-Disposition: form-data; name="file"; filename="testfilm60.mp4"\r\n',
        b"Content-Type: video/mp4\r\n\r\n",
        content,
        f"\r\n--{boundary}--\r\n".encode(),
    ])
    req = urllib.request.Request(
        f"{BASE}/api/media/upload?category=chat", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode()).get("url") or ""


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
    page.wait_for_timeout(900)
    page.get_by_role("button", name="Sinema Salonumuz").first.click()
    page.wait_for_timeout(1600)


def join_room(page):
    for label in ("Salona Gir", "Sahnedeki Filme Dön", "Perdeyi Aç", "Katıl"):
        btn = page.get_by_role("button", name=label)
        if btn.count():
            btn.first.click()
            page.wait_for_timeout(2000)
            return True
    return False


def t(page):
    return page.evaluate("() => { const v=document.querySelector('video'); return v ? v.currentTime : -1; }")


def main() -> int:
    url = upload_fixture()
    if not url:
        print("[FAIL] fixture yüklenemedi")
        return 1
    room = api("/api/cinema", "POST", {
        "title": "Geç Katılım Testi", "video_url": url,
        "source": "file", "kind": "file", "created_by": "murat",
    })
    room_id = room["id"]

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(channel=channel, args=["--autoplay-policy=no-user-gesture-required", "--mute-audio"])
                break
            except Exception as exc:  # noqa: BLE001
                print(f"[..] {channel}: {str(exc)[:70]}")
        if browser is None:
            return 1

        ctx_a, page_a = open_app(browser, "murat")
        enter_cinema(page_a)
        log("Murat salona girdi", join_room(page_a))

        # Murat 8 saniye tek başına izlesin
        page_a.wait_for_timeout(8000)
        before_a = t(page_a)
        print(f"[..]   Murat'ın saniyesi: {before_a:.2f}")

        # Şimdi Selin katılır
        ctx_b, page_b = open_app(browser, "selin")
        enter_cinema(page_b)
        joined = join_room(page_b)
        log("Selin salona katıldı", joined)
        page_b.wait_for_timeout(1500)
        at_join = t(page_b)
        a_now = t(page_a)
        gap_join = a_now - at_join
        print(f"[..]   katılım anı: murat={a_now:.2f} selin={at_join:.2f} fark={gap_join:.2f}")

        # Kalp atışı yetişmesi için bekle
        page_b.wait_for_timeout(5000)
        at_5s = t(page_b)
        a_5s = t(page_a)
        gap_5 = a_5s - at_5s
        print(f"[..]   5 sn sonra: murat={a_5s:.2f} selin={at_5s:.2f} fark={gap_5:.2f}")

        log("geç katılan yetişti (fark <= 2 sn)", abs(gap_5) <= 2.0, f"fark={gap_5:.2f}")
        log("katılım anına göre iyileşti", abs(gap_5) <= abs(gap_join) + 0.3,
            f"katılım={gap_join:.2f} → 5sn={gap_5:.2f}")
        page_b.screenshot(path=os.path.join(OUT, "cinema_latejoin_b.png"))
        page_a.screenshot(path=os.path.join(OUT, "cinema_latejoin_a.png"))

        # Senkron hâlâ çalışıyor mu: Murat duraklatır → Selin durur
        pause = page_a.locator('[title="Duraklat"]')
        if pause.count():
            pause.first.click()
            page_a.wait_for_timeout(2500)
            paused_b = page_b.evaluate("() => { const v=document.querySelector('video'); return v ? v.paused : null; }")
            log("duraklatma hâlâ karşı tarafa yansıyor", paused_b is True, f"paused={paused_b}")
        else:
            log("duraklat düğmesi bulundu", False)

        ctx_a.close()
        ctx_b.close()
        browser.close()

    try:
        api(f"/api/cinema/{room_id}", "DELETE")
    except Exception:
        pass

    print(f"\n{len(failures)} hata")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
