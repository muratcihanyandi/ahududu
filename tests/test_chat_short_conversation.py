"""Kısa konuşmada baloncukların EN ALTA yaslandığını doğrular (WhatsApp gibi).

Temiz DB'li dev sunucu gerekir:
    $env:PORT=33472; $env:DATABASE_URL="sqlite+aiosqlite:///<temp>/ahududu_chat_short.db"
    python tests/dev_server.py
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_TEST_BASE", "http://127.0.0.1:33472")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_chat")
os.makedirs(OUT, exist_ok=True)

failures = []


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        BASE + path, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def log(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def main():
    existing = api("/api/chat/messages?limit=200") or []
    if not existing:
        api("/api/chat/messages", "POST", {
            "sender": "selin", "message_type": "text",
            "content": "Seni çok özledim 💞",
        })
        api("/api/chat/messages", "POST", {
            "sender": "murat", "message_type": "text",
            "content": "Ben de, gel sarılalım mı?",
        })
        api("/api/chat/messages", "POST", {
            "sender": "selin", "message_type": "text",
            "content": "Şimdi geliyorum 🐻",
        })

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(channel=channel)
                break
            except Exception:
                continue
        if browser is None:
            print("HATA: tarayıcı yok")
            return 1

        ctx = browser.new_context(
            viewport={"width": 412, "height": 915},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = ctx.new_page()
        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.setItem('ahududu_user', 'murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1300)
        page.locator("nav button").filter(has_text="Sohbet").click()
        page.wait_for_timeout(1500)

        metrics = page.evaluate(
            """() => {
                const root = document.querySelector('[data-chat-root="true"]');
                const scroller = root.querySelector('.overflow-y-auto');
                const inner = scroller.firstElementChild;
                const bubbles = Array.from(scroller.querySelectorAll('p'));
                const last = bubbles[bubbles.length - 1];
                const first = bubbles[0];
                // Son baloncuğun DIŞ kutusu (saat damgası ve dolgusu dahil).
                const lastRow = last
                    ? last.closest('div').parentElement
                    : null;
                return {
                    innerClass: inner ? inner.className : null,
                    innerMarginTop: inner ? getComputedStyle(inner).marginTop : null,
                    scrollerBottom: Math.round(scroller.getBoundingClientRect().bottom),
                    lastRowBottom: lastRow
                        ? Math.round(lastRow.getBoundingClientRect().bottom)
                        : null,
                    firstTop: first ? Math.round(first.getBoundingClientRect().top) : null,
                    scrollerTop: Math.round(scroller.getBoundingClientRect().top),
                    scrollHeight: scroller.scrollHeight,
                    clientHeight: scroller.clientHeight,
                    bubbleCount: bubbles.length,
                };
            }"""
        )
        page.screenshot(path=os.path.join(OUT, "11_kisa_konusma_en_altta.png"))
        print("      tests/screenshots_chat/11_kisa_konusma_en_altta.png")

        log("kısa konuşma kaydırma gerektirmiyor (taşma yok)",
            metrics["scrollHeight"] <= metrics["clientHeight"] + 1, str(metrics))
        log("içerik sarmalayıcı mt-auto", "mt-auto" in (metrics["innerClass"] or ""), str(metrics))
        log("son baloncuk listenin en altına yaslı",
            metrics["lastRowBottom"] is not None
            and 0 <= metrics["scrollerBottom"] - metrics["lastRowBottom"] <= 22,
            str(metrics))
        log("konuşma üstte değil, altta başlıyor",
            metrics["firstTop"] is not None
            and metrics["firstTop"] > metrics["scrollerTop"] + 100,
            str(metrics))

        browser.close()

    if failures:
        print(f"{len(failures)} SORUN: {', '.join(failures)}")
        return 1
    print("KISA KONUŞMA HİZALAMASI GEÇTİ ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
