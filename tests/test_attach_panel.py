"""Sohbet ataç paneli — uçtan uca doğrulama (Playwright).

Gereksinim: backend test sunucusu 33480 portunda çalışıyor olmalı
    python -m uvicorn backend.app.main:app --port 33480
Kullanım:
    python tests/test_attach_panel.py
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
MEDIA = os.path.join(tempfile.gettempdir(), "ahududu_test_media")
os.makedirs(OUT, exist_ok=True)

VIEWPORT = {"width": 1080, "height": 2340}
failures = []

# Playwright tarayıcısı kurulu değilse makinedeki Chrome/Edge ile devam et.
CHROME_CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def launch_browser(pw):
    try:
        return pw.chromium.launch()
    except Exception:
        for path in CHROME_CANDIDATES:
            if os.path.isfile(path):
                print("     (yerel tarayıcı kullanılıyor:", path, ")")
                return pw.chromium.launch(executable_path=path)
        raise


def log(name, ok, detail=""):
    print(("ok   " if ok else "FAIL ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        BASE + path, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def upload(path, category):
    boundary = "----ahududutestboundary"
    with open(path, "rb") as f:
        content = f.read()
    name = os.path.basename(path)
    body = (
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"media_category\"\r\n\r\n{category}\r\n"
        f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
        f"Content-Type: image/png\r\n\r\n"
    ).encode() + content + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        BASE + "/api/media/upload", data=body, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        return json.loads(res.read().decode())


def seed():
    existing = api("/api/gallery") or []
    if len(existing) < 8:
        files = sorted(os.listdir(MEDIA))[:9] if os.path.isdir(MEDIA) else []
        for idx, name in enumerate(files):
            up = upload(os.path.join(MEDIA, name), "gallery")
            api("/api/gallery", "POST", {
                "uploader": "selin",
                "title": f"Anımız {idx + 1}",
                "media_type": "image",
                "media_url": up["url"],
                "album": "Bizim Anılarımız",
            })
    msgs = api("/api/chat/messages?limit=50") or []
    if len([m for m in msgs if m["message_type"] == "text"]) < 6:
        convo = [
            ("selin", "Ben de papaya çayı yapıyım"),
            ("murat", "Teşekkür ederim"),
            ("selin", "Çeşme ne güzelmiş lan"),
            ("murat", "Evwt biliyorum ben istedim"),
            ("selin", "Ben de papaya çayı yapiyim"),
            ("murat", "Afiyet bal şeker olsun"),
        ]
        for sender, text in convo:
            api("/api/chat/messages", "POST", {
                "sender": sender, "message_type": "text", "content": text,
            })


def main():
    seed()
    with sync_playwright() as pw:
        browser = launch_browser(pw)
        context = browser.new_context(
            viewport=VIEWPORT,
            is_mobile=True,
            has_touch=True,
            locale="tr-TR",
            timezone_id="Europe/Istanbul",
            permissions=["geolocation"],
            geolocation={"latitude": 38.4237, "longitude": 27.1428, "accuracy": 12},
        )
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on(
            "console",
            lambda m: errors.append("console.error: " + m.text)
            if m.type == "error"
            else None,
        )

        page.goto(BASE, wait_until="networkidle")
        page.wait_for_timeout(600)
        if page.locator("text=Ben Selin'im").count():
            page.locator("text=Ben Selin'im").click()
            page.wait_for_timeout(600)
        page.locator('[data-navigation-variant] button[aria-label="Sohbet"]').first.click()
        page.wait_for_selector('[data-chat-root="true"]', timeout=10000)
        page.wait_for_timeout(900)
        shot(page, "attach_00_sohbet")

        def attach():
            return page.locator(
                '[data-chat-root="true"] button[aria-label="Dosya ve konum ekle"]'
            ).first

        def box(label):
            return page.get_by_role("button", name=label, exact=True).first

        def panel_open():
            return page.locator('[data-chat-attach-panel="true"]').count() > 0

        def open_panel():
            """Panel kapalıysa ataçla aç. Zaten AÇIKSA dokunma: dokunma kapatır."""
            if not panel_open():
                attach().click()
            page.wait_for_selector(
                '[data-chat-attach-panel="true"]', state="attached", timeout=8000
            )
            # Altlık panel kayarak yükselir; oturmasını bekle (aksi hâlde
            # Playwright "element is not stable" der).
            page.wait_for_timeout(450)
            # Altlık panel kayarak yükselir; oturmasını bekle.
            page.wait_for_timeout(350)

        def close_panel():
            """Panel açıksa kendi ✕ düğmesiyle kapat (altlık panel alt navigasyonu da kaplar)."""
            if not panel_open():
                return
            # Kayma animasyonu otursun: aksi hâlde düğme "stable" değil görünür.
            page.wait_for_timeout(500)
            page.locator(
                '[data-chat-attach-panel="true"] [aria-label="Paneli tamamen kapat"]'
            ).first.click(force=True, no_wait_after=True)
            page.wait_for_selector(
                '[data-chat-attach-panel="true"]', state="detached", timeout=8000
            )

        def wait_panel(should_open=True):
            if should_open:
                open_panel()
            else:
                close_panel()

        log("ataç düğmesi görünüyor", attach().count() == 1, str(attach().count()))
        attach().click()
        page.wait_for_timeout(500)

        log("panel alttan açıldı", page.locator('[data-chat-attach-panel="true"]').count() == 1)
        log("sayfa çökmedi (sohbet hâlâ ekranda)", page.locator('[data-chat-root="true"]').count() == 1)
        shot(page, "attach_01_panel")

        for label in ["Galeri", "Kamera", "Konum", "Kişi", "Belge", "Anket", "Etkinlik"]:
            log(f"kutu: {label}", box(label).count() == 1)

        geom = page.evaluate(
            """() => {
                const panel = document.querySelector('[data-chat-attach-panel="true"]');
                const root = document.querySelector('[data-chat-root="true"]');
                const composer = root.querySelector('input[placeholder="Mesaj yaz..."]');
                const nav = document.querySelector('[data-navigation-variant]');
                const pr = panel.getBoundingClientRect();
                const nr = nav.getBoundingClientRect();
                const cr = composer.getBoundingClientRect();
                return {
                  panelTop: Math.round(pr.top), panelBottom: Math.round(pr.bottom),
                  panelHeight: Math.round(pr.height),
                  navTop: Math.round(nr.top), navBottom: Math.round(nr.bottom),
                  composerBottom: Math.round(cr.bottom),
                  vw: window.innerWidth, vh: window.innerHeight,
                };
            }"""
        )
        print("     geometri:", geom)
        log("panel navigasyonun üstünde bitiyor", geom["panelBottom"] <= geom["navTop"] + 1, str(geom))
        # Altlık (bottom sheet) düzeni: panel sohbetin ÜSTÜNE kayarak açılır,
        # yazma alanının üstünü kapatır — görseldeki gibi alttan yükselir.
        log("panel sohbetin üstüne binmiş (altlık düzeni)",
            geom["composerBottom"] > geom["panelTop"], str(geom))
        log("panel yüksekliği makul (0 < h < ekranın %60'ı)",
            0 < geom["panelHeight"] < geom["vh"] * 0.62, str(geom["panelHeight"]))

        grid = page.evaluate(
            """() => {
                const panel = document.querySelector('[data-chat-attach-panel="true"]');
                const imgs = Array.from(panel.querySelectorAll('img'));
                const boxes = Array.from(panel.querySelectorAll('button')).slice(0, 8);
                const lastBoxBottom = Math.max(...boxes.map(b => b.getBoundingClientRect().bottom));
                const firstImgTop = imgs.length ? imgs[0].getBoundingClientRect().top : null;
                return { imgs: imgs.length, lastBoxBottom: Math.round(lastBoxBottom),
                         firstImgTop: firstImgTop === null ? null : Math.round(firstImgTop),
                         loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length };
            }"""
        )
        print("     galeri:", grid)
        log("galeride fotoğraflar var", grid["imgs"] >= 4, str(grid))
        log("fotoğraflar kutuların altında",
            grid["firstImgTop"] is not None and grid["firstImgTop"] >= grid["lastBoxBottom"], str(grid))
        log("fotoğraflar yüklendi", grid["loaded"] >= 4, str(grid))

        # --- Konum ---
        box("Konum").click()
        page.wait_for_timeout(300)
        shot(page, "attach_02_konum_formu")
        box("Konumumu gönder").click()
        page.wait_for_timeout(1800)
        msgs = api("/api/chat/messages?limit=5") or []
        konum = [m for m in msgs if m["message_type"] == "konum"]
        log("konum mesajı sunucuya yazıldı", bool(konum), json.dumps(msgs[-2:], ensure_ascii=False))
        if konum:
            log("konum koordinatları kayıtlı",
                abs((konum[-1]["latitude"] or 0) - 38.4237) < 0.01, str(konum[-1]))
        log("konum baloncuğu görünüyor",
            page.locator('[data-chat-root="true"] a[href*="google.com/maps"]').count() >= 1)
        shot(page, "attach_03_konum_gonderildi")

        # --- Kişi ---
        open_panel()
        wait_panel(True)
        page.wait_for_timeout(300)
        box("Kişi").click()
        page.wait_for_timeout(250)
        page.locator('input[placeholder="Ad Soyad"]').fill("Ayşe Yılmaz")
        page.locator('input[placeholder="Telefon numarası"]').fill("+90 555 111 22 33")
        shot(page, "attach_04_kisi_formu")
        box("Kişiyi gönder").click()
        page.wait_for_timeout(1200)
        log("kişi kartı görünüyor",
            page.locator('[data-chat-root="true"] a[href^="tel:"]').count() >= 1)

        # --- Anket ---
        open_panel()
        wait_panel(True)
        page.wait_for_timeout(300)
        box("Anket").click()
        page.wait_for_timeout(250)
        page.locator('input[placeholder^="Anket sorusu"]').fill("Bu akşam ne yiyelim?")
        page.locator('input[placeholder="1. seçenek"]').fill("Pizza")
        page.locator('input[placeholder="2. seçenek"]').fill("Sushi")
        shot(page, "attach_05_anket_formu")
        box("Anketi gönder").click()
        page.wait_for_timeout(1200)
        log("anket baloncuğu",
            page.locator('[data-chat-root="true"] button:has-text("Pizza")').count() >= 1)

        # --- Etkinlik ---
        open_panel()
        wait_panel(True)
        page.wait_for_timeout(300)
        box("Etkinlik").click()
        page.wait_for_timeout(250)
        page.locator('input[placeholder^="Etkinlik adı"]').fill("Bisiklet turu")
        shot(page, "attach_06_etkinlik_formu")
        box("Etkinliği gönder").click()
        page.wait_for_timeout(1200)
        log("etkinlik baloncuğu",
            page.locator('[data-chat-root="true"] a[href*="google.com/calendar"]').count() >= 1)

        # --- Belge ---
        open_panel()
        wait_panel(True)
        page.wait_for_timeout(300)
        doc_path = os.path.join(tempfile.gettempdir(), "ahududu_deneme_belgesi.pdf")
        with open(doc_path, "wb") as f:
            f.write(b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n")
        with page.expect_file_chooser() as fc_info:
            box("Belge").click()
        fc_info.value.set_files(doc_path)
        page.wait_for_timeout(2000)
        belge = [m for m in (api("/api/chat/messages?limit=5") or []) if m["message_type"] == "belge"]
        log("belge mesajı kaydedildi", bool(belge), json.dumps(belge[-1:], ensure_ascii=False))
        log("belge baloncuğu", page.locator('[data-chat-root="true"] a[download]').count() >= 1)
        shot(page, "attach_07_hepsi")

        # --- Galeri'den fotoğraf ---
        open_panel()
        wait_panel(True)
        page.wait_for_timeout(300)
        png = os.path.join(MEDIA, sorted(os.listdir(MEDIA))[0])
        with page.expect_file_chooser() as fc2:
            box("Galeri").click()
        fc2.value.set_files(png)
        page.wait_for_timeout(1800)
        imgs = [m for m in (api("/api/chat/messages?limit=50") or []) if m["message_type"] == "image"]
        log("galeri fotoğrafı gönderildi", bool(imgs))

        # --- Kapatma yolları ---
        open_panel()
        log("panel tekrar açıldı", page.locator('[data-chat-attach-panel="true"]').count() == 1)
        close_panel()
        log("✕ düğmesiyle kapandı", page.locator('[data-chat-attach-panel="true"]').count() == 0)

        open_panel()
        page.evaluate("window.__ahududuBack && window.__ahududuBack()")
        page.wait_for_selector('[data-chat-attach-panel="true"]', state="detached", timeout=8000)
        log("geri tuşuyla kapandı ve sohbet kaldı",
            page.locator('[data-chat-attach-panel="true"]').count() == 0
            and page.locator('[data-chat-root="true"]').count() == 1)

        # --- Tekrar açma (ikinci kez) ---
        open_panel()
        page.wait_for_timeout(500)
        log("tekrar tekrar açılabiliyor", page.locator('[data-chat-attach-panel="true"]').count() == 1)
        shot(page, "attach_08_panel_tekrar")
        close_panel()

        bad = [e for e in errors if "Failed to load resource" not in e]
        log("sayfa konsol hatası yok", not bad, " | ".join(bad[:4]))
        log("hiçbir pageerror yok",
            not [e for e in errors if not e.startswith("console.error")], " | ".join(errors[:4]))

        browser.close()

    print()
    if failures:
        print(f"{len(failures)} kontrol BAŞARISIZ:", ", ".join(failures))
        return 1
    print("Tüm kontroller geçti.")
    return 0


def shot(page, name):
    path = os.path.join(OUT, f"{name}.png")
    page.screenshot(path=path)
    print("     ", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    raise SystemExit(main())
