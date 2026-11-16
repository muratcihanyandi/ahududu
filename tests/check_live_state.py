"""Canlı uygulamada day counter ve pet name placeholder kontrolü."""

import json
import os
import sys

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://192.168.2.170:33470"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots")

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome")
    ctx = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    page.goto(BASE, wait_until="networkidle")
    page.evaluate("localStorage.setItem('ahududu_user', 'murat')")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(3000)

    body = page.locator("body").inner_text()
    print("=== ANA SAYFA (ilk 400) ===")
    print(body[:400])
    day_line = [l for l in body.split("\n") if "gün" in l.lower()]
    print("GÜN SATIRI:", day_line)
    page.screenshot(path=os.path.join(OUT, "chk_ana.png"))

    # Hayvan ekleme placeholder
    page.locator("nav button").filter(has_text="Anılar").click()
    page.wait_for_timeout(1500)
    page.get_by_role("button", name="Hayvanlar").click()
    page.wait_for_timeout(1500)
    if page.get_by_role("button", name="Dost Ekle").count() > 0:
        page.get_by_role("button", name="Dost Ekle").click()
        page.wait_for_timeout(900)
        phs = page.evaluate("""() => Array.from(document.querySelectorAll('input, textarea'))
            .map(i => i.placeholder).filter(Boolean)""")
        print("PLACEHOLDERLAR:", json.dumps(phs, ensure_ascii=False))
        page.screenshot(path=os.path.join(OUT, "chk_hayvan.png"))

    browser.close()
