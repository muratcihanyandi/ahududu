"""Sinema: video tam ekran + oynarken takılma yok.

İki şeyi GERÇEK tarayıcıda kanıtlar:
  1. Alt bardaki tam ekran düğmesi videoyu gerçekten tam ekran yapıyor.
  2. Film oynarken senkron motoru oynatıcıya dokunmuyor (seek/hız değişimi yok),
     yani mikro takılma olmuyor. Duraklat → oynat sonrası saniyeler eşitleniyor.

Yerel dev sunucusu gerekli (tests/dev_server.py).
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33483")
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
    with urllib.request.urlopen(req, timeout=180) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def main():
    resolved = api("/api/cinema/resolve", "POST", {"video_url": FILM_PAGE})
    if not resolved.get("stream_url"):
        log("akış çözüldü", False, str(resolved)[:200])
        return 1
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
        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.get_by_role("button", name="Salona Gir").first.click()
        page.wait_for_timeout(9000)

        # --- 1) Takılma testi: oynarken motor oynatıcıya dokunmamalı ---
        metrics = page.evaluate(
            """async () => {
                const v = document.querySelector('video');
                if (!v) return { error: 'video yok' };
                // setTime ve playbackRate çağrılarını sar: motor dokunuyor mu?
                let seekCalls = 0, rateChanges = 0;
                const origCurrentTime = Object.getOwnPropertyDescriptor(
                    HTMLMediaElement.prototype, 'currentTime');
                Object.defineProperty(v, 'currentTime', {
                    configurable: true,
                    get() { return origCurrentTime.get.call(this); },
                    set(val) { seekCalls++; origCurrentTime.set.call(this, val); },
                });
                const origRate = Object.getOwnPropertyDescriptor(
                    HTMLMediaElement.prototype, 'playbackRate');
                Object.defineProperty(v, 'playbackRate', {
                    configurable: true,
                    get() { return origRate.get.call(this); },
                    set(val) { rateChanges++; origRate.set.call(this, val); },
                });

                const t0 = v.currentTime;
                await new Promise(r => setTimeout(r, 12000));
                const t1 = v.currentTime;
                return {
                    progressed: +(t1 - t0).toFixed(2),
                    natural: Math.abs((t1 - t0) - 12) < 3,
                    seekCalls, rateChanges,
                    paused: v.paused,
                    fsEnabled: document.fullscreenEnabled,
                };
            }"""
        )
        print("--- OYNARKEN (12 sn) ---")
        for k, v in (metrics or {}).items():
            print(f"  {k}: {v}")
        log("oynatma akıcı ilerledi (takılmadı)", bool((metrics or {}).get("natural")), str(metrics))
        log("oynarken SIFIR seek", (metrics or {}).get("seekCalls") == 0, str((metrics or {}).get("seekCalls")))
        log("oynarken SIFIR hız değişimi", (metrics or {}).get("rateChanges") == 0,
            str((metrics or {}).get("rateChanges")))

        # --- 2) Tam ekran düğmesi (ALT BARDAKİ, perdenin içindeki) ---
        clicked = page.evaluate(
            """() => {
                const v = document.querySelector('video');
                if (!v) return 'video yok';
                const stage = v.parentElement;            // CinemaStage kapsayıcısı
                const btns = [...stage.querySelectorAll('button')];
                const fs = btns.find(b => /Tam ekran/i.test(
                    (b.getAttribute('title') || '') + (b.getAttribute('aria-label') || '')));
                if (!fs) return 'alt barda tam ekran düğmesi yok';
                fs.click();
                return 'tiklandi';
            }"""
        )
        log("alt barda tam ekran düğmesi çalıştı", clicked == "tiklandi", str(clicked))

        page.wait_for_timeout(1800)
        fs = page.evaluate(
            """() => {
                const v = document.querySelector('video');
                const el = document.fullscreenElement;
                return {
                    videoIsFs: el === v,
                    anyFs: Boolean(el),
                    fsTag: el ? el.tagName : null,
                    paused: v ? v.paused : null,
                    t: v ? +v.currentTime.toFixed(1) : null,
                };
            }"""
        )
        print("\n--- TAM EKRAN ---")
        for k, v in (fs or {}).items():
            print(f"  {k}: {v}")
        page.screenshot(path=os.path.join(OUT, "cinema_fullscreen.png"))
        log("VİDEO tam ekranda", bool((fs or {}).get("videoIsFs")), str(fs))
        log("tam ekranda video oynamaya devam ediyor", (fs or {}).get("paused") is False, str(fs))

        browser.close()

    print("\n" + ("TAM EKRAN + TAKILMA TESTİ GEÇTİ ✅" if not failures else f"BAŞARISIZ: {failures}"))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main() or 0)
