"""Canlı veritabanındaki chat_messages tablosunu inceler."""
import sys

import psycopg2

sys.stdout.reconfigure(encoding="utf-8")

DSN = "host=192.168.2.170 port=5432 dbname=ahududu user=muratcihanyandi password=Can-10u3557"

with psycopg2.connect(DSN, connect_timeout=10) as conn:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'chat_messages'
            ORDER BY ordinal_position
        """)
        print("--- kolonlar ---")
        for row in cur.fetchall():
            print("   ", row)

        cur.execute("SELECT count(*) FROM chat_messages")
        print("\nmesaj sayısı:", cur.fetchone()[0])

        cur.execute("SELECT id, sender, message_type, left(coalesce(content,''),40), created_at FROM chat_messages ORDER BY id LIMIT 5")
        print("\n--- ilk 5 ---")
        for row in cur.fetchall():
            print("   ", row)

        cur.execute("SELECT id, sender, message_type, left(coalesce(content,''),40), created_at FROM chat_messages ORDER BY id DESC LIMIT 5")
        print("\n--- son 5 ---")
        for row in cur.fetchall():
            print("   ", row)

        cur.execute("SELECT max(id) FROM chat_messages")
        print("\nmax(id):", cur.fetchone()[0])

        cur.execute("""
            SELECT conname, pg_get_serial_sequence('chat_messages', 'id')
            FROM pg_constraint WHERE conrelid = 'chat_messages'::regclass
        """)
        print("\n--- kısıtlar ---")
        for row in cur.fetchall():
            print("   ", row)
