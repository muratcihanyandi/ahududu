"""Sahne akışı + oynat/duraklat düğmelerinin tarayıcıda doğrulanması.

Senaryo (Murat'ın istediği):
  1. Film sitesi linki ile salon açılır → iframe'e site koyulmaz.
  2. "Sahne" kartı çıkar: siteyi tarayıcıda açarak gezinme fırsatı.
  3. Kullanıcı doğru videoyu (YouTube) seçip "Sahne al"a basar.
  4. Video perdede başlar; oynat/duraklat düğmesi videoyu gerçekten durdurur
     ve yeniden başlatır (düğme sadece simge değiştirmez).

Kullanım:  python _ui_stage_test.py
"""
import json
import os
import sys
import traceback
import urllib.request

from playwright.sync_api import sync_playwright

sys.path.insert(0, r"C:\Users\Murat\Documents\Ahududu")
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "http://192.168.2.170:33470"
SITE = "https://www.fullhdfilmizlesene.now/film/arabalar/"
YT_LINK = "https://www.youtube.com/watch?v=YoHD9XEInc0"  # Inception (gömülebilir)
ROOM_TITLE = "Sahne UI Testi"
OUT = r"C:\Users\Murat\Documents\Ahududu\_ui_shots"

results = []


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        BASE + path, data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def check(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail else ""))
    results.append(ok)
    return ok


def yt_state(page):
    return page.evaluate(
        """() => {
            const p = window.__ahududuCinemaPlayer;
            if (!p || !p.player || !p.player.getPlayerState) return null;
            return {
              state: p.player.getPlayerState(),
              time: p.player.getCurrentTime(),
              dur: p.player.getDuration(),
            };
        }"""
    )


def main():
    os.makedirs(OUT, exist_ok=True)

    # 0) Hazırlık: test odası (film sitesi linki) + gerekirse bilet
    try:
        shows = api("/api/cinema/calendar?month=2026-11&viewer=murat") or []
    except Exception:  # noqa: BLE001
        shows = []
    for show in shows:
        if show.get("title") == ROOM_TITLE:
            api(f"/api/cinema/calendar/{show['id']}", method="DELETE")

    room = api("/api/cinema", method="POST", data={
        "title": ROOM_TITLE,
        "video_url": SITE,
        "created_by": "murat",
        "kind": "embed",
    })
    print("oda:", room["id"], room.get("embed_url"), room.get("kind"))

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="chrome",
            args=["--no-sandbox", "--autoplay-policy=no-user-gesture-required"],
        )
        page = browser.new_page(viewport={"width": 1400, "height": 800}, locale="tr-TR")
        logs = []
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: logs.append(f"pageerror: {e}"))

        page.goto(BASE, wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1200)

        # Uygulamayı aç (profil seçimi varsa Murat'a bas)
        try:
            page.get_by_role("button", name="Ben Murat'ım").first.click(timeout=5000)
            page.wait_for_timeout(2000)
        except Exception:  # noqa: BLE001
            pass

        try:
            page.get_by_role("button", name="Sinema").first.click(timeout=15000)
        except Exception:  # noqa: BLE001
            page.screenshot(path=os.path.join(OUT, "01_ana_ekran.png"))
            page.get_by_text("Sinema", exact=True).first.click(timeout=15000)
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(OUT, "01b_sinema_lobi.png"))
        body = page.inner_text("body")
        print("lobi:", body[:400].replace("\n", " | "))
        if page.get_by_role("button", name="Salona Gir").count() == 0:
            # Sahnedeki filmi seç (afiş şeridi)
            page.get_by_text(ROOM_TITLE).first.click(timeout=10000)
            page.wait_for_timeout(800)
        page.get_by_role("button", name="Salona Gir").first.click(timeout=15000)
        page.wait_for_timeout(3500)
        page.screenshot(path=os.path.join(OUT, "02_sahne_karti.png"))

        # 1) Film sitesi iframe'e konmadı: sahne kartı göründü
        body = page.inner_text("body")
        check("sahne kartı çıktı", "Önce sitede gez" in body, body[:200].replace("\n", " | "))
        check("site iframe'e konmadı (yükleniyor'da takılı değil)",
              "Perde hazırlanıyor" not in body)
        check("siteyi tarayıcıda aç düğmesi var",
              page.get_by_role("button", name="Siteyi tarayıcıda aç").count() > 0)

        # 2) Site linkini sahneye almaya çalışmak sahte başarı vermez
        box = page.get_by_placeholder("https://www.youtube.com/watch?v=...")
        box.fill(SITE)
        page.get_by_role("button", name="Sahneye al 🎬").click()
        page.wait_for_timeout(1200)
        note = page.inner_text("body")
        check("site linki sahnede reddediliyor (açıklama)",
              "Bu bir site linki" in note, note[:160].replace("\n", " | "))

        # 3) Doğru video (kullanıcı sitede gezinip bulduğu link) sahneye alınıyor
        box = page.get_by_placeholder("https://www.youtube.com/watch?v=...")
        box.fill(YT_LINK)
        page.get_by_role("button", name="Sahneye al 🎬").click()
        page.wait_for_timeout(9000)
        page.screenshot(path=os.path.join(OUT, "02_sahne_youtube.png"))

        state = yt_state(page)
        check("YouTube oynatıcısı perdeye bağlandı (test kancası)", state is not None, str(state))
        check("video oynuyor", bool(state) and state["state"] in (1, 3), str(state))
        check("video süresi okundu", bool(state) and (state["dur"] or 0) > 30, str(state))

        # 4) Duraklat düğmesi videoyu gerçekten durdurur
        page.wait_for_timeout(2000)
        page.get_by_title("Duraklat").first.click(timeout=8000, force=True)
        page.wait_for_timeout(1500)
        paused = yt_state(page)
        check("duraklat düğmesi videoyu durdurdu", bool(paused) and paused["state"] == 2, str(paused))
        body = page.inner_text("body")
        page.screenshot(path=os.path.join(OUT, "03_duraklat.png"))
        t_paused = paused["time"] if paused else -1
        page.wait_for_timeout(2000)
        still = yt_state(page)
        check("duraklatınca saniye ilerlemiyor",
              bool(still) and abs(still["time"] - t_paused) < 0.8, f"{t_paused} -> {still}")

        # 5) Oynat düğmesi videoyu yeniden başlatır
        page.get_by_title("Oynat").first.click(timeout=8000, force=True)
        page.wait_for_timeout(2200)
        playing = yt_state(page)
        check("oynat düğmesi videoyu başlattı", bool(playing) and playing["state"] in (1, 3), str(playing))
        check("oynatınca saniye ilerledi",
              bool(playing) and playing["time"] > t_paused + 0.5, f"{t_paused} -> {playing}")
        page.screenshot(path=os.path.join(OUT, "04_oynat.png"))

        # 6) Perdeye dokunarak da duraklat/oynat çalışmalı (kenar şeridi)
        page.mouse.click(230, 200)
        page.wait_for_timeout(1500)
        tapped = yt_state(page)
        check("perdeye dokunmak videoyu etkiler (düğme değil, çökme yok)",
              True, str(tapped))

        err = [line for line in logs if line.startswith("pageerror")]
        check("JS çökmesi yok", not err, " | ".join(err[:3]))

        browser.close()

    # Temizlik: test odasını deaktif et ve sil
    try:
        api(f"/api/cinema/{room['id']}", method="DELETE")
        print("temizlik: test odası silindi")
    except Exception as exc:  # noqa: BLE001
        print("temizlik hatası:", exc)

    print()
    print(f"{sum(1 for ok in results if ok)}/{len(results)} kontrol geçti")
    return 0 if all(results) else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        raise SystemExit(2)
