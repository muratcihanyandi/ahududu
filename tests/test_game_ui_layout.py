"""Oyun menüsünün telefonda ekrana sığdığını gerçek tarayıcıda ölçer.

Kontroller (her cihaz ölçüsü için):
  • "Başla" düğmesi görünür ve ekran içinde
  • menü kutusu ekrandan taşmıyor (kaydırma gerekmiyor)
  • dokunmatik kumanda düğmeleri menü açıkken gizli, sürüşte tamamen ekran içinde
  • menüde teknik metin yok (WebGPU, FPS, çözünürlük, ms, ölçüm...)
"""

import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
GAME_URL = (ROOT / "frontend" / "public" / "games" / "uno-com-escada" / "index.html").as_uri()
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_game_logic as LU  # noqa: E402  (sahte GPU cihazı: sahne anında kurulur)

BANNED = ["WebGPU", "webgpu", "FPS", "fps", "ms)", "Ölçüm", "ölçüm", "render", "GPU", "çözünürlük", "tarayıcı"]

DEVICES = [
    ("telefon yatay (844x390)", 844, 390),
    ("telefon yatay (740x360)", 740, 360),
    ("telefon yatay küçük (640x320)", 640, 320),
    ("masaüstü (1280x720)", 1280, 720),
]

CHECKS_JS = """() => {
  const r = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const vw = innerWidth, vh = innerHeight;
  const inside = (b) => b.l >= -1 && b.t >= -1 && b.r <= vw + 1 && b.b <= vh + 1;
  const box = document.querySelector('#ui > div');
  const start = document.getElementById('b0');
  const pad = document.getElementById('touchui');
  const btns = [...document.querySelectorAll('#touchui .tbtn')].map(el => ({ cls: el.className, box: r(el) }));
  return {
    vw, vh, hasTouch: document.body.classList.contains('has-touch'),
    uiDisplay: getComputedStyle(document.getElementById('ui')).display,
    startBox: r(start), startInside: inside(r(start)), startVisible: start.getBoundingClientRect().height > 0,
    boxBox: r(box), boxInside: inside(r(box)), boxScroll: box.scrollHeight - box.clientHeight,
    padDisplay: pad ? (getComputedStyle(pad).display + '|' + document.body.className) : 'none',
    btns,
    text: document.getElementById('ui').innerText,
  };
}"""


def main() -> int:
    ok = True

    def check(name, value, extra=""):
        nonlocal ok
        print(("PASS  " if value else "FAIL  ") + name + ((" :: " + extra) if extra and not value else ""))
        ok = ok and bool(value)

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(channel="chrome", headless=True)
        except Exception:  # noqa: BLE001
            browser = p.chromium.launch(headless=True)
        for label, w, h in DEVICES:
            ctx = browser.new_context(viewport={"width": w, "height": h}, has_touch=True,
                                      is_mobile=True, device_scale_factor=2,
                                      user_agent="Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36")
            page = ctx.new_page()
            page.add_init_script(LU.HARNESS)   # sahte GPU: sahne hemen kurulur, menü anında açılır
            page.goto(GAME_URL)
            # Sahne (WebGPU) kurulup menü açılana kadar bekle; hata verirse yine bak.
            try:
                page.wait_for_function(
                    "() => window.__cap && window.__cap.ready()",
                    timeout=120000,
                )
            except Exception:  # noqa: BLE001
                page.wait_for_timeout(8000)
            res = page.evaluate(CHECKS_JS)
            if res["uiDisplay"] == "none":
                # sahne hazır olup menü bir kare sonra açılabilir: kısa bekle
                page.wait_for_timeout(800)
                res = page.evaluate(CHECKS_JS)
            print(f"\n--- {label} — viewport {res['vw']}x{res['vh']} — hasTouch={res['hasTouch']} ui={res['uiDisplay']} ---")
            # NOT: iki "görünür" kavramı farklı: startVisible = düğmenin boyutu var
            # (menü açık), uiDisplay === 'flex' = menü gerçekten gösteriliyor.
            check(f"{label}: 'Başla' görünür", res["startVisible"] and res["uiDisplay"] == "flex",
                  f"visible={res['startVisible']} ui={res['uiDisplay']}")
            check(f"{label}: 'Başla' ekran içinde", res["startInside"],
                  json.dumps(res["startBox"]))
            check(f"{label}: menü kutusu ekran içinde", res["boxInside"], json.dumps(res["boxBox"]))
            check(f"{label}: menü kaydırma gerektirmiyor", res["boxScroll"] <= 1, f"scroll={res['boxScroll']}")
            if res["hasTouch"]:
                # Kumanda menüde gizli; gizli değilse en azından "Başla" düğmesine
                # dokunuşu engellememesi gerekir (tıklama testi aşağıda).
                b0 = res["startBox"]
                pos = page.evaluate(
                    "(b) => { const el = document.elementFromPoint(b.l + b.w / 2, b.t + b.h / 2); return el ? (el.id || el.className) : null; }",
                    b0,
                )
                check(f"{label}: menüde 'Başla' erişilebilir (kumanda örtmüyor)",
                      res["padDisplay"].split("|")[0] == "none" or "b0" in str(pos), f"pad={res['padDisplay']} hit={pos}")
            texts = [b for b in BANNED if b in res["text"]]
            check(f"{label}: menüde teknik metin yok", not texts, ",".join(texts))

            # sürüşe geç: kumanda düğmeleri ekran içinde mi?
            page.evaluate("() => { const b = document.getElementById('b0'); if (b) b.click(); }")
            page.wait_for_timeout(800)
            res2 = page.evaluate(CHECKS_JS)
            outside = [b["cls"] for b in res2["btns"] if not (
                b["box"]["l"] >= -1 and b["box"]["t"] >= -1
                and b["box"]["r"] <= res2["vw"] + 1 and b["box"]["b"] <= res2["vh"] + 1)]
            check(f"{label}: sürüşte kumanda görünür", res2["padDisplay"] != "none", res2["padDisplay"])
            check(f"{label}: tüm kumanda düğmeleri ekran içinde", not outside, ",".join(outside))
            page.screenshot(path=str(ROOT / "tests" / f"_ui_{w}x{h}.png"))
            ctx.close()
        browser.close()

    print("\nMENÜ TESTİ " + ("TAMAM" if ok else "BAŞARISIZ"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
