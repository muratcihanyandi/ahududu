"""Raspberry Pi 5 üzerinde komut çalıştırmak için küçük yardımcı.

Kullanım:
    python tests/pi_helper.py "docker ps" "ls -la /DATA/AppData/ahududu"

Komutlar varsayılan olarak `sudo -S` ile çalışır (Pi parolası ortam
değişkeninden veya deploy/deploy_pi.py varsayılanından alınır).
"""

import os
import sys

import paramiko

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

PI_HOST = os.getenv("AHUDUDU_PI_HOST", "192.168.2.170")
PI_USER = os.getenv("AHUDUDU_PI_USER", "murat")
PI_PASS = os.getenv("AHUDUDU_PI_PASS", "")   # parola koda yazılmaz


def connect():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(PI_HOST, username=PI_USER, password=PI_PASS, timeout=15)
    return ssh


def run(ssh, command: str, sudo: bool = True, timeout: int = 120) -> tuple[str, str, int]:
    full = f"echo '{PI_PASS}' | sudo -S {command}" if sudo else command
    stdin, stdout, stderr = ssh.exec_command(full, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    status = stdout.channel.recv_exit_status()
    if err:
        err = "\n".join(line for line in err.splitlines() if "Password" not in line)
    return out, err, status


def psql(sql: str, timeout: int = 60) -> str:
    """Canlı veritabanında tek sorgu çalıştırır (tablo/veri denetimi için)."""
    escaped = sql.replace('"', '\\"')
    ssh = connect()
    try:
        out, err, _ = run(
            ssh,
            f'docker exec postgres_db psql -U muratcihanyandi -d ahududu -c "{escaped}"',
            timeout=timeout,
        )
        return out + (("\n[ERR] " + err) if err else "")
    finally:
        ssh.close()


def main(argv):
    if not argv:
        print(__doc__)
        return 1
    ssh = connect()
    try:
        for command in argv:
            out, err, status = run(ssh, command)
            print(f"=== {command}")
            if out.strip():
                print(out.rstrip())
            if err.strip():
                print(f"[stderr] {err.rstrip()[:2000]}")
            print(f"[exit {status}]")
    finally:
        ssh.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
