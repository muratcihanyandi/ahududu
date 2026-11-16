"""4 görevin tarayıcıda doğrulaması: geri tuşu, sabit sohbet, başlık, sinema takvimi."""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:33471"
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
    with urllib.request.urlopen(req, timeout=15) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def log(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"{name}.png"))


def seed():
    """Bu ay için takvim kur."""
    current = api("/api/cinema/current")
    if current:
        api(f"/api/cinema/{current['id']}", "DELETE")
    for room in api("/api/cinema") or []:
        api(f"/api/cinema/{room['id']}", "DELETE")

    # Bugünkü tarihi hesapla (yerel)
    import datetime
    today = datetime.date.today()
    today_iso = today.isoformat()

    r = api("/api/cinema/calendar/import", "POST", {
        "month": today_iso[:7],
        "replace_existing": True,
        "created_by": "openclaw",
        "showtimes": [
            {
                "title": "Aşk Tesadüfleri Sever",
                "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
                "show_date": today_iso,
                "show_time": "21:00",
                "description": "İlk birlikte izleyeceğimiz film 🍿",
            },
            {
                "title": "Interstellar",
                "video_url": "https://vimeo.com/123456789",
                "show_date": (today + datetime.timedelta(days=3)).isoformat(),
                "show_time": "21:30",
                "description": "Yıldızlar arasında bir yolculuk",
            },
            {
                "title": "Kedi Videoları",
                "video_url": "https://youtu.be/dQw4w9WgXcQ",
                "show_date": (today + datetime.timedelta(days=6)).isoformat(),
                "show_time": "20:00",
            },
        ],
    })
    print(f"[seed] takvim: {r.get('created')} seans")
    return today_iso


def main():
    today_iso = seed()

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(channel=channel, args=["--autoplay-policy=no-user-gesture-required"])
                print(f"[OK]   tarayıcı: {channel}")
                break
            except Exception:
                continue
        if browser is None:
            print("HATA: tarayıcı yok")
            sys.exit(1)

        ctx = browser.new_context(viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.setItem('ahududu_user', 'murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1800)
        shot(page, "g00_ana_ekran")

        # ---------- GÖREV 3: Sohbet başlığı ----------
        page.locator("nav button").filter(has_text="Sohbet").click()
        page.wait_for_timeout(1500)
        shot(page, "g01_sohbet")
        body = page.locator("body").inner_text()
        log("G3: 'Selin ile Sohbet' yok", "ile Sohbet" not in body, body[:200])
        log("G3: sadece 'Selin' var", "Selin" in body)

        # ---------- GÖREV 2: sohbet sabit ----------
        header_before = page.evaluate("""() => {
            const h = document.querySelector('h3');
            const r = h ? h.getBoundingClientRect() : null;
            return r ? {top: Math.round(r.top), h: Math.round(r.height)} : null;
        }""")
        input_before = page.evaluate("""() => {
            const el = document.querySelector('input[placeholder="Mesaj yaz..."]');
            const r = el ? el.getBoundingClientRect() : null;
            return r ? {top: Math.round(r.top), bottom: Math.round(r.bottom)} : null;
        }""")

        # Mesajları biriktir: 25 mesaj yaz
        for i in range(6):
            try:
                api("/api/chat/messages", "POST", {
                    "sender": "selin" if i % 2 == 0 else "murat",
                    "message_type": "text",
                    "content": f"Test mesajı {i+1} — sohbet kaydırma kontrolü " + ("uzun metin " * 3),
                })
            except Exception as e:
                print("mesaj eklenemedi", e)
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1200)
        page.locator("nav button").filter(has_text="Sohbet").click()
        page.wait_for_timeout(1500)

        # Mesaj listesini kaydır
        page.evaluate("""() => {
            const containers = Array.from(document.querySelectorAll('div'));
            const scroller = containers.find(el => {
                const s = getComputedStyle(el);
                return s.overflowY === 'auto' && el.scrollHeight > el.clientHeight + 20;
            });
            if (scroller) scroller.scrollTop = 0;
        }""")
        page.wait_for_timeout(400)
        header_after = page.evaluate("""() => {
            const h = document.querySelector('h3');
            const r = h ? h.getBoundingClientRect() : null;
            return r ? {top: Math.round(r.top), h: Math.round(r.height)} : null;
        }""")
        input_after = page.evaluate("""() => {
            const el = document.querySelector('input[placeholder="Mesaj yaz..."]');
            const r = el ? el.getBoundingClientRect() : null;
            return r ? {top: Math.round(r.top), bottom: Math.round(r.bottom)} : null;
        }""")
        shot(page, "g02_sohbet_kaydirilmis")

        log(
            "G2: başlık sabit",
            header_before and header_after and abs(header_before["top"] - header_after["top"]) <= 1,
            f"{header_before} -> {header_after}",
        )
        log(
            "G2: yazma alanı sabit",
            input_before and input_after and abs(input_before["bottom"] - input_after["bottom"]) <= 1,
            f"{input_before} -> {input_after}",
        )

        # ---------- GÖREV 1: geri tuşu ----------
        has_back = page.evaluate("() => typeof window.__ahududuBack === 'function'")
        log("G1: geri tuşu köprüsü kurulu", has_back)

        # Sohbet sekmesindeyken geri -> ana ekran (true dönmeli)
        handled = page.evaluate("() => window.__ahududuBack()")
        page.wait_for_timeout(500)
        log("G1: sekmeden geri -> uygulama kapanmıyor", handled is True, str(handled))
        shot(page, "g03_geri_ana_ekran")

        # Ana ekranda geri -> false (uygulama arkaya alınır, kapanmaz)
        handled2 = page.evaluate("() => window.__ahududuBack()")
        log("G1: ana ekranda geri -> arkaya alınır (false)", handled2 is False, str(handled2))

        # Mektup açıkken geri -> mektubu kapatır
        page.locator("nav button").filter(has_text="Mektuplar").click()
        page.wait_for_timeout(900)
        page.get_by_role("button", name="Mektup Yaz").click()
        page.wait_for_timeout(900)
        was_open = page.get_by_text("Yeni Mektup").count() > 0
        handled3 = page.evaluate("() => window.__ahududuBack()")
        page.wait_for_timeout(600)
        now_open = page.get_by_text("Yeni Mektup").count() > 0
        log("G1: pencere açıkken geri onu kapatıyor", was_open and not now_open and handled3 is True,
            f"was={was_open} now={now_open} handled={handled3}")

        # ---------- GÖREV 4: Sinema Takvimi ----------
        page.locator("nav button").filter(has_text="Ana sayfa").click()
        page.wait_for_timeout(800)
        page.get_by_role("button", name="Sinema").click()
        page.wait_for_timeout(2200)
        # Takvim artık "Takvimi Gör" ile açılır (görev 1 ile güncellendi)
        if page.get_by_role("button", name="Takvimi Gör").count() > 0:
            page.get_by_role("button", name="Takvimi Gör").click()
            page.wait_for_timeout(1800)
        shot(page, "g04_sinema_takvim")
        body = page.locator("body").inner_text()
        log("G4: takvim başlığı var", "Bu ayın perdesi" in body or "perdesi" in body.lower(), body[:300])
        log("G4: film adı takvimde", "Aşk Tesadüfleri Sever" in body, body[:500])
        log("G4: takvim ızgarası (Bugün butonu)", "Bugün" in body)

        # Bilet al
        book_btn = page.get_by_role("button", name="Bilet Al")
        if book_btn.count() > 0:
            book_btn.first.click()
            page.wait_for_timeout(1800)
            shot(page, "g05_bilet_alindi")
            shows = api(f"/api/cinema/calendar?month={today_iso[:7]}&viewer=murat")
            booked = [s for s in shows if "murat" in (s.get("booked_by") or "")]
            log("G4: bilet alındı", len(booked) > 0, str([(s["title"], s["booked_by"]) for s in shows]))
        else:
            log("G4: bilet alındı", False, "Bilet Al düğmesi yok")

        # Detay penceresi: kartın kendisine dokun (afiş alanı yerine başlık)
        card = page.get_by_text("Aşk Tesadüfleri Sever").last
        card.click(force=True)
        page.wait_for_timeout(1200)
        shot(page, "g06_seans_detay")
        detail_body = page.locator("body").inner_text()
        log("G4: seans detayı açıldı", "Biletler" in detail_body, detail_body[:300])
        # Geri tuşu köprüsüyle kapat
        handled = page.evaluate("() => window.__ahududuBack()")
        page.wait_for_timeout(900)
        log("G1/G4: geri tuşu seans detayını kapattı",
            page.get_by_text("Biletler").count() == 0, f"handled={handled}")

        # Film ekleme penceresi
        page.get_by_role("button", name="Film Ekle").click()
        page.wait_for_timeout(900)
        shot(page, "g07_film_ekle")
        log("G4: film ekleme ekranı", page.get_by_text("Takvime Film Ekle").count() > 0)
        page.evaluate("() => window.__ahududuBack()")
        page.wait_for_timeout(800)

        # ---------- GÖREV 4c: sinema durumu ve bildirim ----------
        # Murat salona girer
        watch_btn = page.get_by_role("button", name="Salona Gir")
        if watch_btn.count() > 0:
            watch_btn.first.click()
            page.wait_for_timeout(4000)
            shot(page, "g08_salon_acildi")
            log("G4: salon açıldı", page.get_by_text("Ahududu Sinema Salonu").count() > 0)
            log("G4: film adı perdede", page.get_by_text("Aşk Tesadüfleri Sever").count() > 0)
        else:
            log("G4: salon açıldı", False, "Salona Gir düğmesi yok")

        errors = [
            e for e in errors
            if "favicon" not in e.lower()
            and "net::ERR" not in e
            and "ytimg" not in e.lower()
            and "404" not in e
        ]
        log("konsol hatası yok", len(errors) == 0, " | ".join(errors[:4]))
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} SORUN: {', '.join(failures)}")
        sys.exit(1)
    print("4 GÖREVİN TARAYICI DOĞRULAMASI GEÇTİ ✅")


if __name__ == "__main__":
    main()
