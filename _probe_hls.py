"""HLS zincirini baştan sona doğrula: master -> varyant -> segment.

Segmentler de referer istiyor mu? Şifreleme (EXT-X-KEY) var mı?
Videoyu uygulama içinde oynatmak için gereken tek şey bu zincir.
"""

import sys
import urllib.error
import urllib.parse
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)
REF = {"Referer": "https://hdfilmcehennemi.mobi/", "Origin": "https://hdfilmcehennemi.mobi"}

MASTER = (
    "https://srv9.cdnimages2655.cyou/hls/theodyssey-2026-bluray-tt33764258mp4-eLTbK1Nxgyg.mp4/"
    "txt/master.txt?s=AVmU2GSXiApJNQZnRCo-cFfqKigdEUD7dOD237LJx0HOb62Jma-Kj3"
)


def fetch(url, extra=None):
    headers = {"User-Agent": UA, "Accept": "*/*"}
    headers.update(REF)
    if extra:
        headers.update(extra)
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=25) as res:
        return res.status, res.read(), str(res.url)


st, body, _ = fetch(MASTER)
text = body.decode("utf-8", "replace")
print(f"master: {st}, {len(body)} bayt")
print("--- master içeriği ---")
print(text[:600])

variants = [l.strip() for l in text.splitlines() if l.strip() and not l.startswith("#")]
print("\nvaryantlar:", variants[:5])

if variants:
    vurl = urllib.parse.urljoin(MASTER, variants[0])
    print("\nvaryant:", vurl)
    st2, body2, _ = fetch(vurl)
    vtext = body2.decode("utf-8", "replace")
    print(f"varyant durumu: {st2}, {len(body2)} bayt")
    print("--- varyant (ilk 700) ---")
    print(vtext[:700])

    enc = [l for l in vtext.splitlines() if "EXT-X-KEY" in l]
    print("\nşifreleme:", enc if enc else "YOK (şifresiz)")

    segs = [l.strip() for l in vtext.splitlines() if l.strip() and not l.startswith("#")]
    print(f"segment sayısı: {len(segs)}")
    if segs:
        surl = urllib.parse.urljoin(vurl, segs[0])
        print("ilk segment:", surl[:160])
        try:
            st3, body3, _ = fetch(surl)
            print(f"segment durumu: {st3}, {len(body3)} bayt, ilk baytlar: {body3[:8].hex()}")
        except urllib.error.HTTPError as exc:
            print(f"segment HATA: HTTP {exc.code}")
