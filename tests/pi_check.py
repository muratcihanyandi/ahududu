"""Raspberry Pi 5 canlı durum kontrolü.

Kullanım:
    python tests/pi_check.py
"""
import os
import sys

import paramiko

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "192.168.2.170"
USER = "murat"
# SSH parolası koda YAZILMAZ (depo herkese açık): AHUDUDU_PI_PASS ortam değişkeni
PASS = os.getenv("AHUDUDU_PI_PASS", "")


def main() -> int:
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(HOST, username=USER, password=PASS, timeout=12)
    except Exception as exc:  # noqa: BLE001
        print(f"[FAIL] SSH bağlantısı kurulamadı: {exc}")
        return 1

    commands = [
        ("container", "docker ps --format '{{.Names}} | {{.Status}} | {{.Image}}'"),
        ("build-id", "docker exec ahududu sh -c 'cat /app/backend/static/build-id.txt' 2>/dev/null || echo '-'"),
        ("version", "curl -s http://127.0.0.1:33470/api/system/version"),
        ("logs", "docker logs --tail 15 ahududu 2>&1"),
    ]
    for name, cmd in commands:
        _, stdout, stderr = ssh.exec_command(cmd)
        out = stdout.read().decode("utf-8", "replace").strip()
        err = stderr.read().decode("utf-8", "replace").strip()
        print(f"\n=== {name} ===")
        print(out or "(boş)")
        if err:
            print("[stderr]", err[:400])

    ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
