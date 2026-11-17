"""Salınım kaynağı: hangi olay/istek playback.position'ı 0'a çekiyor?

WebSocket mesajlarını, HTTP çağrılarını ve state değişimlerini zaman damgasıyla
kaydeder. Video 19s'de 0'a döndüğü anda NE OLDUĞUNU gösterir.
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
        "title": "Arabalar - salinim kaynagi",
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

        page.goto(BASE, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)
        page.get_by_text("Ben Murat").first.click()
        page.wait_for_timeout(2800)
        page.get_by_text("🎬", exact=False).first.click()
        page.wait_for_timeout(3500)
        page.get_by_role("button", name="Salona Gir").first.click()
        page.wait_for_timeout(9000)

        # WebSocket mesajlarını + fetch'leri yakala
        page.evaluate(
            """() => {
                window.__ev = [];
                const t0 = performance.now();
                const stamp = () => +((performance.now() - t0) / 1000).toFixed(2);

                // WebSocket
                const WS = window.WebSocket;
                window.WebSocket = function(url, protocols) {
                    const ws = new WS(url, protocols);
                    ws.addEventListener('message', (e) => {
                        try {
                            const d = JSON.parse(e.data);
                            if (d && d.type) {
                                window.__ev.push({ at: stamp(), kind: 'ws', type: d.type,
                                    position: d.position, is_playing: d.is_playing,
                                    action: d.action, room_id: d.room_id,
                                    updated_by: d.updated_by });
                            }
                        } catch (_) {}
                    });
                    return ws;
                };
                window.WebSocket.prototype = WS.prototype;

                // fetch
                const of = window.fetch;
                window.fetch = function(u, o) {
                    const url = String(u);
                    if (url.includes('/cinema')) {
                        let body = null;
                        try { body = o && o.body ? JSON.parse(o.body) : null; } catch (_) {}
                        window.__ev.push({ at: stamp(), kind: 'http',
                            url: url.replace(/^.*\\/api/, '/api'),
                            action: body && body.action, position: body && body.position });
                    }
                    return of.apply(this, arguments);
                };

                // video izleme
                const v = document.querySelector('video');
                window.__trace = [];
                const dct = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
                Object.defineProperty(v, 'currentTime', {
                    configurable: true,
                    get() { return dct.get.call(this); },
                    set(x) {
                        window.__ev.push({ at: stamp(), kind: 'setTime',
                                           from: +dct.get.call(this).toFixed(2), to: +(+x).toFixed(2) });
                        return dct.set.call(this, x);
                    },
                });
                window.__timer = setInterval(() => {
                    window.__trace.push({ at: stamp(), t: +v.currentTime.toFixed(2), paused: v.paused });
                }, 250);
            }"""
        )

        print(">>> 30 saniye izleniyor")
        page.wait_for_timeout(30000)

        trace = page.evaluate("() => window.__trace")
        events = page.evaluate("() => window.__ev")

        jumps = [(trace[i-1], trace[i]) for i in range(1, len(trace))
                 if trace[i]["t"] < trace[i-1]["t"] - 0.5]

        print(f"\n>>> GERİYE SIÇRAMA: {len(jumps)}")
        for a, b in jumps[:8]:
            print(f"   t={b['at']:6.2f}s  {a['t']:7.2f} -> {b['t']:7.2f}")

        print(f"\n>>> OLAYLAR (ilk 60):")
        for e in events[:60]:
            if e["kind"] == "setTime":
                print(f"   {e['at']:6.2f}s  SETTIME  {e['from']:7.2f} -> {e['to']:7.2f}")
            elif e["kind"] == "ws":
                print(f"   {e['at']:6.2f}s  WS: {e.get('type'):24} pos={e.get('position')} "
                      f"play={e.get('is_playing')} action={e.get('action')} by={e.get('updated_by')}")
            else:
                print(f"   {e['at']:6.2f}s  HTTP: {str(e.get('url'))[:60]:60} "
                      f"action={e.get('action')} pos={e.get('position')}")

        browser.close()


if __name__ == "__main__":
    main()
