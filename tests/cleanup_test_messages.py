"""Canlı veritabanından test mesajlarını temizler (Pi üzerinde).

Kullanım:
    python tests/cleanup_test_messages.py --dry-run
    python tests/cleanup_test_messages.py
"""

import argparse
import os
import sys

import paramiko

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

HOST = "192.168.2.170"
USER = "murat"
# SSH parolası koda YAZILMAZ (depo herkese açık): AHUDUDU_PI_PASS ortam değişkeni
PASS = os.getenv("AHUDUDU_PI_PASS", "")
CONTAINER = "ahududu-app"

PATTERNS = [
    "Bildirim testi%",
    "BASELINE-TEST%",
    "Telefondan bak:%",
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    select_sql = "SELECT id, sender, content FROM chat_messages WHERE " + " OR ".join(
        f"content LIKE '{p}'" for p in PATTERNS
    ) + " ORDER BY id;"

    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, username=USER, password=PASS, timeout=15)
    try:
        def run(cmd, timeout=120):
            _, out, err = ssh.exec_command(cmd, timeout=timeout)
            status = out.channel.recv_exit_status()
            return status, out.read().decode("utf-8", "replace"), err.read().decode("utf-8", "replace")

        quoted = select_sql.replace("'", "'\"'\"'")
        status, text, err = run(
            f"echo '{PASS}' | sudo -S docker exec postgres_db psql -U muratcihanyandi -d ahududu -t -A -F ' | ' -c \"{select_sql}\""
        )
        if status != 0:
            print("[ERR]", err[:500])
            return 1
        rows = [r for r in text.strip().splitlines() if r.strip()]
        print(f"Bulunan test mesajı: {len(rows)}")
        for row in rows:
            print("  ", row)

        if args.dry_run or not rows:
            return 0

        delete_sql = "DELETE FROM chat_messages WHERE " + " OR ".join(
            f"content LIKE '{p}'" for p in PATTERNS
        ) + ";"
        status, text, err = run(
            f"echo '{PASS}' | sudo -S docker exec postgres_db psql -U muratcihanyandi -d ahududu -c \"{delete_sql}\""
        )
        if status != 0:
            print("[ERR]", err[:500])
            return 1
        print("Silme sonucu:", text.strip())
    finally:
        ssh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
