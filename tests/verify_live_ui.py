"""Canlı (Pi üzerindeki yayın) arayüz doğrulaması.

Yerel sunucu gerektirmez; doğrudan https://ahududu.fakeyol.com adresini açar.
Kanıtlar: tests/screenshots_live_ui/
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_LIVE_BASE", "https://ahududu.fakeyol.com")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_live_ui")
os.makedirs(OUT, exist_ok=True)

failures = []


def log(name, ok, detail=""):
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def main() -> int:
    req = urllib.request.Request(
        f"{BASE}/api/system/version",
        headers={"User-Agent": "Mozilla/5.0 (AhududuVerifier)"},
    )
    version = json.loads(urllib.request.urlopen(req, timeout=25).read().decode())
    print(f"[..]   canlı build_id = {version.get('build_id')}")

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(channel=channel)
                break
            except Exception as exc:  # noqa: BLE001
                print(f"[..]   {channel}: {str(exc)[:70]}")
        if browser is None:
            return 1

        ctx = browser.new_context(viewport={"width": 412, "height": 915})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE, wait_until="networkidle", timeout=45000)
        page.evaluate("localStorage.setItem('ahududu_user','murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(2500)

        # Ana sayfa: "Neredeyiz?" kartı Anılar'da
        page.get_by_role("button", name="Anılar").first.click()
        page.wait_for_timeout(2000)
        page.screenshot(path=os.path.join(OUT, "01_anilar.png"))
        body = page.content()
        log("Anılar'da 'Neredeyiz?' görünüyor", "Neredeyiz?" in body)
        log("'Çift Radarı' kalmadı", "Çift Radarı" not in body)
        log("Sinema kartında tanıtım cümlesi yok", "Her siteden video" not in body and "Büyük Güncelleme" not in body)

        # Sohbet: tam ekran + attached nav
        page.get_by_role("button", name="Sohbet").first.click()
        page.wait_for_timeout(2000)
        page.screenshot(path=os.path.join(OUT, "02_sohbet.png"))
        info = page.evaluate(
            """() => {
                const nav = document.querySelector('[data-navigation-variant]');
                const header = document.querySelector('header');
                const main = document.querySelector('main');
                const root = main?.firstElementChild;
                const input = document.querySelector('input[placeholder="Mesaj yaz..."]');
                const composer = input?.closest('div.shrink-0') || null;
                const r = (el) => el ? el.getBoundingClientRect() : null;
                return {
                    variant: nav?.getAttribute('data-navigation-variant'),
                    nav: r(nav), header: r(header), main: r(main), root: r(root), composer: r(composer),
                    vh: window.innerHeight,
                };
            }"""
        )
        log("canlıda sohbet nav 'attached'", info["variant"] == "attached", str(info["variant"]))
        if info["nav"] and info["composer"]:
            log("canlıda composer nav'a bitişik", abs(info["nav"]["top"] - info["composer"]["bottom"]) < 2)
        if info["main"] and info["header"]:
            log("canlıda sohbet başlığı app header'a bitişik", abs(info["main"]["top"] - info["header"]["bottom"]) < 2)
        log("canlıda sayfa hatası yok", not errors, "; ".join(errors[:2]))

        # Hayvanlar sekmesi: "Dost Ekle" formunda kimin dostu sorusu
        page.get_by_role("button", name="Anılar").first.click()
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Hayvanlar").first.click()
        page.wait_for_timeout(1500)
        page.screenshot(path=os.path.join(OUT, "03_hayvanlar.png"))

        add_btn = page.get_by_role("button", name="Dost Ekle")
        if add_btn.count():
            add_btn.first.click()
            page.wait_for_timeout(1200)
            page.screenshot(path=os.path.join(OUT, "04_dost_ekle.png"))
            form_body = page.content()
            log("Dost Ekle'de 'Kimin dostu?' var", "Kimin dostu?" in form_body)
            log("Dost Ekle'de sadece 'Bizim' seçeneği var", "Bizim dostumuz" in form_body)
            log(
                "Dost Ekle'de Murat/Selin seçeneği yok",
                "🐻 Murat" not in form_body and "🌸 Selin" not in form_body,
            )
        else:
            log("'Dost Ekle' düğmesi bulundu", False)

        ctx.close()
        browser.close()

    print(f"\n{len(failures)} hata")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
