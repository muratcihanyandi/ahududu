"""Canlı sunucu doğrulaması: şema göçü, mektup arşivi ve sinema durumu.

Çalıştırma:
    python tests/verify_live_five.py
"""

import json
import sys
import urllib.request

sys.path.insert(0, "tests")
from pi_helper import psql  # noqa: E402

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = "https://ahududu.fakeyol.com"

QUERIES = [
    ("love_letters kolonları", "select column_name, data_type from information_schema.columns "
     "where table_name='love_letters' order by ordinal_position"),
    ("push_devices tablosu", "select count(*) from push_devices"),
    ("love_letters içerik", "select id, title, is_opened, created_at from love_letters order by id"),
    ("cinema_rooms", "select id,title,is_active,is_playing,updated_by,updated_at from cinema_rooms"),
    ("film mektupları yedeği", "select count(*) from love_letters"),
]


def api(path, method="GET", data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(
        BASE + path, data=body, method=method,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AhududuCheck/1.0",
            "Accept": "application/json",
        } if body else {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AhududuCheck/1.0",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as res:
        raw = res.read().decode()
        return json.loads(raw) if raw else None


def main():
    version = api("/api/system/version")
    print("build_id:", version.get("build_id"))
    print("push:", version.get("push"))

    letters = api("/api/letters")
    print("canlı mektup sayısı:", len(letters or []))
    for letter in letters or []:
        print(f"  #{letter['id']} {letter['title']} (arşiv: {letter.get('is_deleted')})")

    print("push durumu:", api("/api/devices/status"))

    for name, sql in QUERIES:
        print(f"=== {name}")
        print(psql(sql).rstrip())


if __name__ == "__main__":
    main()
