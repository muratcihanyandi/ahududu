"""Uçtan uca: film sitesi -> perde -> video gerçekten oynuyor mu?

Gerçek kullanıcı akışı:
  1. Sinema sekmesi -> film linkini yapıştır -> salon açılır
  2. Perdeye proxy'lenmiş embed gelir
  3. Video oynatılabilir mi? (iframe içinde <video> ilerliyor mu)

Not: embed kendi oynatıcısında oynadığı için senkron YOK; amaç videonun
perdede görünmesi ve oynaması.
"""

import json
import os
import sys
import urllib.request

from playwright.sync_api import sync_playwright

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://127.0.0.1:33481")
FILM = "https://www.hdfilmcehennemi.nl/the-odyssey-3/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ui_shots")
os.makedirs(OUT, exist_ok=True)
results = []


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        f"{BASE}{path}", data=body, method=method,
        headers={"Content-Type": "application/json"} if body else {},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def check(name, ok, detail=""):
    results.append(ok)
    print(("[OK]   " if ok else "[FAIL] ") + name + (f" :: {detail}" if detail else ""))


def main():
    resolved = api("/api/cinema/resolve", "POST", {"video_url": FILM})
    print("çözümleme:", json.dumps({k: str(v)[:90] for k, v in resolved.items() if k in
                                    ("source", "kind", "video_url", "embed_url")}, ensure_ascii=False))
    check("film sitesi embed'e çözüldü", bool(resolved.get("embed_url")),
          str(resolved.get("embed_url"))[:80])
    check("site.webm yanlışı bitti", "webm" not in (resolved.get("video_url") or ""),
          str(resolved.get("video_url"))[:60])

    room = api("/api/cinema", "POST", {
        "title": "Odyssey",
        "video_url": resolved.get("video_url") or FILM,
        "embed_url": resolved.get("embed_url"),
        "source": resolved.get("source"),
        "kind": resolved.get("kind") or "embed",
        "created_by": "murat",
    })
    room_id = room["id"]
    api(f"/api/cinema/{room_id}/start", "POST", {"user_id": "murat"})
    print("oda:", room_id, room.get("embed_url"))

    with sync_playwright() as p:
        browser = None
        for channel in ("chrome", "msedge"):
            try:
                browser = p.chromium.launch(channel=channel, args=["--mute-audio", "--autoplay-policy=no-user-gesture-required"])
                break
            except Exception as exc:  # noqa: BLE001
                print(f"[..] {channel}: {str(exc)[:70]}")

        ctx = browser.new_context(viewport={"width": 915, "height": 412}, has_touch=True, is_mobile=True)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        media = []
        page.on("request", lambda r: media.append(r.url[:110])
                if any(k in r.url.lower() for k in ("/hls/", ".m3u8", "/txt/")) else None)

        page.goto(BASE, wait_until="networkidle")
        page.evaluate("localStorage.setItem('ahududu_user','murat')")
        page.reload(wait_until="networkidle")
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Sinema").first.click()
        page.wait_for_timeout(1200)
        for label in ("Salona Gir", "Sahnedeki Filme Dön", "Katıl"):
            btn = page.get_by_role("button", name=label)
            if btn.count():
                btn.first.click()
                break
        page.wait_for_timeout(10000)
        page.screenshot(path=os.path.join(OUT, "site_perde.png"))

        frames = [f.url[:110] for f in page.frames]
        print("\nframe'ler:", json.dumps(frames, ensure_ascii=False, indent=1)[:900])

        # iframe içinde video var mı / oynuyor mu
        vinfo = []
        for frame in page.frames:
            try:
                v = frame.evaluate(
                    "() => Array.from(document.querySelectorAll('video')).map(x => ({src:(x.currentSrc||'').slice(0,90),paused:x.paused,t:x.currentTime,ready:x.readyState}))"
                )
                if v:
                    vinfo.append({"frame": frame.url[:80], "video": v})
            except Exception:
                pass
        print("\nvideolar:", json.dumps(vinfo, ensure_ascii=False, indent=1)[:1200])

        check("perdeye embed iframe geldi",
              any("hdfilmcehennemi" in f or "mobi" in f for f in frames), str(frames)[:100])
        check("embed içinde video öğesi var", any(x["video"] for x in vinfo), str(len(vinfo)))
        check("akış isteği yapıldı (hls/m3u8)", bool(media), str(media[:2]))

        # 4 sn izle, ilerliyor mu
        def t_of():
            for frame in page.frames:
                try:
                    r = frame.evaluate(
                        "() => { const v=document.querySelector('video'); return v?{t:v.currentTime,p:v.paused}:null; }"
                    )
                    if r:
                        return r
                except Exception:
                    pass
            return None

        a = t_of()
        page.wait_for_timeout(4500)
        b = t_of()
        print("zaman:", a, "->", b)
        if a and b:
            check("video İLERLİYOR", (b["t"] - a["t"]) > 0.5, f"{a['t']} -> {b['t']}")

        check("sayfa hatası yok", not errors, "; ".join(errors[:2]))
        page.screenshot(path=os.path.join(OUT, "site_perde_son.png"))

        ctx.close()
        browser.close()

    try:
        api(f"/api/cinema/{room_id}", "DELETE")
    except Exception:
        pass

    print(f"\n{sum(results)}/{len(results)} kontrol geçti")
    return 0 if all(results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
