"""Yavaş ağ + sarma: kim, neyi, ne zaman yapıyor?

Tüm currentTime setter çağrılarını, hls.js hatalarını ve ağ isteklerini
zaman damgasıyla kaydeder. Ağ yavaşlatma AÇIKKEN sarma yapılır.
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33485")
FILM_PAGE = "https://www.fullhdfilmizlesene.now/film/arabalar/"
SEEK_TO = 420
LATENCY_MS = 150
THROUGHPUT = 190_000


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
    room = api("/api/cinema", "POST", {
        "title": "Arabalar - yavas ag teshis",
        "video_url": resolved["video_url"],
        "created_by": "murat",
        "kind": resolved["kind"],
        "source": resolved["source"],
        "stream_url": resolved["stream_url"],
        "stream_referer": resolved.get("stream_referer"),
    })
    api(f"/api/cinema/{room['id']}/start", "POST", {"user_id": "murat"})

    with sync_playwright() as p:
        exe = next((x for x in [r"C:\Program Files\Google\Chrome\Application\chrome.exe"]
                    if os.path.exists(x)), None)
        launch = {"headless": True, "args": ["--disable-gpu", "--autoplay-policy=no-user-gesture-required"]}
        if exe:
            launch["executable_path"] = exe
        browser = p.chromium.launch(**launch)
        page = browser.new_page(viewport={"width": 1280, "height": 800})

        reqs = []
        page.on("request", lambda r: reqs.append({"t": "start", "u": r.url[:60]})
                if "/cinema/hls" in r.url else None)
        page.on("requestfinished", lambda r: reqs.append({"t": "done", "u": r.url[:60]})
                if "/cinema/hls" in r.url else None)
        page.on("requestfailed", lambda r: reqs.append({"t": "FAIL", "u": r.url[:60],
                                                       "why": str(r.failure)[:40]})
                if "/cinema/hls" in r.url else None)

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.get_by_role("button", name="Salona Gir").first.click()
        page.wait_for_timeout(12000)

        # currentTime setter'ı izle + MediaSource durumu
        page.evaluate(
            """() => {
                const v = document.querySelector('video');
                window.__ct = [];
                const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
                Object.defineProperty(v, 'currentTime', {
                    configurable: true,
                    get() { return d.get.call(this); },
                    set(x) {
                        window.__ct.push({ at: +(performance.now()/1000).toFixed(2),
                                           from: +d.get.call(this).toFixed(1),
                                           to: +(+x).toFixed(1) });
                        return d.set.call(this, x);
                    },
                });
                window.__ms = () => {
                    const b = v.buffered;
                    const r = [];
                    for (let i = 0; i < b.length; i++) r.push([+b.start(i).toFixed(0), +b.end(i).toFixed(0)]);
                    return { ranges: r, rs: v.readyState, t: +v.currentTime.toFixed(1),
                             paused: v.paused, seeking: v.seeking,
                             networkState: v.networkState, error: v.error ? v.error.code : null };
                };
            }"""
        )

        print(">>> AĞ YAVAŞLATILIYOR (1.5 Mbps)")
        cdp = page.context.new_cdp_session(page)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {
            "offline": False, "latency": LATENCY_MS,
            "downloadThroughput": THROUGHPUT,
            "uploadThroughput": THROUGHPUT // 4,
        })
        page.wait_for_timeout(1000)
        print("  önce:", json.dumps(page.evaluate("() => window.__ms()"), ensure_ascii=False))

        reqs.clear()
        page.evaluate(
            """(target) => {
                const v = document.querySelector('video');
                window.__ct.length = 0;
                const bar = [...v.parentElement.querySelectorAll('button')]
                    .find(b => (b.getAttribute('title') || '') === 'Sarma');
                const r = bar.getBoundingClientRect();
                bar.dispatchEvent(new MouseEvent('click', {
                    bubbles: true, cancelable: true,
                    clientX: r.left + r.width * (target / v.duration),
                    clientY: r.top + r.height / 2,
                }));
            }""",
            SEEK_TO,
        )

        print(f"\n>>> SARMA YAPILDI, 20 sn izleniyor")
        for i in range(20):
            page.wait_for_timeout(1000)
            ms = page.evaluate("() => window.__ms()")
            print(f"  {i+1:2}s t={ms['t']:7.1f} rs={ms['rs']} seeking={ms['seeking']} "
                  f"net={ms['networkState']} tampon={ms['ranges'][:2]}")

        print("\n>>> currentTime SETTER ÇAĞRILARI:")
        for e in page.evaluate("() => window.__ct"):
            print(f"   t={e['at']:6.2f}s  {e['from']:7.1f} -> {e['to']:7.1f}")

        print(f"\n>>> AĞ İSTEKLERİ ({len(reqs)}):")
        for r in reqs[:20]:
            print(f"   {r['t']:5} {r['u']} {r.get('why','')}")

        browser.close()


if __name__ == "__main__":
    main()
