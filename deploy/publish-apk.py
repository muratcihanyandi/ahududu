#!/usr/bin/env python3
"""APK yayınlama aracı — derlenmiş APK'yı Raspberry Pi'ye yükler ve sürüm kaydı oluşturur.

Kullanım:
  python deploy/publish-apk.py phone            # app-debug.apk / app-release.apk
  python deploy/publish-apk.py wear             # wear-debug.apk / wear-release.apk
  python deploy/publish-apk.py phone --apk yol/app.apk --changelog "Yeni: konum"
  python deploy/publish-apk.py phone --list     # sunucudaki yayınları listele

Gerekli ortam değişkenleri:
  AHUDUDU_SSH_PASSWORD  Pi SSH parolası (depoya yazılmaz)

APK'nın versionCode/versionName değerleri AndroidManifest'ten (aapt) okunur;
elle girilmez. Aynı versionCode tekrar yayınlanırsa kayıt güncellenir.
"""
import argparse
import hashlib
import os
import subprocess
import sys
from pathlib import Path

import paramiko

REPO_ROOT = Path(__file__).resolve().parent.parent
PI_APP_DIR = "/DATA/AppData/ahududu"
PI_RELEASES_DIR = f"{PI_APP_DIR}/releases"
DB_ADMIN_CONTAINER = "postgres_db"
APP_DB = "ahududu"

DEFAULT_APKS = {
    "phone": [
        REPO_ROOT / "android/app/build/outputs/apk/release/app-release.apk",
        REPO_ROOT / "android/app/build/outputs/apk/debug/app-debug.apk",
    ],
    "wear": [
        REPO_ROOT / "android/wear/build/outputs/apk/release/wear-release.apk",
        REPO_ROOT / "android/wear/build/outputs/apk/debug/wear-debug.apk",
    ],
}


def ssh_connect() -> paramiko.SSHClient:
    host = os.environ.get("AHUDUDU_SSH_HOST", "192.168.2.170")
    user = os.environ.get("AHUDUDU_SSH_USER", "murat")
    password = os.environ.get("AHUDUDU_SSH_PASSWORD")
    if not password:
        print("HATA: AHUDUDU_SSH_PASSWORD ortam değişkeni tanımlı değil.")
        sys.exit(1)
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, 22, user, password, timeout=20)
    return client


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 120, check: bool = True) -> tuple[int, str]:
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", "replace") + stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if check and code != 0:
        raise RuntimeError(f"Komut başarısız ({code}): {cmd}\n{out}")
    return code, out


def sql_quote(value: str) -> str:
    return value.replace("'", "''")


def db_exec(client: paramiko.SSHClient, sql: str) -> str:
    # SQL tek satır olarak geçirilir; içinde tek tırnak kaçırılmış olmalı.
    cmd = f"docker exec {DB_ADMIN_CONTAINER} psql -U muratcihanyandi -d {APP_DB} -tAc \"{sql}\""
    _, out = run(client, cmd)
    return out.strip()


def read_apk_identity(apk: Path, sdk_root: Path) -> tuple[int, str]:
    """aapt2 ile versionCode/versionName okur (elle girilmez, gerçek APK'dan gelir)."""
    build_tools = sdk_root / "build-tools"
    candidates = sorted(build_tools.glob("*/aapt2.exe")) + sorted(build_tools.glob("*/aapt2"))
    if not candidates:
        raise RuntimeError("aapt2 bulunamadı. Android SDK build-tools kurulu mu?")
    aapt2 = candidates[-1]
    result = subprocess.run(
        [str(aapt2), "dump", "badging", str(apk)],
        capture_output=True, text=True, errors="replace",
    )
    if result.returncode != 0:
        raise RuntimeError(f"APK okunamadı: {result.stderr[:300]}")
    version_code = None
    version_name = None
    for line in result.stdout.splitlines():
        if line.startswith("package:"):
            for part in line.split():
                if part.startswith("versionCode="):
                    version_code = int(part.split("=", 1)[1].strip("'"))
                if part.startswith("versionName="):
                    version_name = part.split("=", 1)[1].strip("'")
    if version_code is None or version_name is None:
        raise RuntimeError("APK içinde versionCode/versionName bulunamadı.")
    return version_code, version_name


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pick_apk(platform: str, explicit: str | None) -> Path:
    if explicit:
        path = Path(explicit).resolve()
        if not path.exists():
            print(f"HATA: APK bulunamadı: {path}")
            sys.exit(1)
        return path
    for candidate in DEFAULT_APKS[platform]:
        if candidate.exists():
            return candidate
    print("HATA: Derlenmiş APK bulunamadı. Önce derle:")
    print("  cd android && ./gradlew :app:assembleDebug" if platform == "phone"
          else "  cd android && ./gradlew :wear:assembleDebug")
    sys.exit(1)


def publish(platform: str, apk: Path, changelog: str) -> None:
    sdk_root = Path(os.environ.get("ANDROID_HOME") or
                    (Path(os.environ.get("LOCALAPPDATA", "")) / "Android/Sdk"))
    version_code, version_name = read_apk_identity(apk, sdk_root)
    digest = sha256_file(apk)
    size = apk.stat().st_size
    remote_name = f"ahududu-{platform}-{version_code}.apk"

    print(f"APK: {apk}")
    print(f"Sürüm: {version_name} (code {version_code}) · {size / 1048576:.1f} MB")
    print(f"sha256: {digest}")

    client = ssh_connect()
    try:
        run(client, f"mkdir -p {PI_RELEASES_DIR}")
        print("== 1/3 Dosya aktarımı ==")
        sftp = client.open_sftp()
        try:
            sftp.put(str(apk), f"{PI_RELEASES_DIR}/{remote_name}")
        finally:
            sftp.close()
        remote_size = run(client, f"stat -c %s {PI_RELEASES_DIR}/{remote_name}")[1].strip()
        if remote_size != str(size):
            raise RuntimeError(f"Aktarım doğrulanamadı (uzak boyut {remote_size}, beklenen {size}).")

        print("== 2/3 Sürüm kaydı ==")
        # Aynı versionCode varsa güncelle: checksum ve meta aynı satırda kalsın.
        db_exec(
            client,
            "DELETE FROM app_releases WHERE platform = '{}' AND version_code = {};".format(
                platform, version_code
            ),
        )
        insert = (
            "INSERT INTO app_releases "
            "(id, platform, version_code, version_name, changelog, file_path, file_size, sha256) "
            "VALUES (gen_random_uuid(), '{platform}', {code}, '{name}', '{log}', '{file}', {size}, '{sha}');"
        ).format(
            platform=platform,
            code=version_code,
            name=sql_quote(version_name),
            log=sql_quote(changelog[:1000]),
            file=sql_quote(remote_name),
            size=size,
            sha=digest,
        )
        db_exec(client, insert)

        print("== 3/3 Doğrulama ==")
        row = db_exec(
            client,
            "SELECT platform, version_code, version_name, file_size, left(sha256, 12) "
            "FROM app_releases WHERE platform = '{}' ORDER BY version_code DESC LIMIT 1;".format(platform),
        )
        print(f"Sunucudaki en yeni kayıt: {row}")
        print("\nYAYIN TAMAM. Uygulamadaki 'Ayarlar -> Guncelleme' karti bu surumu gorecek.")
    finally:
        client.close()


def list_releases() -> None:
    client = ssh_connect()
    try:
        out = db_exec(
            client,
            "SELECT platform, version_code, version_name, round(file_size/1048576.0, 1) AS mb, "
            "created_at FROM app_releases ORDER BY platform, version_code DESC;",
        )
        print(out or "(kayıt yok)")
    finally:
        client.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Ahududu APK yayınlama")
    parser.add_argument("platform", choices=["phone", "wear"])
    parser.add_argument("--apk", help="Yayınlanacak APK yolu (varsayılan: derleme çıktısı)")
    parser.add_argument("--changelog", default="", help="Sürüm notu (uygulamada gösterilir)")
    parser.add_argument("--list", action="store_true", help="Yalnızca mevcut yayınları listele")
    args = parser.parse_args()

    if args.list:
        list_releases()
        return
    publish(args.platform, pick_apk(args.platform, args.apk), args.changelog)


if __name__ == "__main__":
    main()
