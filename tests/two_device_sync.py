"""İKİ TELEFON senaryosu: Murat ve Selin aynı anda sinema salonunda.

- Murat filmi başlatır → Selin'in ekranı otomatik salona girer (yatay, aynı saniye)
- Murat duraklatır → Selin'de de video durur
- Murat sarma yapar → Selin de aynı saniyeye atlar
- Selin çıkar → Murat'ta "salonda değil" görünür
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
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "testfilm60.mp4")
OUT = os.path.join(ROOT, "tests", "screenshots")

failures = []


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        BASE + path, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def log(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def pos_of(page):
    return page.evaluate("""() => {
        const v = document.querySelector('video');
        return v ? {t: v.currentTime, paused: v.paused, dur: v.duration} : null;
    }""")


def upload_test_video():
    """Test filmini sunucuya yükler ve adresini döndürür."""
    if not os.path.exists(FIXTURE):
        return None
    boundary = "----AhududuSyncTest"
    with open(FIXTURE, "rb") as f:
        video_bytes = f.read()
    head = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="media_category"\r\n\r\ncinema\r\n'
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="file"; filename="syncfilm.mp4"\r\n'
        "Content-Type: video/mp4\r\n\r\n"
    ).encode()
    tail = f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        BASE + "/api/media/upload", data=head + video_bytes + tail, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode())["url"]


def main():
    # Önceki testlerden kalan salonları temizle
    for room in api("/api/cinema") or []:
        try:
            api(f"/api/cinema/{room['id']}", "DELETE")
        except Exception:
            pass

    # Test filmini yükle ve takvime koy
    import datetime
    today = datetime.date.today().isoformat()
    video_url = upload_test_video() or "https://www.youtube.com/watch?v=YoHD9XEInc0"
    api("/api/cinema/calendar/import", "POST", {
        "month": today[:7],
        "replace_existing": True,
        "created_by": "test",
        "showtimes": [{
            "title": "Senkron Test Filmi",
            "video_url": video_url,
            "show_date": today,
            "show_time": "21:00",
        }],
    })
    print(f"[seed] film: {video_url}")

    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", args=["--autoplay-policy=no-user-gesture-required"])

        def phone(user):
            ctx = browser.new_context(viewport={"width": 412, "height": 915}, is_mobile=True, has_touch=True)
            page = ctx.new_page()
            page.goto(BASE, wait_until="networkidle")
            page.evaluate(f"localStorage.setItem('ahududu_user', '{user}')")
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(1500)
            return page

        murat = phone("murat")
        selin = phone("selin")

        # Selin: Anlar sekmesinde bekliyor (sinema ekranı kapalı)
        selin.get_by_role("button", name="Anlar").click()
        selin.wait_for_timeout(1200)

        # Murat: takvimden film seçip salona girer
        murat.get_by_role("button", name="Sinema").click()
        murat.wait_for_timeout(1800)
        # Takvim artık varsayılan olarak kapalı: "Takvimi Gör" ile aç
        if murat.get_by_role("button", name="Takvimi Gör").count() > 0:
            murat.get_by_role("button", name="Takvimi Gör").click()
            murat.wait_for_timeout(1500)
        murat.screenshot(path=os.path.join(OUT, "20_iki_murat_lobi.png"))

        # Takvimdeki ilk filme bilet al + salona gir
        bilet = murat.get_by_role("button", name="Bilet Al")
        if bilet.count() == 0:
            log("Murat takvimde film buldu", False, murat.locator("body").inner_text()[:200].replace("\n", " | "))
            browser.close()
            sys.exit(1)
        bilet.first.click()
        murat.wait_for_timeout(1500)
        # Bilet alınınca detay penceresi açılır; geri tuşuyla kapat
        murat.evaluate("() => window.__ahududuBack && window.__ahududuBack()")
        murat.wait_for_timeout(900)

        salon = murat.get_by_role("button", name="Salona Gir")
        if salon.count() == 0:
            log("Murat salona girdi", False, "Salona Gir düğmesi yok")
            browser.close()
            sys.exit(1)
        salon.first.click()
        murat.wait_for_timeout(6000)
        murat.screenshot(path=os.path.join(OUT, "21_iki_murat_salon.png"))

        log("Murat salonda", murat.get_by_text("Ahududu Sinema Salonu").count() > 0)
        m_pos = pos_of(murat)
        log("Murat videosu oynuyor", bool(m_pos and not m_pos["paused"]), str(m_pos))

        # Selin'e sinema daveti WS ile gelmeli → ama otomatik giriş YOK,
        # sadece "Katıl" davet kartı görünür (görev 4).
        selin.wait_for_timeout(4000)
        selin.screenshot(path=os.path.join(OUT, "22_iki_selin_davet.png"))
        selin_forced = selin.get_by_text("Ahududu Sinema Salonu").count() > 0
        log("Selin zorla salona sokulmadı", not selin_forced)

        # Selin sinema ekranını açıp davete katılır
        selin.get_by_role("button", name="Sinema").click()
        selin.wait_for_timeout(2000)
        if selin.get_by_role("button", name="Katıl").count() > 0:
            selin.get_by_role("button", name="Katıl").first.click()
            selin.wait_for_timeout(4000)
        log("Selin salona katıldı", selin.get_by_text("Ahududu Sinema Salonu").count() > 0)

        # Aynı anda ölç: iki videoyu da tek seferde oku
        a = pos_of(murat)
        b = pos_of(selin)
        s_pos = b
        log("Selin videosu yüklendi", s_pos is not None, str(s_pos))
        if s_pos and a:
            gap = abs(s_pos["t"] - a["t"])
            log(f"iki taraf aynı saniyede (fark {gap:.2f}s)", gap < 3.0,
                f"murat={a['t']:.1f} selin={s_pos['t']:.1f}")
            m_pos = a

        # Murat duraklatır → Selin de durmalı
        murat.locator("button:has(svg.lucide-pause)").first.click(force=True)
        murat.wait_for_timeout(3000)
        m_paused = pos_of(murat)
        s_paused = pos_of(selin)
        log("Murat duraklattı", bool(m_paused and m_paused["paused"]), str(m_paused))
        log("Selin de durdu", bool(s_paused and s_paused["paused"]), str(s_paused))
        cur = api("/api/cinema/current")
        log("sunucu duraklatıldı", bool(cur and cur["is_playing"] is False))
        selin.screenshot(path=os.path.join(OUT, "23_iki_selin_duraklat.png"))

        # Murat ileri sarar → Selin de atlamalı
        for _ in range(3):
            murat.locator("button:has(svg.lucide-skip-forward)").first.click(force=True)
            murat.wait_for_timeout(500)
        murat.wait_for_timeout(3000)
        m_seek = pos_of(murat)
        s_seek = pos_of(selin)
        if m_seek and s_seek:
            gap = abs(s_seek["t"] - m_seek["t"])
            log(f"ikisi de aynı noktaya sarıldı (fark {gap:.2f}s)", gap < 3.0,
                f"murat={m_seek['t']:.1f} selin={s_seek['t']:.1f}")

        # Yatay iki cihaz
        murat.set_viewport_size({"width": 915, "height": 412})
        selin.set_viewport_size({"width": 915, "height": 412})
        murat.wait_for_timeout(1800)
        selin.wait_for_timeout(300)
        murat.screenshot(path=os.path.join(OUT, "24_iki_murat_yatay.png"))
        selin.screenshot(path=os.path.join(OUT, "25_iki_selin_yatay.png"))
        log("Murat partnerini salonda görüyor", murat.get_by_text("salonda 🍿").count() > 0,
            str(murat.get_by_text("salonda").count()))

        # Selin çıkar → Murat'ta "salonda değil"
        selin.get_by_role("button", name="Salondan Çık").click()
        selin.wait_for_timeout(2500)
        murat.screenshot(path=os.path.join(OUT, "26_iki_murat_partner_cikti.png"))
        log("Selin salondan çıktı", selin.get_by_text("Salondan Çık").count() == 0)
        log("Murat: partner salonda değil", murat.get_by_text("salonda değil").count() > 0)

        browser.close()

    print()
    if failures:
        print(f"{len(failures)} SORUN: {', '.join(failures)}")
        sys.exit(1)
    print("İKİ CİHAZ SENKRON TESTİ GEÇTİ ✅")


if __name__ == "__main__":
    main()
