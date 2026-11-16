"""Canlı sunucu bakımı: mektup yedeklerini listele, takılı "Sinemada" durumunu temizle."""

import sys

sys.path.insert(0, "tests")
from pi_helper import connect, psql, run  # noqa: E402

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def main():
    ssh = connect()
    try:
        out, err, status = run(
            ssh, "ls -la /DATA/AppData/ahududu/uploads/letters_backup", timeout=90
        )
        print("=== mektup yedekleri")
        print((out + err).strip())
        print(f"[exit {status}]")
    finally:
        ssh.close()

    print("=== takılı sinema durumu (önce)")
    print(psql("select id, status_text from user_profiles order by id").rstrip())

    print("=== temizlik")
    print(
        psql(
            "update user_profiles set status_text = '' "
            "where status_text like 'Sinemada%' returning id, status_text"
        ).rstrip()
    )

    print("=== sonra")
    print(psql("select id, status_text from user_profiles order by id").rstrip())


if __name__ == "__main__":
    main()
