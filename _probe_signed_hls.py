"""İmzalı tam adresle uçtan uca: master -> segment indirilebiliyor mu?"""

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
MASTER = (
    "https://srv9.cdnimages3712.cyou/hls/theodyssey-2026-bluray-tt33764258mp4-eLTbK1Nxgyg.mp4/"
    "txt/master.txt?s=AXQce-kcneMpCFThDfonl5L7eQQQq1z_ICTR2BdmOBuNvYO-7c88FouL&o=255"
)
REF = {"Referer": "https://hdfilmcehennemi.mobi/"}


def fetch(url, extra=None, limit=None):
    headers = {"User-Agent": UA, "Accept": "*/*"}
    headers.update(REF)
    if extra:
        headers.update(extra)
    if limit:
        headers["Range"] = f"bytes=0-{limit}"
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.status, res.headers.get("content-type"), res.read()


st, ct, body = fetch(MASTER)
print(f"master: {st} ct={ct} len={len(body)}")
text = body.decode("utf-8", "replace")
lines = [l.strip() for l in text.splitlines() if l.strip()]
print("satır sayısı:", len(lines))
print("ilk 5 satır:", lines[:4])

segs = [l for l in lines if not l.startswith("#")]
print("\nsegment adayı:", len(segs))
if segs:
    seg = urllib.parse.urljoin(MASTER, segs[0])
    print("ilk segment:", seg[:180])
    try:
        st2, ct2, b2 = fetch(seg, limit=4096)
        print(f"segment: {st2} ct={ct2} ilk baytlar={b2[:8].hex()} (0x47 = MPEG-TS)")
    except urllib.error.HTTPError as exc:
        print(f"segment HATA: HTTP {exc.code}")

# Ek: şifreleme var mı
print("\nEXT-X-KEY:", [l for l in lines if "EXT-X-KEY" in l][:2] or "yok")
print("EXT-X-ENDLIST:", "var" if "#EXT-X-ENDLIST" in text else "yok")
