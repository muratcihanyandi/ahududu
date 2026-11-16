"""Hızlı statik dağıtım (yalnızca frontend değiştiyse).

Docker imajı yeniden derlenmeden, derlenmiş `backend/static` içeriğini canlı
konteynerin içine kopyalar. Backend kodu değişmediyse bu yol saniyeler sürer ve
telefonlar yeni arayüzü anında alır. Native/kod değişikliği varsa tam dağıtım
için `python deploy/deploy_pi.py` kullanılmalı.

Kullanım:
    python deploy/fast_deploy.py          # derle + kopyala + doğrula
    python deploy/fast_deploy.py --skip-build
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

import paramiko

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PI_HOST = os.getenv("AHUDUDU_PI_HOST", "192.168.2.170")
PI_USER = os.getenv("AHUDUDU_PI_USER", "murat")
PI_PASS = os.getenv("AHUDUDU_PI_PASS", "3366")
PORT = int(os.getenv("AHUDUDU_PORT", "33470"))
CONTAINER = os.getenv("AHUDUDU_CONTAINER", "ahududu-app")

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(ROOT_DIR, "frontend")
FRONTEND_DIST = os.path.join(FRONTEND_DIR, "dist")
STATIC_DIR = os.path.join(ROOT_DIR, "backend", "static")
BUILD_ID_FILE = "build-id.txt"


def step(message: str) -> None:
    print(f"\n=== {message} ===")


def build_frontend() -> None:
    step("Frontend derleniyor")
    npm = shutil.which("npm") or "npm.cmd"
    subprocess.run([npm, "run", "build"], cwd=FRONTEND_DIR, check=True, shell=(os.name == "nt"))
    if not os.path.isfile(os.path.join(FRONTEND_DIST, "index.html")):
        raise RuntimeError("Frontend derlemesi index.html üretmedi.")


def sync_static() -> str:
    step("backend/static senkronize ediliyor")
    assets_dir = os.path.join(STATIC_DIR, "assets")
    if os.path.isdir(assets_dir):
        shutil.rmtree(assets_dir)
    os.makedirs(STATIC_DIR, exist_ok=True)
    for name in os.listdir(FRONTEND_DIST):
        src = os.path.join(FRONTEND_DIST, name)
        dst = os.path.join(STATIC_DIR, name)
        if os.path.isdir(src):
            if os.path.isdir(dst):
                shutil.rmtree(dst)
            shutil.copytree(src, dst)
        else:
            shutil.copy(src, dst)

    now = time.time()
    os.utime(os.path.join(STATIC_DIR, "index.html"), (now, now))
    build_id = str(int(now))
    with open(os.path.join(STATIC_DIR, BUILD_ID_FILE), "w", encoding="utf-8") as f:
        f.write(build_id + "\n")
    print(f"build_id={build_id}")
    return build_id


def make_tarball() -> str:
    path = os.path.join(tempfile.gettempdir(), "ahududu_static.tar.gz")
    if os.path.exists(path):
        os.remove(path)
    with tarfile.open(path, "w:gz") as tar:
        for name in os.listdir(STATIC_DIR):
            tar.add(os.path.join(STATIC_DIR, name), arcname=name)
    print(f"Tarball: {path} ({os.path.getsize(path) / 1024:.0f} KB)")
    return path


def deploy(build_id: str) -> None:
    step(f"Statik dosyalar canlı konteynere kopyalanıyor ({PI_HOST})")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(PI_HOST, username=PI_USER, password=PI_PASS, timeout=15)

    try:
        tar_path = make_tarball()
        remote_tar = "/tmp/ahududu_static.tar.gz"
        sftp = ssh.open_sftp()
        sftp.put(tar_path, remote_tar)
        sftp.close()

        commands = [
            f"mktemp -d /tmp/ahududu_static.XXXX",
        ]
        _, stdout, _ = ssh.exec_command(commands[0])
        tmp_dir = stdout.read().decode().strip()
        print(f"Geçici dizin: {tmp_dir}")

        cmds = [
            f"tar -xzf {remote_tar} -C {tmp_dir}",
            f"echo '{PI_PASS}' | sudo -S docker cp {tmp_dir}/. {CONTAINER}:/app/backend/static",
            f"echo '{PI_PASS}' | sudo -S docker exec -u root {CONTAINER} chown -R root:root /app/backend/static",
            f"rm -rf {tmp_dir} {remote_tar}",
        ]
        for cmd in cmds:
            stdin, out, err = ssh.exec_command(cmd, timeout=180)
            status = out.channel.recv_exit_status()
            text = out.read().decode("utf-8", "replace").strip()
            err_text = err.read().decode("utf-8", "replace").strip()
            if text:
                print(text[:500])
            if status != 0:
                print(f"[ERR] {cmd} -> {status}: {err_text[:400]}")
                raise RuntimeError(cmd)
    finally:
        ssh.close()

    step("Canlı sürüm doğrulanıyor")
    url = f"http://{PI_HOST}:{PORT}/api/system/version"
    for attempt in range(1, 21):
        try:
            with urllib.request.urlopen(url, timeout=5) as response:
                data = json.loads(response.read().decode("utf-8"))
            live_id = str(data.get("build_id", ""))
            if live_id == build_id:
                print(f"Build ID eşleşti: {live_id}")
                return
            print(f"[{attempt}/20] canlı={live_id} beklenen={build_id}")
        except Exception as exc:  # noqa: BLE001
            print(f"[{attempt}/20] sunucu yanıtı yok: {exc}")
        time.sleep(2)
    raise RuntimeError("Doğrulama başarısız: build_id eşleşmedi")


def main() -> int:
    parser = argparse.ArgumentParser(description="Ahududu hızlı statik dağıtım")
    parser.add_argument("--skip-build", action="store_true", help="Frontend derlemesini atla")
    args = parser.parse_args()

    if not args.skip_build:
        build_frontend()
    build_id = sync_static()
    deploy(build_id)
    print("\nHIZLI DAĞITIM TAMAMLANDI.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
