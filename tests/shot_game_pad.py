"""Sürüş ekranı: menü kapatıldıktan sonra kumanda düğmelerinin yerleşimi."""

import sys
from pathlib import Path

sys.path.insert(0, "tests")
import test_game_logic as LU  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
URL = (ROOT / "frontend" / "public" / "games" / "uno-com-escada" / "index.html").as_uri()
UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36"

with sync_playwright() as p:
    b = p.chromium.launch(channel="chrome", headless=True)
    for w, h in [(844, 390), (640, 320)]:
        ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=True, is_mobile=True,
                            device_scale_factor=2, user_agent=UA)
        pg = ctx.new_page()
        pg.add_init_script(LU.HARNESS)
        pg.goto(URL)
        pg.wait_for_function("() => window.__cap && window.__cap.ready()", timeout=180000)
        pg.wait_for_timeout(1500)
        print((w, h), pg.evaluate("() => ({ ui: getComputedStyle(document.getElementById('ui')).display, body: document.body.className })"))
        # menüyü doğrudan kapat (oyun sürüş durumuna geç)
        pg.evaluate("() => { document.getElementById('ui').style.display = 'none'; document.body.className = 'has-touch'; }")
        pg.wait_for_timeout(400)
        pg.screenshot(path=str(ROOT / "tests" / f"_shot_pad_{w}x{h}.png"))
        ctx.close()
    b.close()
print("ok")
