"""Tarayıcıda uçtan uca görsel kontrol (Playwright).

Yerel dev sunucusu http://127.0.0.1:33471 üzerinde çalışıyor olmalı.
Ekran görüntüleri: tests/screenshots/
"""

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
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "testfilm.mp4")
os.makedirs(OUT, exist_ok=True)

failures = []


def api(path, method="GET", data=None):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        url, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def log(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(f"{name} {detail}")


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"{name}.png"))


def btn(page, name, nth=0):
    return page.get_by_role("button", name=name).nth(nth)


def seed():
    try:
        snap = api("/api/snaps", "POST", {
            "sender": "selin", "media_url": "/logo.png", "media_type": "image",
            "caption": "Seni özledim çok", "mood": "özledim", "filter_name": "rose",
        })
        log("seed snap", bool(snap), str(snap)[:120])
    except Exception as e:
        log("seed snap", False, str(e))

    try:
        diary = api("/api/diary", "POST", {
            "author": "selin", "title": "Bugün parkta yürüdük",
            "content": "Seninle her gün bir hediye gibi. Bugün yürürken bana elini uzattın ve içim eridi.",
            "mood": "aşık", "mood_score": 5, "weather": "güneşli", "entry_date": "2026-11-14",
        })
        log("seed diary", bool(diary), str(diary)[:120])
    except Exception as e:
        log("seed diary", False, str(e))

    try:
        pet = api("/api/pets", "POST", {
            "name": "Pamuk", "category": "köpek", "breed": "Shih Tzu", "age": "2 yaşında",
            "bio": "Ahududu logomuzdaki prenses!", "owner": "bizim", "is_favorite": True,
        })
        log("seed pet", bool(pet), str(pet)[:120])
        api(f"/api/pets/{pet['id']}/photos", "POST",
            {"uploader": "murat", "media_url": "/logo.png", "caption": "En tatlısı"})
        api("/api/pets", "POST", {"name": "Mırmır", "category": "kedi", "owner": "selin"})
    except Exception as e:
        log("seed pet", False, str(e))


def main():
    seed()

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(
                    channel=channel,
                    args=["--autoplay-policy=no-user-gesture-required"],
                )
                print(f"[OK]   tarayıcı: {channel}")
                break
            except Exception as e:
                print(f"[..]   {channel} açılamadı: {str(e)[:100]}")
        if browser is None:
            print("HATA: Chrome veya Edge bulunamadı")
            sys.exit(1)

        ctx = browser.new_context(
            viewport={"width": 412, "height": 915},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
        )
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console",
                lambda m: errors.append(f"console.error: {m.text}") if m.type == "error" else None)

        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.setItem('ahududu_user', 'murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1800)
        log("uygulama açıldı", page.get_by_text("Beni Sev!").count() > 0)

        # ---------------- Anlar / Anlık Fotoğraf ----------------
        btn(page, "Anlar").click()
        page.wait_for_timeout(2000)
        shot(page, "01_anlar_snaps")
        log("anlık fotoğraflar görünür", page.get_by_text("Anlık Fotoğraflar").count() > 0)
        log("sinema kapısı görünür", page.get_by_text("Sinema Salonumuz").count() > 0)
        log("partner anı akışta", page.get_by_text("Son Anlarımız").count() > 0)

        # Selin halkasına dokun → tam ekran an görüntüleyici
        btn(page, "Selin anları").click()
        page.wait_for_timeout(1800)
        shot(page, "02_snap_viewer")
        log("an görüntüleyici açıldı", page.get_by_text("Seni özledim çok").count() > 0)
        page.keyboard.press("Escape")
        close_btn = page.locator("button:has(svg.lucide-x)").first
        if close_btn.count() > 0:
            close_btn.click(force=True)
        page.wait_for_timeout(800)

        # Paylaşım ekranı
        btn(page, "An Paylaş").click()
        page.wait_for_timeout(900)
        shot(page, "03_snap_composer")
        log("an paylaşım ekranı", page.get_by_text("Anını Paylaş").count() > 0)
        page.locator("button:has(svg.lucide-x)").first.click(force=True)
        page.wait_for_timeout(600)

        # ---------------- Günlük ----------------
        btn(page, "Günlük").click()
        page.wait_for_timeout(1800)
        shot(page, "04_gunluk")
        log("günlük başlığı", page.get_by_text("Bizim Günlüğümüz").count() > 0)
        log("günlük kaydı göründü", page.get_by_text("Bugün parkta yürüdük").count() > 0)

        page.get_by_text("Bugün parkta yürüdük").first.click()
        page.wait_for_timeout(1000)
        shot(page, "05_gunluk_sayfa")
        log("günlük sayfası açıldı", page.get_by_text("bizim defterimizden").count() > 0)
        page.locator("button:has(svg.lucide-x)").first.click(force=True)
        page.wait_for_timeout(600)

        btn(page, "Sayfa Yaz").click()
        page.wait_for_timeout(900)
        shot(page, "06_gunluk_yazma")
        log("günlük yazma ekranı", page.get_by_text("Yeni Sayfa").count() > 0)
        page.locator("button:has(svg.lucide-x)").first.click(force=True)
        page.wait_for_timeout(600)

        # ---------------- Hayvan Albümü ----------------
        btn(page, "Hayvanlar").click()
        page.wait_for_timeout(1800)
        shot(page, "07_hayvanlar")
        log("hayvan albümü başlığı", page.get_by_text("Hayvan Albümümüz").count() > 0)
        log("Pamuk kartı", page.get_by_text("Pamuk").count() > 0)
        log("Mırmır kartı", page.get_by_text("Mırmır").count() > 0)

        page.get_by_text("Pamuk").first.click()
        page.wait_for_timeout(1000)
        shot(page, "08_hayvan_detay")
        log("hayvan detay açıldı", page.get_by_text("Hikayesi").count() > 0)
        page.locator("button:has(svg.lucide-x)").first.click(force=True)
        page.wait_for_timeout(600)

        btn(page, "Dost Ekle").click()
        page.wait_for_timeout(900)
        shot(page, "09_hayvan_ekle")
        log("hayvan ekleme ekranı", page.get_by_text("Yeni Dost Ekle").count() > 0)
        log("kategori seçimi var", page.get_by_text("Kategori").count() > 0)
        page.locator("button:has(svg.lucide-x)").first.click(force=True)
        page.wait_for_timeout(600)

        # ---------------- Sinema Salonu ----------------
        # ---------------- Sinema Salonu (artık takvim) ----------------
        btn(page, "Sinema").click()
        page.wait_for_timeout(1800)
        shot(page, "10_sinema_takvim")
        log("sinema takvimi", page.get_by_text("BU AYIN PERDESİ").count() > 0
            or page.get_by_text("Bu ayın perdesi").count() > 0)
        log("takvim ızgarası", page.get_by_role("button", name="Bugün").count() > 0)
        log("film ekle düğmesi", page.get_by_role("button", name="Film Ekle").count() > 0)

        # Takvime test filmi ekle (yerel dosya yükleme = hızlı, internete bağlı olmayan)
        page.get_by_role("button", name="Film Ekle").click()
        page.wait_for_timeout(800)
        page.locator("input[placeholder*='Aşk Tesadüfleri']").fill("Bizim İlk Filmimiz")
        # Video adresi alanına yerel test videosunu yükle
        if not os.path.exists(FIXTURE):
            print("[FAIL] test filmi bulunamadı:", FIXTURE)
            failures.append("test filmi yok")
        else:
            # Takvimsiz hızlı izleme bölümünü açıp dosya yükle (salona atlar)
            page.evaluate("() => window.__ahududuBack && window.__ahududuBack()")
            page.wait_for_timeout(600)
            page.locator("summary").click()
            page.wait_for_timeout(400)
            page.locator("input[type=file]").first.set_input_files(FIXTURE)
            page.wait_for_timeout(7000)
        shot(page, "12_sinema_perde")
        log("salon perdesi açıldı", page.get_by_text("Ahududu Sinema Salonu").count() > 0)
        log("salondan çık butonu", page.get_by_text("Salondan Çık").count() > 0)
        log("karakter görünür", page.get_by_text("Selin").count() > 0)

        try:
            cur = api("/api/cinema/current")
            log("sunucuda film oynuyor", bool(cur and cur.get("is_active")), str(cur)[:160])
            log("video süresi sunucuda", bool(cur and (cur.get("duration") or 0) > 0), str(cur)[:160])
        except Exception as e:
            log("sunucuda film oynuyor", False, str(e))

        # Yatay
        page.set_viewport_size({"width": 915, "height": 412})
        page.wait_for_timeout(2000)
        shot(page, "13_sinema_yatay")
        log("video hazır (yükleniyor değil)", page.get_by_text("Perde hazırlanıyor").count() == 0)

        # Tepki
        page.locator("button", has_text="❤️").first.click(force=True)
        page.wait_for_timeout(700)
        shot(page, "14_sinema_tepki")

        # Duraklat
        pause = page.locator("button:has(svg.lucide-pause)")
        if pause.count() > 0:
            pause.first.click(force=True)
            page.wait_for_timeout(1500)
            try:
                cur = api("/api/cinema/current")
                log("duraklatma sunucuya yansıdı",
                    bool(cur and cur.get("is_playing") is False), str(cur)[:160])
            except Exception as e:
                log("duraklatma sunucuya yansıdı", False, str(e))
            shot(page, "15_sinema_duraklat")

        # Salondan çık
        page.get_by_role("button", name="Salondan Çık").click()
        page.wait_for_timeout(1200)
        page.set_viewport_size({"width": 412, "height": 915})
        page.wait_for_timeout(700)
        shot(page, "16_sinema_lobi_sonrasi")
        log("salondan çıkıldı", page.get_by_text("Salondan Çık").count() == 0)
        errors = [
            e for e in errors
            if "favicon" not in e.lower() and "net::ERR" not in e and "ytimg" not in e.lower()
        ]
        log("konsol hatası yok", len(errors) == 0, " | ".join(errors[:5]))
        browser.close()

    print()
    if failures:
        print(f"{len(failures)} SORUN")
        sys.exit(1)
    print("TARAYICI TESTLERİ GEÇTİ ✅")


if __name__ == "__main__":
    main()
