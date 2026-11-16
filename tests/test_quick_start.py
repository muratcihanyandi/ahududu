"""Boş takvimde 'örnek program kur' ve gün kontrastı kontrolü."""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:33471"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots")
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


# Takvimi boşalt
import datetime
month = datetime.date.today().isoformat()[:7]
for s in api(f"/api/cinema/calendar?month={month}") or []:
    api(f"/api/cinema/calendar/{s['id']}", "DELETE")
for r in api("/api/cinema") or []:
    api(f"/api/cinema/{r['id']}", "DELETE")

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    ctx = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(BASE, wait_until="networkidle")
    page.evaluate("localStorage.setItem('ahududu_user', 'murat')")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1800)
    page.get_by_role("button", name="Sinema").click()
    page.wait_for_timeout(2000)
    page.screenshot(path=os.path.join(OUT, "qs_00_bos.png"))

    log("boş takvim mesajı", page.get_by_text("Bu gün seans yok").count() > 0
        or page.get_by_text("seans yok").count() > 0)
    quick = page.get_by_role("button", name="Bu ay için örnek program kur")
    log("örnek program düğmesi var", quick.count() > 0)

    if quick.count() > 0:
        quick.click()
        page.wait_for_timeout(3500)
        page.screenshot(path=os.path.join(OUT, "qs_01_kuruldu.png"), full_page=True)
        shows = api(f"/api/cinema/calendar?month={month}")
        log("örnek program kuruldu (4 seans)", len(shows) == 4, str(len(shows)))
        log("filmler takvimde", page.get_by_text("Aşk Tesadüfleri Sever").count() > 0
            or page.get_by_text("La La Land").count() > 0)

        # Gün rengi kontrastı: gelecek bir günün yazı rengi soluk olmamalı
        color = page.evaluate("""() => {
            const cells = Array.from(document.querySelectorAll('button'))
                .filter(b => /^\\d{1,2}$/.test((b.textContent || '').trim()));
            if (!cells.length) return null;
            const last = cells[cells.length - 1];
            return getComputedStyle(last).color;
        }""")
        log("gelecek günler okunaklı (koyu ahududu)",
            color is not None and color in ("rgb(80, 7, 36)", "rgb(135, 11, 72)"), str(color))

    browser.close()

print()
if failures:
    print(f"{len(failures)} SORUN: {', '.join(failures)}")
    sys.exit(1)
print("BOŞ TAKVİM BAŞLANGICI GEÇTİ ✅")
