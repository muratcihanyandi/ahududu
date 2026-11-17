"""Canlı sunucuda HLS segment yükleme hızı teşhisi.

Video oynuyor görünüyor ama ilerleme yavaşsa sebep segment indirme hızıdır.
Sunucunun /api/cinema/hls proxy'si üzerinden segment indirme sürelerini ölçer.
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = os.getenv("AHUDUDU_VERIFY_BASE", "http://192.168.2.170:33470")
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


def timed_get(url, label):
    t0 = time.time()
    with urllib.request.urlopen(url, timeout=120) as r:
        data = r.read()
    ms = (time.time() - t0) * 1000
    print(f"  {label:22} {ms:8.0f} ms  {len(data)/1024:8.1f} KB  "
          f"{'HIZLI' if ms < 1500 else ('YAVAS' if ms < 4000 else 'ÇOK YAVAS')}")
    return ms, data


def main():
    print("Akış çözümleniyor...")
    resolved = api("/api/cinema/resolve", "POST", {"video_url": FILM_PAGE})
    stream_url = resolved.get("stream_url")
    referer = resolved.get("stream_referer")
    if not stream_url:
        print("akış yok:", str(resolved)[:200])
        return 1

    q = f"url={urllib.parse.quote(stream_url, safe='')}"
    if referer:
        q += f"&referer={urllib.parse.quote(referer, safe='')}"

    print("\n>>> MASTER")
    ms, body = timed_get(f"{BASE}/api/cinema/hls?{q}", "master")
    text = body.decode("utf-8", "replace")
    variants = [l.strip() for l in text.splitlines()
                if l.strip() and not l.startswith("#")]
    print(f"  varyant sayısı: {len(variants)}")

    if not variants:
        print(text[:300])
        return 1

    # En düşük kaliteyi (son varyant) ve en yükseği (ilk) ölç
    for label, idx in (("en yuksek kalite", 0), ("en dusuk kalite", len(variants) - 1)):
        if idx >= len(variants):
            continue
        child = variants[idx]
        child_full = child if child.startswith("http") else f"{BASE}{child}"
        print(f"\n>>> ALT PLAYLIST ({label})")
        ms_c, body_c = timed_get(child_full, "child playlist")
        segs = [l.strip() for l in body_c.decode("utf-8", "replace").splitlines()
                if l.strip() and not l.startswith("#")]
        print(f"  segment sayısı: {len(segs)}")
        if not segs:
            continue

        print(f"\n>>> SEGMENTLER ({label}, ilk 3)")
        times = []
        for i, s in enumerate(segs[:3]):
            seg_full = s if s.startswith("http") else f"{BASE}{s}"
            try:
                ms_s, data_s = timed_get(seg_full, f"segment #{i}")
                times.append(ms_s)
            except Exception as e:  # noqa: BLE001
                print(f"  segment #{i} HATA: {e}")

        if times:
            avg = sum(times) / len(times)
            print(f"\n  ortalama segment süresi: {avg:.0f} ms")
            print(f"  >>> Bir segment 10 sn video içeriyor; indirme {avg/1000:.1f} sn.")
            if avg > 5000:
                print("  >>> SORUN: İndirme süresi video süresine yakın/uzun → takılma!")
            elif avg > 3000:
                print("  >>> DİKKAT: Yavaş, tampon zaman zaman tükenebilir.")
            else:
                print("  >>> Segment hızı yeterli.")

    # Doğrudan CDN'den (proxy'siz) ölçüm: proxy mi yavaşlatıyor?
    print("\n>>> DOĞRUDAN CDN (proxy'siz, karşılaştırma)")
    try:
        req = urllib.request.Request(stream_url, headers={
            "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36",
            "Referer": referer or "",
        })
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        print(f"  master (dogrudan)     {(time.time()-t0)*1000:8.0f} ms  {len(data)/1024:.1f} KB")
    except Exception as e:  # noqa: BLE001
        print("  dogrudan CDN hatasi:", e)


if __name__ == "__main__":
    sys.exit(main() or 0)
