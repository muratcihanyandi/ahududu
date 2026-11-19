"""Kural: oyun kaynağı değiştiyse derlenmiş `index.html` HER ZAMAN yeniden üretilir.

Sahne kaynakları (`source/js/*.js`) `index.html` içine gömülür. Bir kaynak
değişip paket yenilenmezse canlıda ESKİ oyun çalışır (bir kez tam bu yaşandı:
47_perf.js'in BOM'u paketi bozuyordu ve paket hiç yenilenmemişti). Bu test
paketin kaynakla birebir aynı olduğunu doğrular; `test_game_bundle.py` aynı
kuralı kaynak/paket özetleriyle denetler.

Kullanım: python tests/check_game_sources.py        # kontrol
          python tests/check_game_sources.py --fix  # yeniden üret
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GAME = ROOT / "frontend" / "public" / "games" / "uno-com-escada"


def rebuild() -> None:
    subprocess.run(
        ["node", str(GAME / "source" / "build.mjs"), "--out", str(GAME / "index.html")],
        check=True,
        cwd=str(ROOT),
    )


def main() -> int:
    fix = "--fix" in sys.argv
    if fix:
        rebuild()
        print("paket yeniden üretildi:", GAME / "index.html")
        return 0
    res = subprocess.run([sys.executable, str(ROOT / "tests" / "test_game_bundle.py")], cwd=str(ROOT))
    return res.returncode


if __name__ == "__main__":
    sys.exit(main())
