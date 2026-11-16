"""Sohbet tam ekran + basılı tutarak sesli mesaj doğrulaması (Playwright).

Gereksinim: tests/dev_server.py 33472 portunda çalışıyor olmalı.
Ekran görüntüleri: tests/screenshots_chat/
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


def shot(page, name):
    path = os.path.join(OUT, f"{name}.png")
    page.screenshot(path=path)
    print("     ", os.path.relpath(path, ROOT))


def seed():
    try:
        existing = api("/api/chat/messages?limit=200") or []
    except Exception:
        existing = []
    if len(existing) >= 10:
        return
    convo = [
        ("selin", "Günaydın aşkım ☀️ Bugün seni çok düşündüm."),
        ("murat", "Günaydın canım benim 🐻 Ben de seni düşünüyordum."),
        ("selin", "Akşam için bir planın var mı?"),
        ("murat", "Seninle her plan güzel. Ne yapmak istersin?"),
        ("selin", "Film izleyip sarılalım mı? 🍿"),
        ("murat", "Bayıldım. Ben patlamış mısırı hazırlarım."),
        ("selin", "Seni seviyorum, iyi ki varsın 💞"),
        ("murat", "Ben de seni, her şeyden çok."),
        ("selin", "Bu akşam 20:00 gibi hazır olurum."),
        ("murat", "Tamam canım, sabırsızlıkla bekliyorum."),
    ]
    for sender, text in convo:
        try:
            api("/api/chat/messages", "POST", {
                "sender": sender, "message_type": "text", "content": text,
            })
        except Exception as exc:  # pragma: no cover
            print("seed hata:", exc)
    # Uzun bir konuşma olması için birkaç mesaj daha (kaydırma testi).
    for i in range(6):
        api("/api/chat/messages", "POST", {
            "sender": "selin" if i % 2 == 0 else "murat",
            "message_type": "text",
            "content": f"Geçmişten bir not {i + 1}: bugün yanımda olman yeterdi.",
        })


def msg_count():
    try:
        return len(api("/api/chat/messages?limit=200") or [])
    except Exception:
        return -1


def layout_metrics(page):
    return page.evaluate(
        """() => {
            const root = document.querySelector('[data-chat-root="true"]');
            const nav = document.querySelector('[data-navigation-variant]');
            const header = document.querySelector('header');
            const scroller = root ? root.querySelector('.overflow-y-auto') : null;
            if (!root || !nav || !header) return null;
            const rr = root.getBoundingClientRect();
            const nr = nav.getBoundingClientRect();
            const hr = header.getBoundingClientRect();
            const sr = scroller ? scroller.getBoundingClientRect() : null;
            const rootStyle = getComputedStyle(root);
            const navStyle = getComputedStyle(nav);
            return {
                rootTop: Math.round(rr.top),
                headerBottom: Math.round(hr.bottom),
                rootBottom: Math.round(rr.bottom),
                navTop: Math.round(nr.top),
                navBottom: Math.round(nr.bottom),
                navVariant: nav.getAttribute('data-navigation-variant'),
                navPosition: navStyle.position,
                navWidth: Math.round(nr.width),
                viewportWidth: window.innerWidth,
                navHeight: Math.round(nr.height),
                viewportHeight: window.innerHeight,
                rootHeight: Math.round(rr.height),
                rootFlexGrow: rootStyle.flexGrow,
                rootInlineHeight: root.style.height || '',
                scrollerTop: sr ? Math.round(sr.top) : null,
                scrollerBottom: sr ? Math.round(sr.bottom) : null,
                atBottom: scroller
                    ? Math.abs(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) < 6
                    : null,
                scrollTop: scroller ? Math.round(scroller.scrollTop) : null,
                maxScroll: scroller
                    ? Math.round(scroller.scrollHeight - scroller.clientHeight)
                    : null,
            };
        }"""
    )


def main():
    seed()
    before_all = msg_count()

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
                print("tarayıcı:", channel)
                break
            except Exception as exc:
                print(f"{channel} açılamadı: {str(exc)[:90]}")
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
            lambda m: errors.append(f"console.error: {m.text}")
            if m.type == "error" else None,
        )

        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.setItem('ahududu_user', 'murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1400)

        page.locator("nav button").filter(has_text="Sohbet").click()
        page.wait_for_timeout(1600)
        shot(page, "01_sohbet_tam_ekran")

        m = layout_metrics(page)
        log("chat kökü bulundu", bool(m), str(m))
        if m:
            log("ChatView başlığı uygulama başlığına bitişik",
                abs(m["rootTop"] - m["headerBottom"]) <= 1,
                f"rootTop={m['rootTop']} headerBottom={m['headerBottom']}")
            log("composer alt navigasyona bitişik",
                abs(m["rootBottom"] - m["navTop"]) <= 1,
                f"rootBottom={m['rootBottom']} navTop={m['navTop']}")
            log("navigation attached (fixed değil)", m["navPosition"] != "fixed" and m["navVariant"] == "attached", str(m))
            log("navigation tam genişlik", abs(m["navWidth"] - m["viewportWidth"]) <= 2,
                f"navWidth={m['navWidth']} viewport={m['viewportWidth']}")
            log("navigation ekran altına yerleşik",
                abs(m["navBottom"] - m["viewportHeight"]) <= 2,
                f"navBottom={m['navBottom']} viewportH={m['viewportHeight']}")
            log("ChatView kendi height'ını hesaplamıyor", m["rootInlineHeight"] == "", str(m["rootInlineHeight"]))
            log("sohbet açılışta en altta", m["atBottom"] is True, str(m))
            log("mesaj listesi başlık ile composer arasında",
                m["scrollerTop"] is not None
                and abs(m["scrollerTop"] - m["rootTop"]) < m["rootHeight"]
                and abs(m["scrollerBottom"] - m["rootBottom"]) < m["rootHeight"],
                str(m))

        # Son mesaj görünür mü?
        last_visible = page.evaluate(
            """() => {
                const root = document.querySelector('[data-chat-root="true"]');
                const scroller = root.querySelector('.overflow-y-auto');
                const bubbles = Array.from(scroller.querySelectorAll('p'));
                const last = bubbles[bubbles.length - 1];
                if (!last) return null;
                const rect = scroller.getBoundingClientRect();
                const lr = last.getBoundingClientRect();
                return {
                    text: last.textContent.trim().slice(0, 60),
                    visible: lr.top >= rect.top - 2 && lr.bottom <= rect.bottom + 2,
                };
            }"""
        )
        log("en alttaki son mesaj görünür", bool(last_visible) and last_visible["visible"], str(last_visible))

        # Baloncuk ve gün ayırıcı görünür mü?
        log("gün ayırıcı görünür", page.get_by_text("Bugün").count() >= 1)
        body = page.locator("body").inner_text()
        log("karşı taraf mesajı görünür", "Günaydın aşkım" in body)
        log("kendi mesajım görünür", "Bayıldım" in body)

        # ---------------- Basılı tut → bırak → otomatik gönder ----------------
        mic = page.get_by_role("button", name="Sesli mesaj kaydet")
        log("yazı yokken mikrofon düğmesi var", mic.count() == 1)
        log("yazı yokken Gönder gizli", page.get_by_role("button", name="Gönder").count() == 0)

        box = mic.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        before = msg_count()
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.wait_for_timeout(1900)
        shot(page, "02_basili_tut_kayit")
        recording_ui = page.get_by_text("Bırak = gönder").count() > 0
        log("basılı tutunca kayıt arayüzü açıldı", recording_ui)
        import re as _re
        composer_text = page.evaluate(
            "() => { const root = document.querySelector('[data-chat-root=\"true\"]');"
            " return root ? Array.from(root.querySelectorAll('div')).slice(-6).map(e=>e.innerText).join(' | ') : ''; }"
        )
        log("kayıt süresi gösteriliyor", bool(_re.search(r"\d:\d\d", composer_text or "")), str(composer_text)[-200:])
        page.mouse.up()
        page.wait_for_timeout(4000)
        after = msg_count()
        log("bırakınca otomatik gönderildi", after > before, f"{before} -> {after}")
        shot(page, "03_basili_tut_gonderildi")

        # ---------------- Sola sürükle → iptal ----------------
        before = msg_count()
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.wait_for_timeout(1200)
        page.mouse.move(cx - 110, cy, steps=12)
        page.wait_for_timeout(350)
        shot(page, "04_sola_surukle_iptal")
        cancel_ui = page.get_by_text("Bırakırsan iptal olur").count() > 0
        log("sola sürükleyince iptal uyarısı", cancel_ui)
        page.mouse.up()
        page.wait_for_timeout(2500)
        after = msg_count()
        log("iptal edilen kayıt gönderilmedi", after == before, f"{before} -> {after}")
        log("iptal sonrası mikrofon geri geldi",
            page.get_by_role("button", name="Sesli mesaj kaydet").count() == 1)

        # ---------------- Kısa dokunuş → tap-to-record modu ----------------
        before = msg_count()
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.wait_for_timeout(120)
        page.mouse.up()
        page.wait_for_timeout(1800)
        shot(page, "05_kisa_dokunus_duzenle_modu")
        tap_ui = (
            page.get_by_role("button", name="Sesli mesajı gönder").count() == 1
            and page.get_by_role("button", name="Kaydı iptal et").count() == 1
        )
        log("kısa dokunuşta süre + sil + gönder arayüzü", tap_ui)
        log("kısa dokunuşta mikrofon gizli",
            page.get_by_role("button", name="Sesli mesaj kaydet").count() == 0)
        page.get_by_role("button", name="Sesli mesajı gönder").click()
        page.wait_for_timeout(4000)
        after = msg_count()
        log("tap modunda gönderim başarılı", after > before, f"{before} -> {after}")
        shot(page, "06_tap_modu_gonderildi")

        # Tap modunda çöp düğmesi → iptal
        before = msg_count()
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.wait_for_timeout(120)
        page.mouse.up()
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Kaydı iptal et").click()
        page.wait_for_timeout(2000)
        after = msg_count()
        log("tap modunda sil düğmesi kaydı iptal etti", after == before, f"{before} -> {after}")

        # ---------------- Yazı yaz → Gönder ----------------
        input_box = page.locator("input[placeholder='Mesaj yaz...']")
        input_box.fill("Sesli mesajı denedim, çok güzel olmuş 💞")
        page.wait_for_timeout(300)
        log("yazı varken Gönder görünür", page.get_by_role("button", name="Gönder").count() == 1)
        log("yazı varken mikrofon gizli",
            page.get_by_role("button", name="Sesli mesaj kaydet").count() == 0)
        before = msg_count()
        page.get_by_role("button", name="Gönder").click()
        page.wait_for_timeout(2500)
        log("metin mesajı gönderildi", msg_count() > before, str(before))
        shot(page, "07_yazi_ve_gonder")

        # ---------------- Sekmeye dönüşte yine en altta açılır ----------------
        page.locator("nav button").filter(has_text="Ana sayfa").click()
        page.wait_for_timeout(700)
        page.locator("nav button").filter(has_text="Sohbet").click()
        page.wait_for_timeout(1400)
        m2 = layout_metrics(page)
        log("sekmeye dönünce yine en altta", bool(m2) and m2["atBottom"] is True, str(m2))
        shot(page, "08_sekmeye_donus_en_altta")

        # ---------------- Klavye (visualViewport) simulasyonu ----------------
        # Gerçek klavye headless'ta açılamaz; visualViewport'u küçülterek
        # ChatView'ın composer'ı görünür alanın üstüne ittiğini doğruluyoruz.
        page.evaluate(
            """() => {
                const vv = window.visualViewport;
                window.__vvReal = { height: vv.height, offsetTop: vv.offsetTop };
                Object.defineProperty(vv, 'height', {
                    configurable: true, get: () => window.innerHeight - 340,
                });
                Object.defineProperty(vv, 'offsetTop', {
                    configurable: true, get: () => 0,
                });
                vv.dispatchEvent(new Event('resize'));
            }"""
        )
        page.wait_for_timeout(450)
        kb = page.evaluate(
            """() => {
                const root = document.querySelector('[data-chat-root="true"]');
                const vv = window.visualViewport;
                const visibleBottom = vv.offsetTop + vv.height;
                const composer = root.lastElementChild;
                const cr = composer.getBoundingClientRect();
                return {
                    padBottom: parseInt(getComputedStyle(root).paddingBottom, 10) || 0,
                    visibleBottom: Math.round(visibleBottom),
                    composerBottom: Math.round(cr.bottom),
                    viewportH: window.innerHeight,
                };
            }"""
        )
        log("klavye açılınca kök içeriği yukarı itiyor (paddingBottom)",
            kb["padBottom"] > 80, str(kb))
        log("klavye açıkken yazma alanı görünür alanda",
            kb["composerBottom"] <= kb["visibleBottom"] + 2,
            str(kb))
        shot(page, "10_klavye_simulasyonu")

        # Klavye kapanınca eski hâline dön.
        page.evaluate(
            """() => {
                const vv = window.visualViewport;
                Object.defineProperty(vv, 'height', {
                    configurable: true, get: () => window.__vvReal.height,
                });
                Object.defineProperty(vv, 'offsetTop', {
                    configurable: true, get: () => window.__vvReal.offsetTop,
                });
                vv.dispatchEvent(new Event('resize'));
            }"""
        )
        page.wait_for_timeout(400)
        kb_off = page.evaluate(
            """() => {
                const root = document.querySelector('[data-chat-root="true"]');
                return parseInt(getComputedStyle(root).paddingBottom, 10) || 0;
            }"""
        )
        log("klavye kapanınca boşluk sıfırlanıyor", kb_off == 0, str(kb_off))

        # ---------------- clearAllNotifications çağrısı doğrulaması ----------------
        # Web'de native olmadığı için fonksiyon no-op; yine de sohbet açılışında
        # çağrıldığını davranışsal kanıtla: Notification probe + sohbet açıkken
        # gelen mesajda sistem bildirimi gösterilmemeli.
        page.evaluate(
            """() => {
                window.__notifyProbe = [];
                function Probe(title) { window.__notifyProbe.push(title); }
                Probe.permission = 'granted';
                Probe.requestPermission = () => Promise.resolve('granted');
                window.Notification = Probe;
            }"""
        )
        api("/api/chat/messages", "POST", {
            "sender": "selin", "message_type": "text", "content": "Sohbet açıkken gönderildi",
        })
        page.wait_for_timeout(1600)
        log("sohbet açıkken mesaj göründü", "Sohbet açıkken gönderildi" in page.locator("body").inner_text())
        log("sohbet açıkken sistem bildirimi yok",
            page.evaluate("() => window.__notifyProbe.length") == 0,
            str(page.evaluate("() => window.__notifyProbe")))

        # ---------------- Yüzen navigasyon (diğer sekmeler) bozulmadı mı ----------------
        page.locator("nav button").filter(has_text="Ana sayfa").click()
        page.wait_for_timeout(900)
        nav_float = page.evaluate(
            """() => {
                const nav = document.querySelector('[data-navigation-variant]');
                if (!nav) return null;
                const s = getComputedStyle(nav);
                return { variant: nav.getAttribute('data-navigation-variant'), position: s.position,
                         width: Math.round(nav.getBoundingClientRect().width) };
            }"""
        )
        log("diğer sekmelerde floating navigasyon korundu",
            bool(nav_float) and nav_float["variant"] == "floating" and nav_float["position"] == "fixed",
            str(nav_float))
        shot(page, "09_diger_sekme_ana_sayfa")

        errors = [
            e for e in errors
            if "favicon" not in e.lower()
            and "net::ERR" not in e
            and "404" not in e
            and "media" not in e.lower()
        ]
        log("konsol hatası yok", len(errors) == 0, " | ".join(errors[:4]))
        browser.close()

    print()
    print(f"toplam mesaj: {before_all} -> {msg_count()}")
    if failures:
        print(f"{len(failures)} SORUN: {', '.join(failures)}")
        return 1
    print("SOHBET TAM EKRAN + SESLİ MESAJ TESTLERİ GEÇTİ ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
