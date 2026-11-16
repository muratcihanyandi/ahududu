"""Sohbet/duyuru görevleri testi (yerel sunucu: tests/dev_server.py).

Çalıştırma:
    python tests/test_chat_tasks.py

Kapsam:
  G2. Sohbet her açılışta EN ALTTA açılır (baştan sona kaymaz).
  G3. Yazı yokken mikrofon, yazı varken Gönder düğmesi (WhatsApp gibi).
  G1. Bildirim kararı: sohbet ekranındayken bildirim GÖSTERİLMEZ.
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_TEST_BASE", "http://127.0.0.1:33471")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots")
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
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"{name}.png"))


def seed_messages(count=18):
    """Sohbeti uzun bir konuşmayla doldur (kaydırma testi için)."""
    for i in range(count):
        api("/api/chat/messages", "POST", {
            "sender": "selin" if i % 2 == 0 else "murat",
            "message_type": "text",
            "content": f"Test mesajı {i + 1} — uzunca bir cümle daha " * 1 + "son",
        })
    api("/api/chat/messages", "POST", {
        "sender": "selin",
        "message_type": "text",
        "content": "SON MESAJ: en altta olmalı",
    })


def main():
    seed_messages()

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(
                    channel=channel,
                    args=[
                        "--use-fake-ui-for-media-stream",
                        "--use-fake-device-for-media-stream",
                        "--autoplay-policy=no-user-gesture-required",
                    ],
                )
                print(f"[OK]   tarayıcı: {channel}")
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
            permissions=["microphone"],
        )
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on(
            "console",
            lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None,
        )

        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.setItem('ahududu_user', 'murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1200)

        # ---------------- G2: Sohbet en altta açılır ----------------
        page.locator("nav button").filter(has_text="Sohbet").click()
        page.wait_for_timeout(1500)
        shot(page, "c2_01_sohbet_acilis")

        # Kaydırma animasyonu bitti mi? 1.2 sn sonra konum en altta olmalı.
        page.wait_for_timeout(1200)
        metrics = page.evaluate(
            """() => {
                const box = Array.from(document.querySelectorAll('div')).find(el => {
                    const s = getComputedStyle(el);
                    return s.overflowY === 'auto' && el.scrollHeight > el.clientHeight + 20;
                });
                if (!box) return null;
                return {
                    scrollTop: Math.round(box.scrollTop),
                    maxScroll: Math.round(box.scrollHeight - box.clientHeight),
                    atBottom: Math.abs(box.scrollHeight - box.clientHeight - box.scrollTop) < 4,
                };
            }"""
        )
        log("G2: sohbet doğrudan en altta açılıyor", bool(metrics) and metrics["atBottom"], str(metrics))

        # Ekranda görünen son mesaj "SON MESAJ" olmalı.
        visible = page.evaluate(
            """() => {
                const box = Array.from(document.querySelectorAll('div')).find(el => {
                    const s = getComputedStyle(el);
                    return s.overflowY === 'auto' && el.scrollHeight > el.clientHeight + 20;
                });
                if (!box) return null;
                const rect = box.getBoundingClientRect();
                const nodes = Array.from(box.querySelectorAll('p'));
                const last = nodes[nodes.length - 1];
                if (!last) return null;
                const lr = last.getBoundingClientRect();
                return { text: last.textContent.trim(), visible: lr.top >= rect.top - 2 && lr.bottom <= rect.bottom + 2 };
            }"""
        )
        log("G2: son mesaj görünür", bool(visible) and visible["visible"] and "SON MESAJ" in visible["text"], str(visible))

        # Orta konumdan sonra tekrar sekmeye girip çıksak da en altta kalmalı.
        page.locator("nav button").filter(has_text="Ana sayfa").click()
        page.wait_for_timeout(500)
        page.locator("nav button").filter(has_text="Sohbet").click()
        page.wait_for_timeout(1500)
        metrics2 = page.evaluate(
            """() => {
                const box = Array.from(document.querySelectorAll('div')).find(el => {
                    const s = getComputedStyle(el);
                    return s.overflowY === 'auto' && el.scrollHeight > el.clientHeight + 20;
                });
                return box ? Math.abs(box.scrollHeight - box.clientHeight - box.scrollTop) < 4 : null;
            }"""
        )
        log("G2: sekmeye tekrar girince de en altta", metrics2 is True, str(metrics2))

        # ---------------- G3: mikrofon ↔ gönder ----------------
        mic = page.get_by_role("button", name="Sesli mesaj kaydet")
        log("G3: yazı yokken mikrofon düğmesi", mic.count() == 1)
        log("G3: yazı yokken Gönder gizli", page.get_by_role("button", name="Gönder").count() == 0)

        input_box = page.locator("input[placeholder='Mesaj yaz...']")
        input_box.fill("Merhaba canım")
        page.wait_for_timeout(400)
        shot(page, "c3_01_yazi_var")
        log("G3: yazı varken Gönder düğmesi", page.get_by_role("button", name="Gönder").count() == 1)
        log("G3: yazı varken mikrofon gizli", page.get_by_role("button", name="Sesli mesaj kaydet").count() == 0)

        input_box.fill("")
        page.wait_for_timeout(400)
        log("G3: yazı silinince mikrofon geri gelir", page.get_by_role("button", name="Sesli mesaj kaydet").count() == 1)

        # Ses kaydı (sahte mikrofon) → gönder
        before = len(api("/api/chat/messages?limit=200") or [])
        page.get_by_role("button", name="Sesli mesaj kaydet").click()
        page.wait_for_timeout(2200)
        shot(page, "c3_02_kayit")
        recording_ui = page.get_by_text("Kayıtta…").count() > 0
        log("G3: kayıt arayüzü açıldı", recording_ui)
        page.get_by_role("button", name="Sesli mesajı gönder").click()
        page.wait_for_timeout(4000)
        shot(page, "c3_03_sesli_mesaj_gonderildi")
        after = len(api("/api/chat/messages?limit=200") or [])
        log("G3: sesli mesaj gönderildi", after > before, f"{before} -> {after}")
        body = page.locator("body").inner_text()
        log("G3: sesli mesaj balonda göründü", "0:0" in body or "Sesli mesaj" in body, body[-400:])

        # ---------------- G1: sohbet açıkken bildirim gösterilmez -------------
        notify_calls = page.evaluate(
            """() => {
                window.__notifyProbe = [];
                const original = window.Notification;
                function Probe(title, options) { window.__notifyProbe.push(title); }
                Probe.permission = 'granted';
                Probe.requestPermission = () => Promise.resolve('granted');
                window.Notification = Probe;
                return true;
            }"""
        )
        api("/api/chat/messages", "POST", {
            "sender": "selin", "message_type": "text", "content": "sohbet açıkken geldi",
        })
        page.wait_for_timeout(1500)
        body = page.locator("body").inner_text()
        log("G1: sohbet açıkken mesaj geldi", "sohbet açıkken geldi" in body, body[-300:])
        log("G1: sohbet açıkken sistem bildirimi yok", page.evaluate("() => window.__notifyProbe.length") == 0,
            str(page.evaluate("() => window.__notifyProbe")))

        errors = [e for e in errors if "favicon" not in e.lower() and "net::ERR" not in e and "404" not in e]
        log("konsol hatası yok", len(errors) == 0, " | ".join(errors[:4]))
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} SORUN: {', '.join(failures)}")
        return 1
    print("SOHBET GÖREVLERİ GEÇTİ ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
