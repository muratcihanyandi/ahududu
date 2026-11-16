# -*- coding: utf-8 -*-
"""Görev 5/6/7/8 görsel + davranış doğrulaması (Playwright, port 33473).

Ekran görüntüleri: tests/screenshots_misc/
Çalıştırmadan önce:
    $env:PORT=33473; python tests/dev_server.py
    python tests/screenshots_misc/capture_misc.py
"""

import datetime
import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:33473"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "tests", "screenshots_misc")
TEST_IMAGE = os.path.join(ROOT, "frontend", "public", "logo.png")
os.makedirs(OUT, exist_ok=True)

failures = []
checks = []


def api(path, method="GET", data=None):
    url = f"{BASE}{path}"
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(
        url,
        data=body,
        method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read().decode("utf-8")
        return json.loads(raw) if raw else None


def log(name, ok, detail=""):
    checks.append((name, bool(ok), detail))
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))


def shot(page, name):
    path = os.path.join(OUT, f"{name}.png")
    page.screenshot(path=path)
    print(f"[shot] {os.path.basename(path)}")
    return path


def reset_pets():
    """Önceki koşulardan kalan test dostlarını temizle (yinelenen kart olmasın)."""
    keep = {"Pamuk", "Mırmır"}
    try:
        existing = api("/api/pets")
        seen = set()
        for item in existing if isinstance(existing, list) else []:
            pet = item.get("pet", item)
            name = pet.get("name")
            pid = pet.get("id")
            if name == "Fındık" or (name in keep and name in seen):
                api(f"/api/pets/{pid}", "DELETE")
                continue
            seen.add(name)
        log("test dostları temizlendi", True)
    except Exception as e:
        log("test dostları temizlendi", False, str(e))


def seed():
    reset_pets()
    # Selin'in paylaştığı bir an (partner halkası dolu görünsün)
    try:
        api("/api/snaps", "POST", {
            "sender": "selin",
            "media_url": "/logo.png",
            "media_type": "image",
            "caption": "Seni özledim çok",
            "mood": "özledim",
            "filter_name": "rose",
        })
        log("seed snap (selin)", True)
    except Exception as e:
        log("seed snap (selin)", False, str(e))

    # Hayvanlar: biri 'bizim', biri eski usulde 'selin' (etiket artık bizim olmalı)
    try:
        existing = api("/api/pets")
        names = {
            (p.get("pet", {}) or p).get("name")
            for p in (existing if isinstance(existing, list) else [])
        }
        if "Pamuk" not in names:
            p1 = api("/api/pets", "POST", {
                "name": "Pamuk",
                "category": "köpek",
                "breed": "Shih Tzu",
                "age": "2 yaşında",
                "bio": "Ahududu logomuzdaki prenses!",
                "owner": "bizim",
                "is_favorite": True,
            })
            api(f"/api/pets/{p1['id']}/photos", "POST", {
                "uploader": "murat", "media_url": "/logo.png", "caption": "En tatlısı",
            })
        if "Mırmır" not in names:
            api("/api/pets", "POST", {"name": "Mırmır", "category": "kedi", "owner": "selin"})
        log("seed pets", True)
    except Exception as e:
        log("seed pets", False, str(e))

    # Bugün için bir sinema seansı (takvim/detay görüntüleri için)
    try:
        today = datetime.date.today().isoformat()
        month = today[:7]
        existing = api(f"/api/cinema/calendar?month={month}&viewer=murat")
        titles = {s.get("title") for s in existing}
        if "Bizim İlk Filmimiz" in titles:
            log("seed showtime (zaten var)", True)
        else:
            api("/api/cinema/calendar", "POST", {
                "title": "Bizim İlk Filmimiz",
                "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
                "show_date": today,
                "show_time": "21:00",
                "created_by": "murat",
                "hall": "Salon 1",
            })
            log("seed showtime", True)
    except Exception as e:
        log("seed showtime", False, str(e))


def count_snaps(sender=None):
    data = api("/api/snaps")
    if sender:
        data = [s for s in data if s.get("sender") == sender]
    return len(data)


def main():
    seed()
    snaps_before = count_snaps("murat")

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
                print(f"[..]   {channel} açılamadı: {str(e)[:120]}")
        if browser is None:
            print("HATA: Chrome veya Edge bulunamadı")
            sys.exit(1)

        ctx = browser.new_context(
            viewport={"width": 412, "height": 915},
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            locale="tr-TR",
        )
        page = ctx.new_page()
        page_errors = []
        page.on("pageerror", lambda e: page_errors.append(str(e)))

        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.setItem('ahududu_user', 'murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(2000)

        # ---------------- Anılar sekmesi / MoreHub ----------------
        page.get_by_role("button", name="Anılar").click()
        page.wait_for_timeout(1800)
        shot(page, "01_morehub_anlik")
        log("SnapAlbum görünür", page.get_by_text("Anlık Fotoğraflar").count() > 0)
        log("Sinema Salonumuz kartı görünür", page.get_by_text("Sinema Salonumuz").count() > 0)

        # Görev 7: sinema kartındaki tanıtım/çipler kaldırıldı
        for promo in ("Büyük Güncelleme", "Her siteden video", "aynı saniyede",
                      "Yatay mod", "Karakterlerin", "Bilet al"):
            log(f"MoreHub'da tanıtım metni yok: {promo}", page.get_by_text(promo, exact=False).count() == 0)

        # Görev 6: ikincil galeri/süsle erişilebilir
        log("Galeriden ikincil butonu", page.get_by_role("button", name="Galeriden").count() > 0)
        log("Süsle ikincil butonu", page.get_by_role("button", name="Süsle").count() > 0)

        # ---------------- Görev 6: An Paylaş → doğrudan kamera ----------------
        with page.expect_file_chooser() as fc_info:
            page.get_by_role("button", name="An Paylaş").click()
        chooser = fc_info.value
        log("An Paylaş doğrudan kamera seçici açtı (composer yok)",
            page.get_by_text("Anını Paylaş").count() == 0)
        chooser.set_files(TEST_IMAGE)
        toast_seen = False
        try:
            page.get_by_text("Anın paylaşıldı 💌").first.wait_for(state="visible", timeout=20000)
            toast_seen = True
        except Exception:
            pass
        shot(page, "02_an_paylasildi_aninda")
        log("Anında paylaşım geri bildirimi", toast_seen)
        page.wait_for_timeout(1600)
        snaps_after_camera = count_snaps("murat")
        log("Kamera anı sunucuya kaydedildi", snaps_after_camera == snaps_before + 1,
            f"{snaps_before} -> {snaps_after_camera}")

        # ---------------- Görev 6: kamera iptali hata göstermiyor ----------------
        with page.expect_file_chooser() as fc_info2:
            page.get_by_role("button", name="An Paylaş").click()
        fc_info2.value.set_files([])  # iptal: dosya seçilmedi
        page.wait_for_timeout(1200)
        cancel_ok = (
            page.get_by_text("paylaşamadık", exact=False).count() == 0
            and page.get_by_text("hata", exact=False).count() == 0
        )
        shot(page, "03_kamera_iptal_hata_yok")
        log("Kamera iptali hata göstermedi", cancel_ok)
        log("İptal yeni an yaratmadı", count_snaps("murat") == snaps_after_camera)

        # ---------------- Görev 6: 'Sen' yuvarlağı → doğrudan kamera ----------------
        with page.expect_file_chooser() as fc_info3:
            page.get_by_role("button", name="Sen, kamerayı aç").click()
        fc_info3.value.set_files(TEST_IMAGE)
        try:
            page.get_by_text("Anın paylaşıldı 💌").first.wait_for(state="visible", timeout=20000)
        except Exception:
            pass
        shot(page, "04_sen_yuvarlagi_direkt_kamera")
        page.wait_for_timeout(1600)
        snaps_after_ring = count_snaps("murat")
        log("'Sen' yuvarlağı anı anında paylaştı", snaps_after_ring == snaps_after_camera + 1,
            f"{snaps_after_camera} -> {snaps_after_ring}")

        # ---------------- Görev 6: 'Sen' uzun basış → kendi anları ----------------
        ring = page.get_by_role("button", name="Sen, kamerayı aç")
        box = ring.bounding_box()
        page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        page.mouse.down()
        page.wait_for_timeout(750)
        page.mouse.up()
        page.wait_for_timeout(1200)
        shot(page, "05_sen_uzun_bas_kendi_anlarin")
        viewer_open = page.get_by_text("Henüz görülmedi…", exact=False).count() > 0 or \
            page.get_by_text("/", exact=False).count() > 0
        log("'Sen' uzun basış → kendi anları açıldı", viewer_open)
        # Görüntüleyiciyi kapat (X ya da Escape) ve ana ekrana dön
        x_btn = page.locator("button:has(svg.lucide-x)").first
        if x_btn.count() > 0:
            x_btn.click(force=True)
        page.keyboard.press("Escape")
        page.wait_for_timeout(900)
        try:
            page.get_by_role("button", name="Galeriden").wait_for(state="visible", timeout=8000)
        except Exception:
            page.wait_for_timeout(1500)

        # ---------------- Görev 6: Galeriden (ikincil) anında paylaşır ----------------
        with page.expect_file_chooser() as fc_info4:
            page.get_by_role("button", name="Galeriden").click()
        fc_info4.value.set_files(TEST_IMAGE)
        try:
            page.get_by_text("Anın paylaşıldı 💌").first.wait_for(state="visible", timeout=20000)
        except Exception:
            pass
        shot(page, "06_galeriden_ikincil")
        page.wait_for_timeout(1400)
        log("Galeriden seçimi de anında paylaştı", count_snaps("murat") == snaps_after_ring + 1)

        # ---------------- Görev 6: Süsle → SnapComposer (filtre/duygu) ----------------
        page.get_by_role("button", name="Süsle").click()
        page.wait_for_timeout(900)
        shot(page, "07_susle_composer")
        log("Süsle → composer (filtre/duygu) açıldı", page.get_by_text("Anını Paylaş").count() > 0)
        page.locator("button:has(svg.lucide-x)").first.click(force=True)
        page.wait_for_timeout(700)

        # ---------------- Görev 5: Hayvan Albümü etiketleri ----------------
        page.get_by_role("button", name="Hayvanlar").click()
        page.wait_for_timeout(1800)
        shot(page, "08_hayvanlar_bizim_dostumuz")
        bizim_cards = page.get_by_text("💞 Bizim dostumuz", exact=False).count()
        log("Kartlarda '💞 Bizim dostumuz' (>=2)", bizim_cards >= 2, f"bulunan: {bizim_cards}")
        log("'Selin'in dostu' metni yok", page.get_by_text("nin dostu", exact=False).count() == 0
            and page.get_by_text("'in dostu", exact=False).count() == 0)

        # Dost Ekle → Kimin dostu? bölümü
        page.get_by_role("button", name="Dost Ekle").click()
        page.wait_for_timeout(900)
        shot(page, "09_dost_ekle_ust")
        page.get_by_text("Kimin dostu?").scroll_into_view_if_needed()
        page.wait_for_timeout(400)
        shot(page, "10_kimin_dostu_sadece_bizim")
        log("'Kimin dostu?' başlığı var", page.get_by_text("Kimin dostu?").count() > 0)
        log("'🐻 Murat' seçeneği yok", page.get_by_role("button", name="🐻 Murat").count() == 0)
        log("'🌸 Selin' seçeneği yok", page.get_by_role("button", name="🌸 Selin").count() == 0)
        log("'💞 Bizim' seçeneği kalktı, sabit etiket var",
            page.get_by_role("button", name="💞 Bizim", exact=True).count() == 0
            and page.get_by_text("Bizim dostumuz", exact=False).count() >= 1)

        # Formdan kaydet → owner 'bizim' olmalı
        page.locator("input[placeholder='Rüzgar, Felix, Duman']").fill("Fındık")
        page.get_by_role("button", name="Albüme Ekle 🐾").click()
        page.wait_for_timeout(2500)
        pets = api("/api/pets")
        findik = [x for x in pets if x.get("pet", {}).get("name") == "Fındık" or x.get("name") == "Fındık"]
        owner = None
        if findik:
            owner = findik[0].get("pet", {}).get("owner") or findik[0].get("owner")
        log("UI'dan eklenen dost owner='bizim'", owner == "bizim", f"owner={owner}")
        page.wait_for_timeout(800)
        shot(page, "11_findik_eklendi")

        # Detay: eski 'selin' sahipli Mırmır artık bizim etiketli
        page.get_by_text("Mırmır").first.scroll_into_view_if_needed()
        page.get_by_text("Mırmır").first.click()
        page.wait_for_timeout(1200)
        shot(page, "12_hayvan_detay_bizim_dostumuz")
        log("Detayda '💞 Bizim dostumuz'", page.get_by_text("💞 Bizim dostumuz").count() > 0)
        log("Detayda eski sahip etiketi yok",
            page.get_by_text("in dostu", exact=False).count() == 0)
        x_btn = page.locator("button:has(svg.lucide-x)").first
        if x_btn.count() > 0:
            x_btn.click(force=True)
        page.wait_for_timeout(700)

        # ---------------- Görev 8: Neredeyiz? ----------------
        page.get_by_text("Neredeyiz?").first.scroll_into_view_if_needed()
        page.wait_for_timeout(500)
        shot(page, "13_morehub_neredeyiz_karti")
        log("MoreHub'da 'Neredeyiz?' kartı", page.get_by_text("Neredeyiz?").count() > 0)
        log("MoreHub'da 'Çift Radarı' metni yok", page.get_by_text("Çift Radarı").count() == 0)
        page.get_by_text("Neredeyiz?").first.click()
        page.wait_for_timeout(1400)
        shot(page, "14_neredeyiz_panel")
        log("Neredeyiz? paneli açıldı", page.get_by_text("Neredeyiz?").count() > 0)

        # ---------------- Görev 7: CinemaCalendar ----------------
        try:
            page.keyboard.press("Escape")
            page.get_by_text("Sinema Salonumuz").first.click()
            page.wait_for_timeout(2500)
            shot(page, "15_sinema_lobi")
            # Lobiden takvime geç (CinemaSalon → CinemaCalendar)
            page.get_by_role("button", name="Takvimi Gör").click()
            page.wait_for_timeout(2000)
            shot(page, "16_sinema_takvim")
            log("Sinema takvimi açıldı",
                page.get_by_role("button", name="Film Ekle").count() > 0)
            log("Takvimde tanıtım alt yazısı yok",
                page.get_by_text("her siteden", exact=False).count() == 0)
            # Detay penceresi: takvimdeki seans kartına dokun (lobideki kartı değil)
            cal_card = page.locator("div.group.relative.flex.gap-3").first
            if cal_card.count() > 0:
                cal_card.scroll_into_view_if_needed()
                page.wait_for_timeout(400)
                cal_card.click()
                page.wait_for_timeout(1600)
                shot(page, "17_sinema_detay_biletler")
                log("Detayda teknik 'bilet kodu' rozeti yok",
                    page.locator("span.font-mono").count() == 0)
                log("Detayda 'Biletler' başlığı var", page.get_by_text("Biletler").count() > 0)
                x_btn = page.locator("button:has(svg.lucide-x)").first
                if x_btn.count() > 0:
                    x_btn.click(force=True)
                page.wait_for_timeout(600)
            # Film Ekle formunda teknik yardım metni yok
            page.get_by_role("button", name="Film Ekle").click()
            page.wait_for_timeout(1000)
            shot(page, "18_sinema_film_ekle")
            log("Film Ekle'de 'film siteleri' yardım metni yok",
                page.get_by_text("film sitesinden", exact=False).count() == 0)
            log("Film Ekle'de '(site)' etiketi yok",
                page.get_by_text("(site)", exact=False).count() == 0)
        except Exception as e:
            log("Sinema takvimi açıldı", False, str(e)[:160])

        page_errors = [e for e in page_errors if "favicon" not in e.lower()]
        log("Sayfa hatası yok", len(page_errors) == 0, " | ".join(page_errors[:3]))
        browser.close()

    print()
    total = len(checks)
    failed = [c for c in checks if not c[1]]
    print(f"{total - len(failed)}/{total} kontrol geçti")
    if failed:
        print(f"{len(failed)} SORUN:")
        for name, _, detail in failed:
            print(f"  - {name} {detail}")
        sys.exit(1)
    print("TÜM KONTROLLER GEÇTİ ✅")


if __name__ == "__main__":
    main()
