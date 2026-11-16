"""5 görevin tarayıcıda doğrulaması (yerel sunucu: tests/dev_server.py).

Çalıştırma:
    python tests/test_five_tasks.py

Kapsam:
  G1. Uygulama kapalıyken mesaj bildirimi — cihaz kaydı + her ekranda yakalama.
  G2. Mektuplar kaybolmaz — arşive alınan mektup geri getirilebilir.
  G3. Sinema salonu "Cars 1" takılması — takvimden film açılışı düzeldi.
  G4. Takvim koyu temada.
  G5. "Bu ayın perdesi" her zaman görünür; yalnızca takvim açılıp kapanır.
"""

import datetime
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


def seed():
    """Mektup + bu ayın takvimi + hazır bir salon (Cars 1) oluştur."""
    letters = api("/api/letters") or []
    for letter in letters:
        api(f"/api/letters/{letter['id']}", "DELETE")

    api("/api/letters", "POST", {
        "sender": "selin",
        "title": "Balıma mektup",
        "content_text": "Seni çok seviyorum, hep yanındayım.",
        "stationery_theme": "rose_blush",
    })
    api("/api/letters", "POST", {
        "sender": "murat",
        "title": "Kuzeye sevgi mektubu",
        "content_text": "Kuzeyin aq",
        "stationery_theme": "vintage_parchment",
    })

    today = datetime.date.today()
    api("/api/cinema/calendar/import", "POST", {
        "month": today.isoformat()[:7],
        "replace_existing": True,
        "created_by": "openclaw",
        "showtimes": [
            {
                "title": "Aşk Tesadüfleri Sever",
                "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
                "show_date": today.isoformat(),
                "show_time": "21:00",
                "description": "İlk birlikte izleyeceğimiz film",
            },
            {
                "title": "La La Land",
                "video_url": "https://www.youtube.com/watch?v=0pdqf4P9MB8",
                "show_date": (today + datetime.timedelta(days=3)).isoformat(),
                "show_time": "21:30",
            },
        ],
    })

    # "Cars 1 takılı kaldı": eski sürümden kalma aktif salon
    for room in api("/api/cinema") or []:
        api(f"/api/cinema/{room['id']}", "DELETE")
    cars = api("/api/cinema", "POST", {
        "title": "Cars 1",
        "video_url": "https://www.youtube.com/watch?v=abc123def45",
        "created_by": "murat",
        "kind": "embed",
    })
    api(f"/api/cinema/{cars['id']}/start", "POST", {"user_id": "murat"})
    return today.isoformat()


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
            return 1

        ctx = browser.new_context(
            viewport={"width": 412, "height": 915}, device_scale_factor=2, is_mobile=True, has_touch=True
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
        page.wait_for_timeout(1500)
        shot(page, "t5_00_ana_ekran")

        # ---------------- G2: Mektuplar kaybolmaz ----------------
        page.locator("nav button").filter(has_text="Mektuplar").click()
        page.wait_for_timeout(1200)
        shot(page, "t5_01_mektuplar")
        body = page.locator("body").inner_text()
        log("G2: mektuplar listede", "Balıma mektup" in body and "Kuzeye sevgi mektubu" in body, body[:300])

        before = len(api("/api/letters") or [])
        archive_btn = page.get_by_title("Arşive al (silinmez)")
        if archive_btn.count() > 0:
            archive_btn.first.click()
            page.wait_for_timeout(1200)
            shot(page, "t5_02_mektup_arsivde")
            body = page.locator("body").inner_text()
            after_rows = len(api("/api/letters") or [])
            log("G2: arşive alınca sunucudan SİLİNMEZ", after_rows == before, f"{before} -> {after_rows}")
            log("G2: arşiv bölümü göründü", "Mektup Arşivi" in body, body[:300])
            page.locator("button[aria-expanded]").first.click()
            page.wait_for_timeout(700)
            shot(page, "t5_02b_arsiv_acik")
            restore = page.get_by_role("button", name="Geri Getir")
            log("G2: geri getir düğmesi var", restore.count() > 0)
            if restore.count() > 0:
                restore.first.click()
                page.wait_for_timeout(1200)
                shot(page, "t5_03_mektup_geri_getirildi")
                body = page.locator("body").inner_text()
                log("G2: mektup geri geldi", "Balıma mektup" in body or "Kuzeye sevgi mektubu" in body, body[:300])
        else:
            log("G2: arşive al düğmesi var", False)

        # ---------------- G1: Bildirim altyapısı ----------------
        device = api("/api/devices/register", "POST", {
            "user_id": "murat", "token": "browser-test-token", "platform": "android",
        })
        status = api("/api/devices/status")
        log("G1: cihaz kaydı çalışıyor", bool(device.get("success")) and status.get("devices", {}).get("murat") == 1,
            f"{device} / {status}")

        # Sohbet sekmesi KAPALIYken gelen mesaj yakalanmalı (sayaç).
        api("/api/chat/messages", "POST", {"sender": "selin", "message_type": "text", "content": "Bildirim testi"})
        page.wait_for_timeout(1800)
        shot(page, "t5_04_sohbet_sayaci")
        badge = page.evaluate(
            """() => {
                const chat = Array.from(document.querySelectorAll('nav button')).find(b => (b.getAttribute('aria-label')||'') === 'Sohbet');
                const span = chat && chat.querySelector('span.min-w-\\\\[16px\\\\]');
                return span ? span.textContent : null;
            }"""
        )
        log("G1: sohbet dışındayken yeni mesaj sayacı", bool(badge), f"badge={badge}")

        page.locator("nav button").filter(has_text="Sohbet").click()
        page.wait_for_timeout(1500)
        body = page.locator("body").inner_text()
        log("G1: mesaj sohbette görünüyor", "Bildirim testi" in body, body[:300])

        # ---------------- G5 + G3: Sinema ----------------
        page.locator("nav button").filter(has_text="Ana sayfa").click()
        page.wait_for_timeout(600)
        page.locator("button", has_text="Sinema").filter(has_text="🎬").first.click()
        page.wait_for_timeout(2500)
        shot(page, "t5_05_sinema_lobi")
        body = page.locator("body").inner_text()

        log("G5: 'Bu ayın perdesi' kartı görünür", "BU AYIN PERDESİ" in body.upper(), body[:400])
        log("G5: takvim kapalıyken seans özeti görünür", "La La Land" in body, body[:600])

        # Takvimi aç: perde kartı YERİNDE kalmalı, sadece takvim açılmalı
        chrome_ctx = ctx
        positions_before = page.evaluate(
            """() => {
                const el = Array.from(document.querySelectorAll('*')).find(
                  e => (e.textContent || '').trim().startsWith('Bu ayın perdesi')
                );
                const r = el && el.getBoundingClientRect();
                return r ? { left: Math.round(r.left), top: Math.round(r.top) } : null;
            }"""
        )
        page.get_by_role("button", name="Takvimi Gör").first.click()
        page.wait_for_timeout(2200)
        shot(page, "t5_06_takvim_acik")
        body = page.locator("body").inner_text()
        positions_after = page.evaluate(
            """() => {
                const el = Array.from(document.querySelectorAll('*')).find(
                  e => (e.textContent || '').trim().startsWith('Bu ayın perdesi')
                );
                const r = el && el.getBoundingClientRect();
                return r ? { left: Math.round(r.left), top: Math.round(r.top) } : null;
            }"""
        )
        log("G5: perde kartı aynı yerde kalıyor", positions_before == positions_after,
            f"{positions_before} -> {positions_after}")
        log("G5: takvim açıldı", "Pzt" in body and "Bugün" in body, body[:600])

        # G4: Takvim koyu tema
        theme = page.evaluate(
            """() => {
                const nodes = Array.from(document.querySelectorAll('div'));
                const box = nodes.find(n => {
                    const t = (n.textContent || '').trim();
                    return t.startsWith('Pzt') && t.includes('Paz');
                });
                if (!box) return null;
                const el = box.closest('div[class*="rounded-3xl"]') || box.parentElement;
                const cs = getComputedStyle(el);
                return { bg: cs.backgroundColor, color: cs.color };
            }"""
        )
        def luminance(rgb):
            nums = [int(x) for x in rgb.replace("rgba(", "").replace("rgb(", "").replace(")", "").split(",")[:3]]
            return sum(nums) / 3

        dark_ok = bool(theme) and luminance(theme["bg"]) < 60
        log("G4: takvim koyu temada", dark_ok, str(theme))

        # G3: Takvimden filmi salonda aç (Cars 1 gibi takılı kalmasın)
        shows = api(f"/api/cinema/calendar?month={today_iso[:7]}&viewer=murat")
        show_id = None
        for show in shows:
            if show["title"] == "Aşk Tesadüfleri Sever":
                show_id = show["id"]
        # Bilet al + salonda aç (sunucu tarafı: kullanıcının yaptığı işlem)
        api(f"/api/cinema/calendar/{show_id}/ticket", "POST", {"user_id": "murat"})
        api(f"/api/cinema/calendar/{show_id}/open", "POST", {"user_id": "murat"})
        page.wait_for_timeout(2000)
        # Arayüz "Katıl" daveti yerine doğrudan lobideki "Perdeyi Aç / Salona Gir"
        # yolunu izler; salon açılınca ekran CinemaTheater olmalı.
        enter = page.get_by_role("button", name="Salona Gir")
        if enter.count() > 0:
            enter.first.click()
            page.wait_for_timeout(4000)
        shot(page, "t5_08_salon")
        body = page.locator("body").inner_text()
        log("G3: salon açıldı", "AHUDUDU SİNEMA SALONU" in body.upper(), body[-600:])
        log("G3: doğru film perdede", "Aşk Tesadüfleri Sever" in body, body[-600:])

        # Salondan çık
        leave = page.get_by_role("button", name="Salondan Çık")
        if leave.count() > 0:
            leave.first.click()
            page.wait_for_timeout(2500)
        body = page.locator("body").inner_text()
        log("G3: salondan çıkınca takılı kalmıyor", "AHUDUDU SİNEMA SALONU" not in body.upper(), body[-400:])
        shot(page, "t5_09_lobiye_donus")

        # Sunucuda da salon kapanmış olmalı
        current = api("/api/cinema/current")
        log("G3: sunucuda aktif salon kalmadı", current is None, str(current)[:200])

        # Takvimi gizle → perde kartı hâlâ görünmeli
        hide = page.get_by_role("button", name="Takvimi Gizle")
        if hide.count() > 0:
            hide.first.click()
            page.wait_for_timeout(1200)
        body = page.locator("body").inner_text()
        shot(page, "t5_10_takvim_kapali")
        log("G5: takvim kapanınca perde kartı duruyor", "BU AYIN PERDESİ" in body.upper(), body[:400])
        log("G5: takvim kapandı", "Pzt" not in body, body[:400])

        # Sayfa yenilendiğinde (uygulama kapanıp açıldığında) Cars 1 ekranı
        # kendiliğinden ele geçirmemeli.
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1500)
        page.locator("nav button").filter(has_text="Ana sayfa").click()
        page.wait_for_timeout(500)
        page.locator("button", has_text="Sinema").filter(has_text="🎬").first.click()
        page.wait_for_timeout(2500)
        shot(page, "t5_11_yeniden_acilis")
        body = page.locator("body").inner_text()
        log("G3: uygulama açılışında eski salon ekranı ele geçirmiyor",
            "AHUDUDU SİNEMA SALONU" not in body.upper(), body[:300])

        errors = [
            e for e in errors
            if "favicon" not in e.lower() and "net::ERR" not in e and "404" not in e
        ]
        log("konsol hatası yok", len(errors) == 0, " | ".join(errors[:4]))
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} SORUN: {', '.join(failures)}")
        return 1
    print("5 GÖREVİN TARAYICI DOĞRULAMASI GEÇTİ ✅")
    return 0


if __name__ == "__main__":
    sys.exit(main())
