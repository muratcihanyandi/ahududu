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


def connect_ssh():
    """Pi'ye bağlanır: önce SSH anahtarı, olmazsa parola.

    Anahtar varsa parola hiç istenmez; bu, parolanın koda yazılmadığı yeni
    düzende tercih edilen yoldur.
    """
    import paramiko  # yerel içe aktarma: config'i hafif tutar

    host, user = pi_host(), pi_user()
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.load_system_host_keys()

    password = pi_password(required=False)
    key_paths = [
        os.getenv("AHUDUDU_PI_KEY", ""),
        os.path.expanduser("~/.ssh/id_ed25519"),
        os.path.expanduser("~/.ssh/id_rsa"),
    ]
    key_paths = [p for p in key_paths if p and os.path.isfile(p)]

    last_err = None
    # 1) anahtar varsa önce onu dene (parola gerekmez)
    for kp in key_paths:
        try:
            ssh.connect(host, username=user, key_filename=kp, timeout=15,
                        allow_agent=True, look_for_keys=True)
            return ssh, False          # (bağlantı, parola_kullanıldı_mı)
        except Exception as exc:  # noqa: BLE001
            last_err = exc

    # 2) parola
    if password:
        try:
            ssh.connect(host, username=user, password=password, timeout=15)
            return ssh, True
        except Exception as exc:  # noqa: BLE001
            last_err = exc

    raise ConnectionError(
        "Pi'ye bağlanılamadı. SSH anahtarı (~/.ssh/id_ed25519) yok/geçersiz ve "
        "AHUDUDU_PI_PASS tanımlı değil.\nSon hata: %s" % last_err
    )


__all__ = [
    "pi_host", "pi_user", "pi_port", "container_name",
    "pi_password", "require_password_or_exit", "connect_ssh", "MissingPassword",
]
