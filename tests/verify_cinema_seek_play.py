"""Sinema: SARMA + OYNAT senaryosu (kullanıcının bildirdiği hata).

Senaryo: "Dakika 7'ye alıyorum, başlatıyorum. Başlamıyor; 100 kez denesem de
bazen başlıyor sonra duruyor, kendi kendine devam etmiyor."

Ölçülenler:
  1. 7. dakikaya sarma gerçekten uygulanıyor mu?
  2. Oynat'a basınca video oynuyor mu?
  3. 15 saniye sonra HÂLÂ oynuyor mu, yoksa kendi kendine duruyor mu?
  4. Sarma sonrası bölüm (segment) yüklendi mi? (HLS'te seek sonrası takılma)
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://192.168.2.170:33470")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_verify")
os.makedirs(OUT, exist_ok=True)

FILM_PAGE = "https://www.fullhdfilmizlesene.now/film/arabalar/"
SEEK_TO = 420  # 7. dakika

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
    with urllib.request.urlopen(req, timeout=180) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def main():
    print("Akış çözümleniyor...")
    resolved = api("/api/cinema/resolve", "POST", {"video_url": FILM_PAGE})
    if not resolved.get("stream_url"):
        log("akış çözüldü", False, str(resolved)[:200])
        return 1
    room = api("/api/cinema", "POST", {
        "title": "Arabalar - sarma testi",
        "video_url": resolved["video_url"],
        "created_by": "murat",
        "kind": resolved["kind"],
        "source": resolved["source"],
        "stream_url": resolved["stream_url"],
        "stream_referer": resolved.get("stream_referer"),
    })
    api(f"/api/cinema/{room['id']}/start", "POST", {"user_id": "murat"})

    with sync_playwright() as p:
        exe = next((x for x in [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        ] if os.path.exists(x)), None)
        launch = {"headless": True, "args": ["--disable-gpu", "--autoplay-policy=no-user-gesture-required"]}
        if exe:
            launch["executable_path"] = exe
        browser = p.chromium.launch(**launch)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        logs = []
        page.on("console", lambda m: logs.append(f"{m.type}: {m.text}"))
        page.on("pageerror", lambda e: logs.append(f"PAGEERROR: {e}"))

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.get_by_role("button", name="Salona Gir").first.click()
        page.wait_for_timeout(9000)

        has_video = page.evaluate("() => !!document.querySelector('video')")
        log("salonda video var", has_video)
        if not has_video:
            browser.close()
            return 1

        # --- 1) Alt bardaki ilerleme çubuğuna tıkla: 7. dakika ---
        seek_result = page.evaluate(
            """(target) => {
                const v = document.querySelector('video');
                if (!v) return { error: 'video yok' };
                const dur = v.duration || 0;
                if (!(dur > 0)) return { error: 'süre bilinmiyor' };
                const ratio = target / dur;
                // Alt bardaki sarma düğmesini bul (title="Sarma")
                const stage = v.parentElement;
                const bar = [...stage.querySelectorAll('button')].find(
                    b => (b.getAttribute('title') || '') === 'Sarma');
                if (!bar) return { error: 'sarma çubuğu bulunamadı' };
                const r = bar.getBoundingClientRect();
                const x = r.left + r.width * ratio;
                const y = r.top + r.height / 2;
                bar.dispatchEvent(new MouseEvent('click', {
                    bubbles: true, cancelable: true, clientX: x, clientY: y,
                }));
                return { clicked: true, ratio: +ratio.toFixed(3), dur: +dur.toFixed(1) };
            }""",
            SEEK_TO,
        )
        print("SARMA:", seek_result)
        page.wait_for_timeout(2500)

        after_seek = page.evaluate(
            """() => {
                const v = document.querySelector('video');
                return { t: v ? +v.currentTime.toFixed(1) : null,
                         paused: v ? v.paused : null,
                         readyState: v ? v.readyState : null,
                         buffered: v && v.buffered.length ? +v.buffered.end(0).toFixed(1) : 0 };
            }"""
        )
        print("SARMA SONRASI:", after_seek)
        log("7. dakikaya sarıldı", abs((after_seek.get("t") or 0) - SEEK_TO) < 12, str(after_seek))

        # --- 2) Duraklat / Oynat döngüsü: kullanıcının şikayeti ---
        play_result = page.evaluate(
            """async () => {
                const v = document.querySelector('video');
                const stage = v.parentElement;
                const btn = [...stage.querySelectorAll('button')].find(
                    b => /Oynat|Duraklat/i.test(b.getAttribute('title') || ''));
                if (!btn) return { error: 'oynat düğmesi yok' };
                const before = { paused: v.paused, t: +v.currentTime.toFixed(1) };
                btn.click();                    // duraklat (oynuyordu)
                await new Promise(r => setTimeout(r, 1200));
                const mid = { paused: v.paused, t: +v.currentTime.toFixed(1) };
                btn.click();                    // oynat
                await new Promise(r => setTimeout(r, 1500));
                const after = { paused: v.paused, t: +v.currentTime.toFixed(1) };
                return { before, mid, after };
            }"""
        )
        print("OYNAT/DURAKLAT:", json.dumps(play_result, ensure_ascii=False))
        log("duraklat çalıştı", bool((play_result.get("mid") or {}).get("paused")), str(play_result))
        log("oynat çalıştı", (play_result.get("after") or {}).get("paused") is False, str(play_result))

        # --- 3) 15 saniye kesintisiz oynuyor mu? (kendi kendine duruyor mu) ---
        long_run = page.evaluate(
            """async () => {
                const v = document.querySelector('video');
                const t0 = v.currentTime;
                const samples = [];
                for (let i = 0; i < 15; i++) {
                    await new Promise(r => setTimeout(r, 1000));
                    samples.push({ t: +v.currentTime.toFixed(1), paused: v.paused });
                }
                const t1 = v.currentTime;
                const stalled = samples.filter(s => s.paused).length;
                return {
                    progressed: +(t1 - t0).toFixed(2),
                    pausedSamples: stalled,
                    finalT: +t1.toFixed(1),
                    finalPaused: v.paused,
                    samples: samples.filter(s => s.paused).length ? samples : 'hepsi oynuyor',
                };
            }"""
        )
        print("\n15 SN OYNATMA:")
        for k, v in long_run.items():
            if k != "samples":
                print(f"  {k}: {v}")
        log("15 sn kesintisiz oynadı", float(long_run.get("progressed") or 0) > 10,
            f"ilerleme={long_run.get('progressed')}sn duran_ornek={long_run.get('pausedSamples')}")
        log("kendi kendine durmadı", long_run.get("pausedSamples") == 0, str(long_run.get("samples")))

        page.screenshot(path=os.path.join(OUT, "cinema_seek_play.png"))

        errs = [l for l in logs if "error" in l.lower() or "PAGEERROR" in l]
        if errs:
            print("\nKONSOL HATALARI (ilk 10):")
            for e in errs[:10]:
                print("  ", e[:220])
        browser.close()

    print("\n" + ("SARMA + OYNAT TESTİ GEÇTİ ✅" if not failures else f"BAŞARISIZ: {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
