"""Anket oyları (iki tarafta) + ataç panelinin alttan kayması — uçtan uca test.

Gereksinim: backend test sunucusu 33480 portunda çalışıyor olmalı
    python -m uvicorn backend.app.main:app --port 33480
Kullanım:
    python tests/test_poll_and_sheet.py

İki ayrı tarayıcı bağlamı iki kişiyi (Murat / Selin) canlandırır:
  1. Murat anket açar, Selin oy verir  -> Murat'ın ekranında da işaret görünmeli
  2. Murat oy verir                    -> Selin'in ekranında da işaret görünmeli
  3. Uygulama yeniden açılınca oylar sunucudan gelmeli
  4. Ataç paneli ekranın altından KAYARAK açılmalı (konum animasyonu)
"""

import json
import os
import sys
import tempfile
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_TEST_BASE", "http://127.0.0.1:33480")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_chat")
os.makedirs(OUT, exist_ok=True)

VIEWPORT = {"width": 1080, "height": 2340}
failures = []

CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def log(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def shot(page, name):
    path = os.path.join(OUT, f"{name}.png")
    page.screenshot(path=path)
    print("     ", os.path.relpath(path, ROOT))


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        BASE + path, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def launch_browser(pw):
    try:
        return pw.chromium.launch()
    except Exception:
        for path in CHROME_CANDIDATES:
            if os.path.isfile(path):
                print("     (yerel tarayıcı:", path, ")")
                return pw.chromium.launch(executable_path=path)
        raise


def open_chat(context, user_label):
    """Uygulamayı aç, kişiyi seç, sohbet sekmesine geç."""
    page = context.new_page()
    page.goto(BASE, wait_until="networkidle")
    page.wait_for_timeout(600)
    picker = page.get_by_role("button", name=f"Ben {user_label}'im")
    if picker.count():
        picker.first.click()
        page.wait_for_timeout(700)
    page.locator('[data-navigation-variant] button[aria-label="Sohbet"]').first.click()
    page.wait_for_selector('[data-chat-root="true"]', timeout=15000)
    page.wait_for_timeout(900)
    return page


def poll_bubble_options(page, question):
    """Belirtilen sorunun seçeneklerini (oy butonlarını) döndürür."""
    return page.locator(
        f'[data-chat-root="true"] button[aria-label*="oy"]:near(:text("{question}"))'
    )


def poll_state(page, option_label):
    """Bir seçeneğin (işaretli mi?, oy sayısı) durumunu döndürür."""
    return page.evaluate(
        """(label) => {
            const buttons = Array.from(
                document.querySelectorAll('[data-chat-root="true"] button[aria-label*="oy"]')
            );
            const b = buttons.find((el) => el.textContent.trim().startsWith(label.replace(/\\s+/g, ' ').slice(0, 6)));
            if (!b) return null;
            const labelText = b.getAttribute('aria-label') || '';
            const count = Number((labelText.split('—').pop() || '').replace(/[^0-9]/g, ''));
            return { pressed: b.getAttribute('aria-pressed'), count, text: b.textContent.trim() };
        }""",
        option_label,
    )


def panel_positions(page):
    """Ataç panelinin animasyon sırasındaki konumları."""
    return page.evaluate(
        """() => {
            const layer = document.querySelector('[data-chat-attach-layer="true"]');
            const sheet = document.querySelector('.chat-attach-sheet');
            if (!layer || !sheet) return null;
            const r = sheet.getBoundingClientRect();
            return { top: Math.round(r.top), height: Math.round(r.height), vh: window.innerHeight,
                     transform: getComputedStyle(sheet).transform };
        }"""
    )


def main():
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        shared = dict(
            viewport=VIEWPORT,
            is_mobile=True,
            has_touch=True,
            locale="tr-TR",
            timezone_id="Europe/Istanbul",
        )
        murat_ctx = browser.new_context(**shared)
        selin_ctx = browser.new_context(**shared)

        murat = open_chat(murat_ctx, "Murat")
        selin = open_chat(selin_ctx, "Selin")

        errors = []
        for page, who in ((murat, "murat"), (selin, "selin")):
            page.on("pageerror", lambda e, w=who: errors.append(f"{w} pageerror: {e}"))

        # ---------------------------------------------------------------
        # 1) Murat anket açar
        # ---------------------------------------------------------------
        question = "Hafta sonu planı?"
        murat.locator('[data-chat-root="true"] button[aria-label="Dosya ve konum ekle"]').first.click()
        murat.wait_for_selector('[data-chat-attach-panel="true"]', timeout=8000)
        murat.get_by_role("button", name="Anket", exact=True).first.click()
        murat.locator('input[placeholder^="Anket sorusu"]').fill(question)
        murat.locator('input[placeholder="1. seçenek"]').fill("Deniz")
        murat.locator('input[placeholder="2. seçenek"]').fill("Piknik")
        murat.get_by_role("button", name="Anketi gönder", exact=True).first.click()
        murat.wait_for_timeout(1800)
        # Gönderim sonrası panel kendiliğinden kapanır (sohbet görünür kalsın).
        log("anket gönderince panel kapandı",
            murat.locator('[data-chat-attach-panel="true"]').count() == 0)

        all_msgs = api("/api/chat/messages?limit=50") or []
        poll = [m for m in all_msgs if m["message_type"] == "anket"]
        log("anket sunucuya yazıldı", bool(poll))
        log("anket oy alanları geldi (votes/voters)",
            bool(poll) and poll[-1].get("votes") == [0, 0] and poll[-1].get("voters") == {},
            json.dumps(poll[-1:], ensure_ascii=False))
        poll_id = poll[-1]["id"] if poll else 0

        # Selin'de anket canlı görünmeli
        selin.wait_for_timeout(800)
        log("karşı taraf anketi gördü",
            selin.locator(f'[data-chat-root="true"] :text("{question}")').count() >= 1)
        shot(selin, "poll_01_selin_gordu")

        # ---------------------------------------------------------------
        # 2) Selin oy verir -> Murat'ta da işaret görünmeli
        # ---------------------------------------------------------------
        selin.locator('[data-chat-root="true"] button[aria-label^="Deniz"]').first.click()
        selin.wait_for_timeout(1200)
        state_selin = poll_state(selin, "Deniz")
        log("Selin'in kendi oyu işaretlendi", bool(state_selin) and state_selin["pressed"] == "true",
            str(state_selin))

        murat.wait_for_timeout(1200)
        state_murat = poll_state(murat, "Deniz")
        log("Murat'ın ekranında Selin'in oyu göründü",
            bool(state_murat) and state_murat["count"] == 1, str(state_murat))
        log("Murat'a oy sayısı 1/2 görünüyor",
            "1/2" in murat.locator('[data-chat-root="true"]').inner_text())
        shot(murat, "poll_02_murat_selin_oyunu_gordu")

        # ---------------------------------------------------------------
        # 3) Murat oy verir (farklı seçenek) -> Selin'de de görünmeli
        # ---------------------------------------------------------------
        murat.locator('[data-chat-root="true"] button[aria-label^="Piknik"]').first.click()
        murat.wait_for_timeout(1200)
        selin.wait_for_timeout(1200)
        selin_view = selin.evaluate(
            """() => {
                const root = document.querySelector('[data-chat-root="true"]');
                const piknik = Array.from(root.querySelectorAll('button[aria-label*="oy"]'))
                    .find((b) => b.getAttribute('aria-label').startsWith('Piknik'));
                const deniz = Array.from(root.querySelectorAll('button[aria-label*="oy"]'))
                    .find((b) => b.getAttribute('aria-label').startsWith('Deniz'));
                return {
                    piknik: piknik ? { pressed: piknik.getAttribute('aria-pressed'), label: piknik.getAttribute('aria-label') } : null,
                    deniz: deniz ? { pressed: deniz.getAttribute('aria-pressed'), label: deniz.getAttribute('aria-label') } : null,
                };
            }"""
        )
        log("Selin, Murat'ın oyunu gördü (Piknik 1 oy)",
            bool(selin_view["piknik"]) and "1 oy" in selin_view["piknik"]["label"], str(selin_view))
        log("Selin'in kendi oyu (Deniz) bozulmadı",
            bool(selin_view["deniz"]) and selin_view["deniz"]["pressed"] == "true", str(selin_view))
        selin_text = selin.locator('[data-chat-root="true"]').inner_text()
        log("Selin'de 'ikiniz de oyladınız' + 2/2 oy göründü",
            "ikiniz de oyladınız" in selin_text and "2/2" in selin_text, selin_text[-200:].replace("\n", " | "))
        shot(selin, "poll_03_selin_iki_oy")

        # ---------------------------------------------------------------
        # 4) Oyunu değiştirme: Selin Deniz -> Piknik
        # ---------------------------------------------------------------
        selin.locator('[data-chat-root="true"] button[aria-label^="Piknik"]').first.click()
        selin.wait_for_timeout(1200)
        after = selin.evaluate(
            """() => {
                const root = document.querySelector('[data-chat-root="true"]');
                return Array.from(root.querySelectorAll('button[aria-label*="oy"]'))
                    .filter((b) => b.getAttribute('aria-label').startsWith('Piknik') || b.getAttribute('aria-label').startsWith('Deniz'))
                    .map((b) => b.getAttribute('aria-label'));
            }"""
        )
        log("oyunu değiştirince sayılar doğru (Piknik 2, Deniz 0)",
            any("Piknik — 2 oy" in t for t in after) and any("Deniz — 0 oy" in t for t in after),
            str(after))
        api_after = [m for m in (api("/api/chat/messages?limit=50") or []) if m["id"] == poll_id]
        log("sunucuda oylar güncel", bool(api_after)
            and api_after[-1].get("voters") == {"murat": 1, "selin": 1}, json.dumps(api_after[-1:], ensure_ascii=False))

        # ---------------------------------------------------------------
        # 5) Uygulama yeniden açılınca oylar korunuyor (kalıcı)
        # ---------------------------------------------------------------
        murat_ctx.close()
        murat_ctx2 = browser.new_context(**shared)
        murat2 = open_chat(murat_ctx2, "Murat")
        murat2.wait_for_timeout(800)
        persistent = poll_state(murat2, "Piknik")
        log("yeniden açılışta oylar korundu (Piknik 1 oy Murat)",
            bool(persistent) and persistent["pressed"] == "true" and persistent["count"] == 2,
            str(persistent))
        shot(murat2, "poll_04_yeniden_acilis")

        # ---------------------------------------------------------------
        # 6) Ataç paneli ALTTAN KAYARAK açılmalı
        # ---------------------------------------------------------------
        attach = murat2.locator('[data-chat-root="true"] button[aria-label="Dosya ve konum ekle"]').first
        before_y = attach.evaluate("(el) => Math.round(el.getBoundingClientRect().top)")
        attach.click()

        frames = []
        for _ in range(9):
            murat2.wait_for_timeout(40)
            pos = panel_positions(murat2)
            if pos:
                frames.append(pos["top"])
        print("     panel üst konumları (40ms aralık):", frames)
        log("panel alt konumdan başlayıp yukarı kaydı",
            len(frames) >= 3 and frames[0] > frames[-1] and (frames[0] - frames[-1]) > 12,
            str(frames))

        murat2.wait_for_timeout(500)
        final_pos = panel_positions(murat2)
        final_pos = panel_positions(murat2)  # animasyon bittikten sonraki son hâl
        geom = murat2.evaluate(
            """() => {
                const layer = document.querySelector('[data-chat-attach-layer="true"]');
                const sheet = document.querySelector('.chat-attach-sheet');
                const root = document.querySelector('[data-chat-root="true"]');
                const nav = document.querySelector('[data-navigation-variant]');
                const s = sheet.getBoundingClientRect();
                const rr = root.getBoundingClientRect();
                const nr = nav.getBoundingClientRect();
                return {
                    sheetTop: Math.round(s.top), sheetBottom: Math.round(s.bottom),
                    rootBottom: Math.round(rr.bottom), navTop: Math.round(nr.top),
                    layerZ: getComputedStyle(layer).zIndex,
                    transform: getComputedStyle(sheet).transform,
                };
            }"""
        )
        print("     panel son konum:", geom)
        log("panel sohbetin üstünde (overlay) ve navigasyonun üstünde bitiyor",
            geom["sheetBottom"] <= geom["navTop"] + 1, str(geom))
        log("attığım görseldeki gibi: panelin alt kenarı navigasyona yaslı",
            abs(geom["sheetBottom"] - geom["navTop"]) <= 2, str(geom))
        log("açıkken transform sıfırlandı (tam yukarı)",
            final_pos is not None and "matrix(1, 0, 0, 1, 0, 0)" in final_pos["transform"].replace(" ", " "),
            str(final_pos))
        log("sohbet listesi panel açıkken kaydırma kilitli",
            murat2.evaluate(
                """() => {
                    const root = document.querySelector('[data-chat-root="true"]');
                    const scroller = root.querySelector('.overflow-y-auto');
                    return scroller ? getComputedStyle(scroller).overflowY : 'yok';
                }"""
            ) == "hidden")
        shot(murat2, "poll_05_panel_kayarak_acildi")

        # Arka plana dokununca kapanır (kayarak iner)
        murat2.locator('[data-chat-attach-layer="true"] button[aria-label="Paneli kapat (arka plan)"]').first.click(force=True)
        murat2.wait_for_timeout(700)
        log("arka plana dokununca panel kapandı",
            murat2.locator('[data-chat-attach-panel="true"]').count() == 0)
        log("kapanınca sohbet kaydırması geri açıldı",
            murat2.evaluate(
                """() => {
                    const root = document.querySelector('[data-chat-root="true"]');
                    const scroller = root.querySelector('.overflow-y-auto');
                    return scroller ? getComputedStyle(scroller).overflowY : 'yok';
                }"""
            ) != "hidden")

        log("sayfa hatası yok", not errors, " | ".join(errors[:4]))
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} kontrol BAŞARISIZ:", ", ".join(failures))
        return 1
    print("Tüm kontroller geçti.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
