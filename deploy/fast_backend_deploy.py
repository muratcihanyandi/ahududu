"""Hızlı backend dağıtımı: imajı yeniden derlemeden kodu konteynere kopyalar.

Yalnızca Python kaynağı değiştiyse (bağımlılık eklenmediyse) kullanışlıdır.
Docker imajı zaten `backend/app` klasörünü kopyalıyor; biz de aynı dosyaları
canlı konteynerin içine kopyalayıp süreci yeniden başlatıyoruz.

Kullanım:
    python deploy/fast_backend_deploy.py
    python deploy/fast_backend_deploy.py --no-restart
"""

import argparse
import os
import sys
import tarfile
import tempfile
import time
import urllib.request

import paramiko

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import config  # noqa: E402  (deploy/config.py: parola koda yazılmaz)

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PI_HOST = config.pi_host()
PI_USER = config.pi_user()
PI_PASS = ""  # main() içinde config.require_password_or_exit() ile doldurulur
PORT = config.pi_port()
CONTAINER = config.container_name()

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_DIR = os.path.join(ROOT, "backend", "app")


def make_tarball() -> str:
    path = os.path.join(tempfile.gettempdir(), "ahududu_backend.tar.gz")
    if os.path.exists(path):
        os.remove(path)
    with tarfile.open(path, "w:gz") as tar:
        tar.add(APP_DIR, arcname="app")
    print(f"Tarball: {path} ({os.path.getsize(path) / 1024:.0f} KB)")
    return path


def run(ssh, cmd: str, sudo: bool = False, timeout: int = 300) -> tuple[int, str, str]:
    if sudo:
        cmd = f"echo '{PI_PASS}' | sudo -S {cmd}"
    print(f">>> {cmd}")
    _, out, err = ssh.exec_command(cmd, timeout=timeout)
    status = out.channel.recv_exit_status()
    text = out.read().decode("utf-8", "replace").strip()
    err_text = err.read().decode("utf-8", "replace").strip()
    if text:
        print(text[:1500])
    if err_text and "Password:" not in err_text:
        print("[stderr]", err_text[:500])
    return status, text, err_text


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-restart", action="store_true")
    args = parser.parse_args()

    tar_path = make_tarball()
    global PI_PASS
    PI_PASS = config.require_password_or_exit()   # parola yalnızca ortamdan / .env'den
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(PI_HOST, username=PI_USER, password=PI_PASS, timeout=15)
    try:
        remote = "/tmp/ahududu_backend.tar.gz"
        tmp_dir = "/tmp/ahududu_backend_src"
        sftp = ssh.open_sftp()
        sftp.put(tar_path, remote)
        sftp.close()

        status, _, _ = run(ssh, f"rm -rf {tmp_dir} && mkdir -p {tmp_dir} && tar -xzf {remote} -C {tmp_dir}")
        if status != 0:
            print("[FAIL] açma başarısız")
            return 1

        status, _, _ = run(
            ssh,
            f"docker cp {tmp_dir}/app/. {CONTAINER}:/app/backend/app",
            sudo=True,
        )
        if status != 0:
            print("[FAIL] kopyalama başarısız")
            return 1

        run(ssh, f"rm -rf {tmp_dir} {remote}")

        if not args.no_restart:
            run(ssh, f"docker restart {CONTAINER}", sudo=True, timeout=180)
            print("[..] konteyner yeniden başladı, sağlık bekleniyor…")
            for attempt in range(1, 31):
                try:
                    req = urllib.request.Request(
                        f"http://{PI_HOST}:{PORT}/api/system/version",
                        headers={"User-Agent": "AhududuDeployer"},
                    )
                    with urllib.request.urlopen(req, timeout=5) as res:
                        if res.status == 200:
                            print(f"[OK] sunucu ayakta ({attempt}. deneme)")
                            break
                except Exception:  # noqa: BLE001
                    pass
                time.sleep(2)
            else:
                print("[FAIL] sunucu sağlıklı yanıt vermedi")
                return 1

        # Sohbet uçlarını doğrula
        try:
            req = urllib.request.Request(
                f"http://{PI_HOST}:{PORT}/api/chat/count",
                headers={"User-Agent": "AhududuDeployer"},
            )
            with urllib.request.urlopen(req, timeout=10) as res:
                print("[OK] /api/chat/count:", res.read().decode())
        except Exception as exc:  # noqa: BLE001
            print("[FAIL] /api/chat/count:", exc)
            return 1
    finally:
        ssh.close()

    print("\nHIZLI BACKEND DAĞITIMI TAMAMLANDI.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
