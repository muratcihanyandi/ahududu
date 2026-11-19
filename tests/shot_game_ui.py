"""Ekran görüntüsü: gerçek GPU ile (sahte değil) oyun menüsü ve sürüş ekranı."""

import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / "frontend" / "public" / "games" / "uno-com-escada" / "index.html").as_uri()
UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    for label, w, h in [("menu_844x390", 844, 390), ("menu_740x360", 740, 360)]:
        ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=True, is_mobile=True,
                            device_scale_factor=2, user_agent=UA)
        pg = ctx.new_page()
        pg.goto(URL)
        pg.wait_for_function("() => window.__cap && window.__cap.ready()", timeout=180000)
        pg.wait_for_timeout(1200)
        pg.screenshot(path=str(ROOT / "tests" / f"_shot_{label}.png"))
        # sürüş: Başla'ya bas, gazı basılı tut
        pg.click("#b0")
        pg.wait_for_timeout(500)
        pg.evaluate("() => { if (window.__cap && window.__cap.GS) window.__cap.GS.held = 1; }")
        pg.wait_for_timeout(2500)
        pg.screenshot(path=str(ROOT / "tests" / f"_shot_{label}_drive.png"))
        ctx.close()
    b.close()
print("ok")
