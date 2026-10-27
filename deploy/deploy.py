#!/usr/bin/env python3
"""Ahududu dağıtım aracı — Raspberry Pi 5 (CasaOS) üzerinde çalışır.

Kullanım:
  python deploy/deploy.py provision   # ilk kurulum: DB + rol + .env + dizinler (idempotent)
  python deploy/deploy.py deploy      # kaynak aktar + imaj derle + başlat + sağlık kontrolü
  python deploy/deploy.py logs        # konteyner loglarını göster
  python deploy/deploy.py restart     # konteyneri yeniden başlat

Gerekli ortam değişkenleri:
  AHUDUDU_SSH_PASSWORD  Pi SSH parolası (depoya yazılmaz)
İsteğe bağlı:
  AHUDUDU_SSH_HOST (varsayılan 192.168.2.170), AHUDUDU_SSH_USER (varsayılan murat)
"""
import argparse
import io
import os
import secrets
import stat
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

import paramiko

REPO_ROOT = Path(__file__).resolve().parent.parent
SERVER_DIR = REPO_ROOT / "server"
PI_APP_DIR = "/DATA/AppData/ahududu"
PI_SERVER_DIR = f"{PI_APP_DIR}/server"
PI_MEDIA_DIR = f"{PI_APP_DIR}/media"
DB_HOST = "192.168.2.170"
DB_PORT = 5432
DB_ADMIN_CONTAINER = "postgres_db"
DB_ADMIN_USER = "muratcihanyandi"
APP_DB = "ahududu"
TEST_DB = "ahududu_test"
APP_ROLE = "ahududu_app"

EXCLUDE_DIRS = {"node_modules", ".git", "media", "dist", "coverage"}


def ssh_connect() -> paramiko.SSHClient:
    host = os.environ.get("AHUDUDU_SSH_HOST", "192.168.2.170")
    user = os.environ.get("AHUDUDU_SSH_USER", "murat")
    password = os.environ.get("AHUDUDU_SSH_PASSWORD")
    if not password:
        print("HATA: AHUDUDU_SSH_PASSWORD ortam değişkeni tanımlı değil.")
        sys.exit(1)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, 22, user, password, timeout=15)
    return client


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120, check: bool = True) -> tuple[int, str]:
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    text = (out + err).strip()
    if check and code != 0:
        print(f"KOMUT BAŞARISIZ (kod {code}): {cmd}\n{text[:2000]}")
        sys.exit(1)
    return code, text


def db_exec(client: paramiko.SSHClient, sql: str) -> str:
    cmd = f'docker exec {DB_ADMIN_CONTAINER} psql -U {DB_ADMIN_USER} -d postgres -v ON_ERROR_STOP=1 -c "{sql}"'
    return run(client, cmd, timeout=60)[1]


def provision(client: paramiko.SSHClient) -> None:
    print("== 1/4 Dizinler ==")
    run(client, f"mkdir -p {PI_SERVER_DIR} {PI_MEDIA_DIR}")
    run(client, f"sudo chown -R murat:murat {PI_APP_DIR} 2>/dev/null || true")

    print("== 2/4 Veritabanı rolü ve veritabanları ==")
    # Rol (idempotent)
    db_exec(
        client,
        f"SELECT 1 FROM pg_roles WHERE rolname='{APP_ROLE}'",
    )
    code, _ = run(
        client,
        f"docker exec {DB_ADMIN_CONTAINER} psql -U {DB_ADMIN_USER} -d postgres -tAc \"SELECT 1 FROM pg_roles WHERE rolname='{APP_ROLE}'\"",
        check=False,
    )
    env_path = f"{PI_SERVER_DIR}/.env"
    code_env, env_content = run(client, f"cat {env_path}", check=False)
    has_env = code_env == 0 and "DATABASE_URL" in env_content

    if "1" in _:
        print(f"Rol zaten var: {APP_ROLE}")
        if not has_env:
            print("HATA: Rol var ama .env yok — parola bilinmiyor. Rolü elle sıfırlaman gerekir.")
            sys.exit(1)
        db_password = [l for l in env_content.splitlines() if l.startswith("DATABASE_URL=")][0]
        db_password = db_password.split(":", 2)[2].split("@")[0]
    else:
        db_password = secrets.token_urlsafe(24)
        db_exec(
            client,
            f"CREATE ROLE {APP_ROLE} LOGIN PASSWORD '{db_password}'",
        )
        print(f"Rol oluşturuldu: {APP_ROLE}")

    # Veritabanları (idempotent)
    for db in (APP_DB, TEST_DB):
        out = db_exec(client, f"SELECT 1 FROM pg_database WHERE datname='{db}'")
        if "1" in out and "(1 row)" in out:
            print(f"Veritabanı zaten var: {db}")
        else:
            db_exec(client, f"CREATE DATABASE {db} OWNER {APP_ROLE}")
            print(f"Veritabanı oluşturuldu: {db} (sahip: {APP_ROLE})")

    print("== 3/4 Pi .env ==")
    if has_env:
        print(".env zaten var — korunuyor.")
    else:
        env_text = (
            f"DATABASE_URL=postgresql://{APP_ROLE}:{db_password}@{DB_HOST}:{DB_PORT}/{APP_DB}\n"
            f"PORT=8787\n"
            f"MEDIA_DIR=/app/media\n"
            f"MEDIA_HOST_DIR={PI_MEDIA_DIR}\n"
            f"TOKEN_TTL_DAYS=180\n"
            f"INVITE_TTL_DAYS=7\n"
            f"NODE_ENV=production\n"
        )
        sftp = client.open_sftp()
        with sftp.file(env_path, "w") as f:
            f.write(env_text)
        sftp.chmod(env_path, stat.S_IRUSR | stat.S_IWUSR)
        sftp.close()
        print(".env yazıldı (mode 600).")

    print("== 4/4 Yerel geliştirme .env'i ==")
    local_env = SERVER_DIR / ".env"
    db_url = f"postgresql://{APP_ROLE}:{db_password}@{DB_HOST}:{DB_PORT}/{APP_DB}"
    test_url = f"postgresql://{APP_ROLE}:{db_password}@{DB_HOST}:{DB_PORT}/{TEST_DB}"
    if local_env.exists():
        print(f"{local_env} zaten var — üzerine yazılmadı.")
        print(f"Gerekirse elle güncelle:\n  DATABASE_URL={db_url}\n  TEST_DATABASE_URL={test_url}")
    else:
        local_env.write_text(
            f"DATABASE_URL={db_url}\nTEST_DATABASE_URL={test_url}\nPORT=8788\n"
            f"MEDIA_DIR=./media\nTOKEN_TTL_DAYS=180\nINVITE_TTL_DAYS=7\nNODE_ENV=development\n",
            encoding="utf-8",
        )
        print(f"Yerel .env yazıldı: {local_env} (TEST_DATABASE_URL dahil)")
    print("\nPROVISION TAMAM.")


def make_tarball() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path in sorted(SERVER_DIR.rglob("*")):
            if any(part in EXCLUDE_DIRS for part in path.parts):
                continue
            if path.name == ".env" or path.name.endswith(".log"):
                continue
            tar.add(path, arcname=str(path.relative_to(SERVER_DIR)))
    return buf.getvalue()


def deploy(client: paramiko.SSHClient) -> None:
    print("== 1/4 Kaynak paketleme ve aktarım ==")
    data = make_tarball()
    print(f"Paket boyutu: {len(data) / 1024:.0f} KB")
    sftp = client.open_sftp()
    remote_tar = "/tmp/ahududu_deploy.tar.gz"
    with sftp.file(remote_tar, "w") as f:
        f.write(data)
    sftp.close()
    run(client, f"mkdir -p {PI_SERVER_DIR}")
    run(client, f"tar -xzf {remote_tar} -C {PI_SERVER_DIR} && rm {remote_tar}")
    # .env yoksa provision gerek
    code, _ = run(client, f"test -f {PI_SERVER_DIR}/.env", check=False)
    if code != 0:
        print("Pi'de .env yok — önce 'provision' çalıştır.")
        sys.exit(1)
    run(client, f"cp {PI_SERVER_DIR}/package.json {PI_SERVER_DIR}/package.json.check 2>/dev/null; true")

    print("== 2/4 Docker imaj derlemesi (Pi üzerinde) ==")
    code, out = run(
        client,
        f"cd {PI_SERVER_DIR} && docker compose build --pull 2>&1 | tail -12",
        timeout=1200,
    )
    print(out)

    print("== 3/4 Konteyner başlatma ==")
    code, out = run(client, f"cd {PI_SERVER_DIR} && docker compose up -d 2>&1", timeout=180)
    print(out)

    print("== 4/4 Sağlık kontrolü ==")
    health_ok = False
    for attempt in range(15):
        time.sleep(2)
        try:
            with urllib.request.urlopen(f"http://{DB_HOST}:8787/health", timeout=3) as resp:
                body = resp.read().decode()
                if resp.status == 200 and '"db":"up"' in body:
                    print(f"HEALTH OK ({resp.status}): {body}")
                    health_ok = True
                    break
                print(f"Sağlık yanıtı beklenmedik: {resp.status} {body}")
        except Exception as e:  # noqa: BLE001
            print(f"Deneme {attempt + 1}/15: {e}")
    if not health_ok:
        print("SAĞLIK KONTROLÜ BAŞARISIZ — loglar:")
        run(client, f"cd {PI_SERVER_DIR} && docker compose logs --tail 50 ahududu-server", check=False)
        sys.exit(1)
    print("\nDAĞITIM TAMAM.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Ahududu dağıtım aracı")
    parser.add_argument("command", choices=["provision", "deploy", "logs", "restart"])
    args = parser.parse_args()
    client = ssh_connect()
    try:
        if args.command == "provision":
            provision(client)
        elif args.command == "deploy":
            deploy(client)
        elif args.command == "logs":
            run(client, f"cd {PI_SERVER_DIR} && docker compose logs --tail 100 ahududu-server", check=False)
        elif args.command == "restart":
            run(client, f"cd {PI_SERVER_DIR} && docker compose restart")
            print("Konteyner yeniden başlatıldı.")
    finally:
        client.close()


if __name__ == "__main__":
    main()
