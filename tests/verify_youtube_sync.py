"""YouTube gömülü video senkronu — gerçek tarayıcı testi.

İki bağlam aynı sinema odasına girer; YouTube IFrame Player API'sinin
yüklenip yüklenmediğini, adaptörün oynatma durumunu okuyabildiğini ve
Murat'ın komutunun Selin tarafına yansıdığını denetler.

YouTube headless ortamda bazen yüklenmez; o durumda sonuç "SKIP" olarak
raporlanır ve hata sayılmaz.

Kullanım:
    $env:PORT=33476; python tests/dev_server.py
    python tests/verify_youtube_sync.py
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33476")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_verify")
os.makedirs(OUT, exist_ok=True)

# Herkese açık, gömülmeye izin veren kısa bir video.
YOUTUBE_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw"

failures = []
skips = []


def log(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def skip(name, reason):
    print(f"[SKIP] {name} :: {reason}")
    skips.append(f"{name}: {reason}")


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}", data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def open_app(browser, user_id):
    ctx = browser.new_context(viewport={"width": 412, "height": 915})
    page = ctx.new_page()
    page.goto(BASE, wait_until="networkidle")
    page.evaluate(f"localStorage.setItem('ahududu_user','{user_id}')")
    page.reload(wait_until="networkidle")
    page.wait_for_timeout(1500)
    return ctx, page


def enter_cinema(page):
    page.get_by_role("button", name="Anılar").first.click()
    page.wait_for_timeout(900)
    page.get_by_role("button", name="Sinema Salonumuz").first.click()
    page.wait_for_timeout(1600)


def join_room(page):
    for label in ("Salona Gir", "Sahnedeki Filme Dön", "Katıl"):
        btn = page.get_by_role("button", name=label)
        if btn.count():
            btn.first.click()
            page.wait_for_timeout(2000)
            return True
    return False


def youtube_state(page):
    """YouTube oynatıcısının durumunu okur (adapter yoksa None)."""
    return page.evaluate(
        """() => {
            const iframe = document.querySelector('iframe[src*="youtube.com/embed"], iframe[src*="youtube.com"]');
            const hasYT = Boolean(window.YT && window.YT.Player);
            return {
                hasApi: hasYT,
                hasIframe: Boolean(iframe),
                iframeSrc: iframe ? iframe.getAttribute('src') : null,
            };
        }"""
    )


def main() -> int:
    room = api("/api/cinema", "POST", {
        "title": "YouTube Senkron Testi",
        "video_url": YOUTUBE_URL,
        "source": "youtube",
        "kind": "embed",
        "created_by": "murat",
    })
    room_id = room["id"]
    print(f"[OK]   oda oluşturuldu: {room_id} ({room.get('embed_url')})")

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(
                    channel=channel,
                    args=["--autoplay-policy=no-user-gesture-required", "--mute-audio"],
                )
                break
            except Exception as exc:  # noqa: BLE001
                print(f"[..] {channel}: {str(exc)[:70]}")
        if browser is None:
            return 1

        ctx, page = open_app(browser, "murat")
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        enter_cinema(page)
        log("Murat salona girdi", join_room(page))
        page.wait_for_timeout(6000)

        state = youtube_state(page)
        print(f"[..]   YT durumu: {json.dumps(state)}")
        page.screenshot(path=os.path.join(OUT, "youtube_01_salon.png"))

        log("YouTube iframe perdeye kondu", state["hasIframe"], str(state))

        if not state["hasApi"]:
            skip("YouTube IFrame API canlı testi", "headless ortamda youtube.com yüklenmedi")
            log("sayfada JS hatası yok", not errors, "; ".join(errors[:2]))
            ctx.close()
            browser.close()
            try:
                api(f"/api/cinema/{room_id}", "DELETE")
            except Exception:
                pass
            print(f"\n{len(failures)} hata, {len(skips)} atlandı")
            return 1 if failures else 0

        # YouTube API gerçekten yüklendi: iki taraf senkronu
        log("YouTube IFrame API yüklendi", True)

        # Adaptörün zaman okuyabildiğini dolaylı doğrula: iframe içi hazır mı?
        yt_ready = page.evaluate(
            """() => {
                const iframe = document.querySelector('iframe[src*="youtube"]');
                if (!iframe) return null;
                try {
                    return { src: iframe.src, width: iframe.clientWidth, height: iframe.clientHeight };
                } catch (e) { return null; }
            }"""
        )
        print(f"[..]   iframe: {yt_ready}")

        # Oynatıcı adaptörünün zaman okuması (teşhis kancası)
        def player_time(p):
            return p.evaluate(
                """() => {
                    const a = window.__ahududuCinemaPlayer;
                    if (!a || !a.isReady || !a.isReady()) return null;
                    return { t: a.getTime(), paused: a.isPaused(), kind: a.kind, dur: a.getDuration() };
                }"""
            )

        t0 = player_time(page)
        print(f"[..]   Murat oynatıcı: {t0}")
        log("Murat tarafında YouTube oynatıcısı hazır", bool(t0), str(t0))

        ctx_b, page_b = open_app(browser, "selin")
        enter_cinema(page_b)
        log("Selin salona katıldı", join_room(page_b))
        page_b.wait_for_timeout(5000)
        state_b = youtube_state(page_b)
        log("Selin tarafında da YouTube iframe var", state_b["hasIframe"], str(state_b))
        page_b.screenshot(path=os.path.join(OUT, "youtube_02_selin.png"))

        if t0:
            a1 = player_time(page)
            b1 = player_time(page_b)
            print(f"[..]   murat={a1} selin={b1}")
            if a1 and b1 and a1["t"] is not None and b1["t"] is not None:
                gap = abs(a1["t"] - b1["t"])
                log("iki taraf YouTube'da aynı saniyede (<= 3 sn)", gap <= 3.0,
                    f"murat={a1['t']:.2f} selin={b1['t']:.2f} fark={gap:.2f}")
                log("YouTube oynatıcı gerçekten ilerliyor", a1["t"] > 0.5, f"t={a1['t']:.2f}")

        # Duraklat: Murat duraklatınca sunucu durumu değişmeli
        pause = page.locator('[title="Duraklat"]')
        if pause.count():
            pause.first.click()
            page_b.wait_for_timeout(3000)
            server_room = api(f"/api/cinema/current")
            is_playing = server_room.get("is_playing") if server_room else None
            log("duraklatma sunucuya yazıldı", is_playing is False, f"is_playing={is_playing}")
            a2 = player_time(page)
            b2 = player_time(page_b)
            print(f"[..]   duraklat sonrası murat={a2} selin={b2}")
            if a2 and b2:
                log("duraklatma YouTube'da iki tarafta da uygulandı",
                    bool(a2["paused"]) and bool(b2["paused"]),
                    f"murat_paused={a2['paused']} selin_paused={b2['paused']}")
        else:
            log("duraklat düğmesi bulundu", False)

        log("sayfada JS hatası yok", not errors, "; ".join(errors[:2]))

        ctx.close()
        ctx_b.close()
        browser.close()

    try:
        api(f"/api/cinema/{room_id}", "DELETE")
    except Exception:
        pass

    print(f"\n{len(failures)} hata, {len(skips)} atlandı")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
