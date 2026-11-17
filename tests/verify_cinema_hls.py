"""Kara ekran düzeltmesi — GERÇEK tarayıcıda oynatma doğrulaması.

Sinema salonunda film sitesinden gelen akışın gerçekten OYNADIĞINI kanıtlar:
  - video.currentTime ilerliyor mu?
  - video genişliği/yüksekliği > 0 (metadata yüklendi mi)?
  - kare gerçekten çiziliyor mu (canvas piksel örneklemesi: siyah değil mi)?

Yerel dev sunucusu gerekli (bkz. tests/dev_server.py).
Kanıt: tests/screenshots_verify/cinema_hls_*.png
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33481")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_verify")
os.makedirs(OUT, exist_ok=True)

FILM_PAGE = "https://www.fullhdfilmizlesene.now/film/arabalar/"

failures = []


def log(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}", data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=120) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def main():
    # 1) Sunucu gerçek akışı çözsün
    print("Film sayfası çözümleniyor:", FILM_PAGE)
    resolved = api("/api/cinema/resolve", "POST", {"video_url": FILM_PAGE})
    log("resolve: stream_url bulundu", bool(resolved.get("stream_url")),
        str(resolved)[:300])
    log("resolve: kind = hls", resolved.get("kind") == "hls", str(resolved.get("kind")))
    if not resolved.get("stream_url"):
        return

    # 2) Salonu kur ve başlat
    room = api("/api/cinema", "POST", {
        "title": "Arabalar 🍿",
        "video_url": resolved["video_url"],
        "created_by": "murat",
        "kind": resolved["kind"],
        "source": resolved["source"],
        "stream_url": resolved["stream_url"],
        "stream_referer": resolved.get("stream_referer"),
    })
    api(f"/api/cinema/{room['id']}/start", "POST", {"user_id": "murat"})
    log("salon kuruldu ve başlatıldı", True, f"room={room['id']}")

    # 3) Gerçek tarayıcıda oynat
    with sync_playwright() as p:
        # Sistemdeki gerçek Chrome ile çalıştır (WebView'in masaüstü eşdeğeri).
        # Playwright'ın indirilmiş tarayıcısı yoksa da çalışsın.
        chrome_paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
            r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        ]
        launch_args = {
            "headless": True,
            "args": ["--autoplay-policy=no-user-gesture-required", "--disable-gpu"],
        }
        executable = next((p for p in chrome_paths if os.path.exists(p)), None)
        if executable:
            launch_args["executable_path"] = executable
            print("  tarayıcı:", executable)
        browser = p.chromium.launch(**launch_args)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        errors = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)

        # Gerçek kullanıcı yolu: kim oturuyor → Murat → Sinema → Salona Gir
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.screenshot(path=os.path.join(OUT, "cinema_hls_01_lobi.png"))

        page.get_by_role("button", name="Salona Gir").first.click()
        page.wait_for_timeout(4000)
        page.screenshot(path=os.path.join(OUT, "cinema_hls_02_salon.png"))

        # 4) Oynatıcıdan ÖLÇÜM al: bu, "kara ekran" iddiasının tek kanıtı.
        result = page.evaluate(
            """async () => {
                const v = document.querySelector('video');
                if (!v) return { error: 'salonda <video> yok' };
                // Birkaç saniye bekle: akış yüklensin ve kare ÇİZİLSİN.
                const t0 = v.currentTime;
                await new Promise(r => setTimeout(r, 7000));
                const t1 = v.currentTime;

                // Piksel örneklemesi: kare gerçekten çiziliyor mu?
                let notBlack = null, sampled = null;
                try {
                    const c = document.createElement('canvas');
                    c.width = 64; c.height = 36;
                    const ctx = c.getContext('2d');
                    ctx.drawImage(v, 0, 0, c.width, c.height);
                    const d = ctx.getImageData(0, 0, c.width, c.height).data;
                    sampled = d.length / 4;
                    let bright = 0;
                    for (let i = 0; i < d.length; i += 4) {
                        if (d[i] > 16 || d[i+1] > 16 || d[i+2] > 16) bright++;
                    }
                    notBlack = bright;
                } catch (e) { notBlack = 'canvas hatası: ' + e.message; }

                return {
                    src: (v.currentSrc || v.src || '').slice(0, 120),
                    readyState: v.readyState,
                    videoWidth: v.videoWidth,
                    videoHeight: v.videoHeight,
                    duration: v.duration,
                    paused: v.paused,
                    t0, t1,
                    progressed: +(t1 - t0).toFixed(2),
                    buffered: v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0,
                    notBlack, sampled,
                };
            }"""
        )
        print("\n--- OYNATICI ÖLÇÜMÜ ---")
        for k, val in (result or {}).items():
            print(f"  {k}: {val}")

        page.screenshot(path=os.path.join(OUT, "cinema_hls_03_oynuyor.png"))
        browser.close()

    log("salonda <video> öğesi var", not (result or {}).get("error"), str((result or {}).get("error")))
    log("video boyutu yüklendi", int((result or {}).get("videoWidth") or 0) > 0,
        f"{result.get('videoWidth')}x{result.get('videoHeight')}")
    log("oynatma ilerledi (currentTime arttı)", float((result or {}).get("progressed") or 0) > 1.0,
        f"progressed={result.get('progressed')}s")
    nb = (result or {}).get("notBlack")
    log("kare çizildi (KARA EKRAN DEĞİL)", isinstance(nb, int) and nb > 50,
        f"parlak piksel={nb} / {result.get('sampled')} ({nb})")

    if errors:
        print("\nKonsol hataları (ilk 8):")
        for e in errors[:8]:
            print("  ", e[:200])

    print("\n" + ("TÜM KONTROLLER GEÇTİ ✅" if not failures else f"BAŞARISIZ: {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
