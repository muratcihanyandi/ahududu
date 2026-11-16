"""Canlı sunucuda görsel kontrol (4 görev)."""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://192.168.2.170:33470"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots")

failures = []


def log(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    ctx = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

    page.goto(BASE, wait_until="networkidle")
    page.evaluate("localStorage.setItem('ahududu_user', 'murat')")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(2500)
    page.screenshot(path=os.path.join(OUT, "live_00_ana.png"))

    # Görev 2 & 3: sohbet
    page.get_by_role("button", name="Sohbet").click()
    page.wait_for_timeout(1800)
    page.screenshot(path=os.path.join(OUT, "live_01_sohbet.png"))
    body = page.locator("body").inner_text()
    log("G3: sade başlık (Selin)", "ile Sohbet" not in body, body[:200])

    # Görev 1: geri tuşu köprüsü
    has_back = page.evaluate("() => typeof window.__ahududuBack === 'function'")
    log("G1: geri köprüsü", has_back)
    handled = page.evaluate("() => window.__ahududuBack()")
    page.wait_for_timeout(600)
    log("G1: sekmeden geri çalışıyor", handled is True, str(handled))

    # Görev 4: sinema takvimi
    page.get_by_role("button", name="Sinema").click()
    page.wait_for_timeout(2500)
    page.screenshot(path=os.path.join(OUT, "live_02_sinema_takvim.png"))
    body2 = page.locator("body").inner_text()
    log("G4: takvim perdesi", "PERDESİ" in body2.upper(), body2[:300])
    log("G4: film ekle", page.get_by_role("button", name="Film Ekle").count() > 0)
    log("G4: salon durumu", "Salon Durumu" in body2, body2[:300])

    # Hamam: yeni veri girmeyelim, sadece görünüm
    errors = [e for e in errors if "favicon" not in e.lower() and "net::ERR" not in e]
    log("konsol hatası yok", len(errors) == 0, " | ".join(errors[:3]))
    browser.close()

print()
if failures:
    print(f"{len(failures)} SORUN: {', '.join(failures)}")
    sys.exit(1)
print("CANLI GÖRSEL KONTROL GEÇTİ ✅")
