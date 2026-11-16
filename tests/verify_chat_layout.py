"""Sohbet ekranı görsel doğrulama (WhatsApp düzeni).

Yerel dev sunucusu gerekli. Kullanım:
    $env:PORT=33475; python tests/dev_server.py
    python tests/verify_chat_layout.py

Kanıtlar: tests/screenshots_verify/
  chat_01.png — sohbet ekranı (başlık yapışık, composer nav üstünde)
  chat_02.png — kayıt modu (basılı tut)
  chat_03.png — diğer sekmeler (yüzen bar)
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
    with urllib.request.urlopen(req, timeout=10) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def seed_chat():
    for text in ["Seni çok seviyorum 💕", "Bugün ne yapıyorsun?", "Seni düşünüyordum 🥰"]:
        api("/api/chat/messages", "POST", {"sender": "selin", "message_type": "text", "content": text})
    api("/api/chat/messages", "POST", {"sender": "murat", "message_type": "text", "content": "Ben de seni 💞"})


def main() -> int:
    seed_chat()
    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(
                    channel=channel,
                    args=[
                        "--autoplay-policy=no-user-gesture-required",
                        "--use-fake-ui-for-media-stream",
                        "--use-fake-device-for-media-stream",
                    ],
                )
                print(f"[OK]   tarayıcı: {channel}")
                break
            except Exception as exc:  # noqa: BLE001
                print(f"[..]   {channel}: {str(exc)[:80]}")
        if browser is None:
            print("[FAIL] tarayıcı yok")
            return 1

        ctx = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=1)
        page = ctx.new_page()
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.setItem('ahududu_user','murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1500)

        # Sohbet sekmesi
        page.get_by_role("button", name="Sohbet").first.click()
        page.wait_for_timeout(1800)
        page.screenshot(path=os.path.join(OUT, "chat_01.png"))

        metrics = page.evaluate(
            """() => {
                const nav = document.querySelector('[data-navigation-variant]');
                const header = document.querySelector('header');
                const main = document.querySelector('main');
                const root = main?.firstElementChild || null;
                const input = document.querySelector('input[placeholder="Mesaj yaz..."]');
                const composer = input?.closest('div.shrink-0') || input?.parentElement?.parentElement || null;
                const list = document.querySelector('main [class*="overflow-y-auto"]');
                const rect = (el) => el ? el.getBoundingClientRect() : null;
                return {
                    navVariant: nav?.getAttribute('data-navigation-variant') || null,
                    navRect: rect(nav),
                    headerRect: rect(header),
                    rootRect: rect(root),
                    composerRect: rect(composer),
                    listRect: rect(list),
                    mainRect: rect(main),
                    viewportH: window.innerHeight,
                };
            }"""
        )
        print(json.dumps(metrics, indent=2, ensure_ascii=False))

        log("sohbet sekmesinde nav 'attached'", metrics["navVariant"] == "attached", str(metrics["navVariant"]))
        nav, comp, header = metrics["navRect"], metrics["composerRect"], metrics["headerRect"]
        if nav and comp:
            gap = nav["top"] - comp["bottom"]
            log("composer nav'a yapışık (boşluk < 2px)", abs(gap) < 2, f"gap={gap:.1f}")
        else:
            log("composer ve nav ölçüldü", False, "ölçüm yok")
        if header and metrics["rootRect"]:
            gap = metrics["rootRect"]["top"] - header["bottom"]
            log("sohbet başlığı app başlığına yapışık (boşluk < 2px)", abs(gap) < 2, f"gap={gap:.1f}")
        else:
            log("başlık ölçüldü", False)
        if comp:
            log("composer ekran içinde", comp["bottom"] <= metrics["viewportH"] + 1, f"{comp['bottom']}")
        if metrics["listRect"]:
            log("mesaj listesi kaydırılabilir alan", metrics["listRect"]["height"] > 200, f"{metrics['listRect']['height']}")

        # Kayıt modu: mikrofona basılı tut
        mic = page.get_by_role("button", name="Sesli mesaj kaydet")
        if mic.count():
            box = mic.first.bounding_box()
            if box:
                page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                page.mouse.down()
                page.wait_for_timeout(1400)
                page.screenshot(path=os.path.join(OUT, "chat_02.png"))
                page.mouse.up()
                page.wait_for_timeout(800)
                log("basılı tutunca kayıt arayüzü açıldı", True)
        else:
            log("mikrofon düğmesi bulundu", False)

        # Diğer sekme: nav yüzen olmalı
        page.get_by_role("button", name="Ana sayfa").first.click()
        page.wait_for_timeout(1000)
        page.screenshot(path=os.path.join(OUT, "chat_03.png"))
        variant = page.evaluate(
            "() => document.querySelector('[data-navigation-variant]')?.getAttribute('data-navigation-variant')"
        )
        log("diğer sekmelerde nav 'floating'", variant == "floating", str(variant))

        ctx.close()
        browser.close()

    print(f"\n{len(failures)} hata")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
