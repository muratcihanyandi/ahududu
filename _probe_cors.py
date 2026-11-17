"""Bu HLS akışı tarayıcıda (CORS ile) oynatılabilir mi?

Uygulama içinde <video> + hls.js ile oynatmanın ön koşulu CORS.
Bunu doğrudan ölçüyoruz.
"""

import json
import sys

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

MASTER = (
    "https://srv9.cdnimages2655.cyou/hls/theodyssey-2026-bluray-tt33764258mp4-eLTbK1Nxgyg.mp4/"
    "txt/master.txt?s=AVmU2GSXiApJNQZnRCo-cFfqKigdEUD7dOD237LJx0HOb62Jma-Kj3"
)

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", args=["--mute-audio"])
    ctx = browser.new_context()
    page = ctx.new_page()
    page.goto("about:blank")

    result = page.evaluate(
        """async (url) => {
            try {
                const res = await fetch(url, {
                    headers: { 'Referer': 'https://hdfilmcehennemi.mobi/' },
                });
                return {
                    ok: res.ok,
                    status: res.status,
                    acao: res.headers.get('access-control-allow-origin'),
                    ct: res.headers.get('content-type'),
                    text: (await res.text()).slice(0, 60),
                };
            } catch (e) {
                return { error: String(e) };
            }
        }""",
        MASTER,
    )
    print("CORS denemesi (about:blank origin):")
    print(json.dumps(result, ensure_ascii=False, indent=2))

    # Referer başlığı tarayıcıda ayarlanabilir mi? (forbidden header)
    print("\nNot: 'Referer' yasaklı bir başlıktır; tarayıcı JS ile ayarlanamaz.")

    ctx.close()
    browser.close()
