"""Ahududu oyun sayfaları: derlenmiş paket ile kaynak ayrışmasın diye temel kontroller.

`index.html` oyunun kaynak `.js` dosyalarından üretilir (source/build.mjs). Bir
kaynak değişip paket yenilenmezse canlıda ESKİ oyun çalışır. Bu test:

  1. paketin kaynaktan üretilmiş hâliyle birebir aynı olduğunu,
  2. paket içindeki betiğin sözdiziminin geçerli olduğunu,
  3. kaynak dosyalarda UTF-8 BOM bulunmadığını (BOM pakette sözdizimi
     hatasına yol açıp oyunu hiç açılmaz hâle getiriyordu),
  4. frontend/public ve backend/static kopyalarının aynı olduğunu

doğrular.

Kullanım:  python tests/test_game_bundle.py
"""

import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "frontend" / "public" / "games" / "uno-com-escada"
MIRROR = ROOT / "backend" / "static" / "games" / "uno-com-escada"


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    ok = True

    def check(name: str, value: bool) -> None:
        nonlocal ok
        print(("PASS  " if value else "FAIL  ") + name)
        ok = ok and bool(value)

    # 1) paket, kaynaktan birebir üretilebiliyor mu?
    node = shutil.which("node")
    if not node:
        print("FAIL  node bulunamadı (paket doğrulaması yapılamaz)")
        return 1
    tmp = Path(tempfile.gettempdir()) / "uno_bundle_check.html"
    res = subprocess.run(
        [node, str(GAME / "source" / "build.mjs"), "--out", str(tmp)],
        capture_output=True, text=True,
    )
    check("oyun paketi üretilebildi (node source/build.mjs)", res.returncode == 0)
    if res.returncode != 0:
        print(res.stderr[-2000:])
        return 1
    check("index.html kaynakla birebir aynı (yeniden üretilmiş)",
          sha(tmp) == sha(GAME / "index.html"))

    # 2) paketteki betiğin sözdizimi
    html = (GAME / "index.html").read_text(encoding="utf-8")
    start = html.find("<script>")
    end = html.rfind("</script>")
    check("pakette tek <script> bloğu var", start >= 0 and end > start)
    if start >= 0 and end > start:
        js_path = Path(tempfile.gettempdir()) / "uno_bundle_check.js"
        js_path.write_text(html[start + len("<script>"):end], encoding="utf-8")
        chk = subprocess.run([node, "--check", str(js_path)], capture_output=True, text=True)
        check("paket betiği sözdizimi geçerli (node --check)", chk.returncode == 0)
        if chk.returncode != 0:
            print(chk.stderr[-1500:])

    # 3) kaynaklarda BOM yok
    bom_files = [
        p.name for p in sorted((GAME / "source" / "js").glob("*.js"))
        if p.read_bytes().startswith(b"\xef\xbb\xbf")
    ]
    check("kaynak dosyalarda UTF-8 BOM yok" + (" (%s)" % ", ".join(bom_files) if bom_files else ""),
          not bom_files)

    # 4) backend/static kopyası aynı
    if (MIRROR / "index.html").is_file():
        check("backend/static kopyası frontend ile aynı",
              sha(MIRROR / "index.html") == sha(GAME / "index.html"))
    else:
        check("backend/static kopyası var", False)

    print("\nOYUN PAKETİ TESTİ " + ("TAMAM" if ok else "BAŞARISIZ"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
