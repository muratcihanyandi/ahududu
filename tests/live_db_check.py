"""Canlı veritabanı denetimi: mektuplar, sohbet, sinema ve kullanıcı durumları.

Kullanım:
    python tests/live_db_check.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pi_helper import connect, run, psql  # noqa: E402

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

QUERIES = [
    ("love_letters", "select id, sender, title, is_opened, created_at from love_letters order by id"),
    ("chat_messages (son 8)", "select id, sender, message_type, left(content,40) content, media_url, created_at from chat_messages order by id desc limit 8"),
    ("cinema_rooms", "select id,title,source,kind,is_active,is_playing,position,duration,updated_by,updated_at from cinema_rooms order by id"),
    ("cinema_showtimes", "select id,title,show_date,show_time,booked_by,room_id from cinema_showtimes order by id"),
    ("user_profiles", "select id, display_name, status_text, last_seen from user_profiles order by id"),
]


def main():
    for name, sql in QUERIES:
        print(f"=== {name}")
        print(psql(sql).rstrip())
    ssh = connect()
    try:
        out, err, _ = run(ssh, "ls -la /DATA/AppData/ahududu/uploads")
        print("=== uploads")
        print(out.rstrip())
    finally:
        ssh.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
