"""Dağıtım betiklerinin ortak bağlantı bilgileri.

SSH parolası KODA YAZILMAZ: `AHUDUDU_PI_PASS` ortam değişkeninden ya da
`.env` dosyasından okunur. Böylece depo herkese açık olsa da sunucu parolası
sızmaz.

Kullanım:
    export AHUDUDU_PI_PASS=...        # Windows: $env:AHUDUDU_PI_PASS = "..."
    python deploy/deploy_pi.py

`.env` örneği (depo dışında tutulur, `.gitignore` içindedir):
    AHUDUDU_PI_HOST=192.168.2.170
    AHUDUDU_PI_USER=murat
    AHUDUDU_PI_PASS=sifreniz
"""

import os
import sys

DEFAULT_HOST = "192.168.2.170"
DEFAULT_USER = "murat"
DEFAULT_PORT = 33470
DEFAULT_CONTAINER = "ahududu-app"

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _load_dotenv(path: str = os.path.join(_ROOT, ".env")) -> None:
    """`.env` dosyasını (varsa) yükler; ortam değişkenleri her zaman öncelikli."""
    if not os.path.isfile(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and key not in os.environ:
                    os.environ[key] = value
    except OSError:
        pass


class MissingPassword(RuntimeError):
    pass


def pi_host() -> str:
    _load_dotenv()
    return os.getenv("AHUDUDU_PI_HOST", DEFAULT_HOST)


def pi_user() -> str:
    _load_dotenv()
    return os.getenv("AHUDUDU_PI_USER", DEFAULT_USER)


def pi_port() -> int:
    _load_dotenv()
    return int(os.getenv("AHUDUDU_PORT", str(DEFAULT_PORT)))


def container_name() -> str:
    _load_dotenv()
    return os.getenv("AHUDUDU_CONTAINER", DEFAULT_CONTAINER)


def pi_password(required: bool = True) -> str:
    """SSH parolası. Tanımlı değilse açıklayıcı bir hata verir."""
    _load_dotenv()
    password = os.getenv("AHUDUDU_PI_PASS", "")
    if not password and required:
        raise MissingPassword(
            "AHUDUDU_PI_PASS tanımlı değil.\n"
            "Parola artık koda yazılmıyor (depo herkese açık).\n"
            "  PowerShell : $env:AHUDUDU_PI_PASS = \"parolaniz\"\n"
            "  veya        .env dosyasına AHUDUDU_PI_PASS=parolaniz ekleyin"
        )
    return password


def require_password_or_exit() -> str:
    """Parolayı okur; yoksa temiz bir mesajla çıkar (traceback yok)."""
    try:
        return pi_password()
    except MissingPassword as exc:
        print(f"\n[deploy] {exc}\n", file=sys.stderr)
        raise SystemExit(2)


__all__ = [
    "pi_host", "pi_user", "pi_port", "container_name",
    "pi_password", "require_password_or_exit", "MissingPassword",
]
