"""WhatsApp sohbet dışa aktarımını Ahududu veritabanına aktarır.

Kullanım:
    python deploy/import_whatsapp_chat.py --file "C:/.../Selin ile WhatsApp Sohbeti.txt" --dry-run
    python deploy/import_whatsapp_chat.py --file "..." --apply

Yaptığı:
  1. WhatsApp dışa aktarımını (Türkçe biçim) ayrıştırır.
  2. Mevcut sohbet geçmişini SİLER.
  3. Mesajları sırayla (1..N) ekler; böylece sohbet sırası birebir korunur.
  4. Sayaç (sequence) son mesajdan sonrasına ayarlanır.

Notlar:
  - WhatsApp saatleri telefonun yerel saatidir → Europe/Istanbul kabul edilip
    UTC'ye çevrilir (veritabanı saat dilimi duyarlı).
  - "<Medya dahil edilmedi>" satırları atlanır (dosyada medya yok).
  - Sistem/uyarı satırları (şifreleme bilgisi, engelleme) atlanır.
  - "Bu mesaj silindi" mesajları korunur.
  - Aynı gönderen adı farklı yazılmışsa (ör. "Murat" / "Murat Can Cihanyandı")
    aynı kullanıcıya eşlenir.
"""

import argparse
import json
import pathlib
import re
import sys
from datetime import datetime, timedelta, timezone

import psycopg2
from psycopg2.extras import execute_values

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_FILE = pathlib.Path(r"C:\Users\Murat\Downloads") / "\u200eSelin ile WhatsApp Sohbeti.txt"
DSN = (
    "host=192.168.2.170 port=5432 dbname=ahududu "
    "user=muratcihanyandi password=Can-10u3557"
)

# Türkiye 2026'da yaz saati uygulamıyor: sabit UTC+3.
TZ_OFFSET = timezone(timedelta(hours=3))

LINE_RE = re.compile(
    r"^(?P<d>\d{1,2})[./](?P<m>\d{1,2})[./](?P<y>\d{2,4})\s+"
    r"(?P<hh>\d{1,2}):(?P<mm>\d{2})(?::(?P<ss>\d{2}))?\s+-\s+(?P<rest>.*)$"
)

# Gönderen adı eşlemesi (küçük harfe çevrilmiş).
SENDER_MAP = {
    "murat": "murat",
    "murat can cihanyandı": "murat",
    "murat can cihanyandi": "murat",
    "selin": "selin",
    "sevgilim": "selin",
}

SKIP_BODIES = {
    "<medya dahil edilmedi>",
    "<media omitted>",
}
SKIP_BODY_PREFIXES = (
    "mesajlar ve aramalar uçtan uca şifrelidir",
    "bu kişiyi engellediniz",
    "bu kişinin engelini kaldırdınız",
    "*daha fazla bilgi*",
)


def parse_export(path: pathlib.Path) -> tuple[list[dict], dict]:
    raw = path.read_bytes()
    text = raw.decode("utf-8-sig")

    stats = {
        "system_skipped": 0,
        "media_skipped": 0,
        "empty_skipped": 0,
        "unknown_sender": {},
        "multiline": 0,
    }
    records: list[dict] = []

    current = None
    buffer: list[str] = []

    def flush() -> None:
        nonlocal current, buffer
        if current is None:
            return
        body = "\n".join(buffer).strip()
        if body:
            records.append({"sender": current, "content": body, "when": current_when})
        current = None
        buffer = []

    current_when = None

    for line in text.splitlines():
        m = LINE_RE.match(line)
        if m:
            flush()
            day = int(m.group("d"))
            month = int(m.group("m"))
            year = int(m.group("y"))
            if year < 100:
                year += 2000
            hour = int(m.group("hh"))
            minute = int(m.group("mm"))
            second = int(m.group("ss") or 0)
            current_when = datetime(year, month, day, hour, minute, second, tzinfo=TZ_OFFSET)

            rest = m.group("rest")
            if ": " in rest:
                sender_raw, body = rest.split(": ", 1)
                key = sender_raw.strip().lower()
                user = SENDER_MAP.get(key)
                if user is None:
                    if len(sender_raw) <= 40 and not body.startswith("\u00a0"):
                        stats["system_skipped"] += 1
                        current = None
                        buffer = []
                        continue
                    # tanınmayan gönderen: Murat'ın eski yazışmalarındaki
                    # "sevgilim" gibi adlar zaten eşlenmiş; buraya düşerse atla.
                    stats["unknown_sender"][sender_raw] = stats["unknown_sender"].get(sender_raw, 0) + 1
                    current = None
                    buffer = []
                    continue
                body_stripped = body.strip()
                low = body_stripped.lower()
                if low in SKIP_BODIES:
                    stats["media_skipped"] += 1
                    current = None
                    buffer = []
                    continue
                if any(low.startswith(p) for p in SKIP_BODY_PREFIXES):
                    stats["system_skipped"] += 1
                    current = None
                    buffer = []
                    continue
                current = user
                buffer = [body]
            else:
                # gönderensiz sistem satırı
                stats["system_skipped"] += 1
                current = None
                buffer = []
        else:
            if current is not None:
                buffer.append(line)
                stats["multiline"] += 1
            else:
                stats["system_skipped"] += 1

    flush()

    # Boş içerikleri temizle
    cleaned = []
    for rec in records:
        if not rec["content"]:
            stats["empty_skipped"] += 1
            continue
        cleaned.append(rec)
    return cleaned, stats


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default=str(DEFAULT_FILE))
    parser.add_argument("--apply", action="store_true", help="Gerçekten yaz (yoksa deneme)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--dsn", default=DSN)
    args = parser.parse_args()

    src = pathlib.Path(args.file)
    if not src.is_file():
        print(f"[FAIL] dosya bulunamadı: {src}")
        return 1

    print(f"[..] okunuyor: {src.name} ({src.stat().st_size / 1024 / 1024:.2f} MB)")
    records, stats = parse_export(src)
    print(f"[OK] mesaj: {len(records)}")
    print(f"     atlanan: medya={stats['media_skipped']} sistem={stats['system_skipped']} "
          f"boş={stats['empty_skipped']} çok satır={stats['multiline']}")
    if stats["unknown_sender"]:
        print("     tanınmayan gönderen:", stats["unknown_sender"])

    by_sender = {}
    for rec in records:
        by_sender[rec["sender"]] = by_sender.get(rec["sender"], 0) + 1
    print("     dağılım:", by_sender)
    print("     ilk:", records[0]["when"], records[0]["sender"], repr(records[0]["content"][:50]))
    print("     son:", records[-1]["when"], records[-1]["sender"], repr(records[-1]["content"][:50]))

    if args.dry_run or not args.apply:
        print("\n[DRY-RUN] Veritabanına yazılmadı. Yazmak için --apply ekle.")
        return 0

    conn = psycopg2.connect(args.dsn, connect_timeout=15)
    try:
        with conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM chat_messages")
            before = cur.fetchone()[0]
            print(f"\n[..] mevcut mesaj sayısı: {before} → siliniyor")
            cur.execute("DELETE FROM chat_messages")

            rows = [
                (
                    i + 1,
                    rec["sender"],
                    "text",
                    rec["content"],
                    None,
                    0,
                    rec["when"].astimezone(timezone.utc),
                )
                for i, rec in enumerate(records)
            ]
            execute_values(
                cur,
                """
                INSERT INTO chat_messages
                    (id, sender, message_type, content, media_url, duration, created_at)
                VALUES %s
                """,
                rows,
                page_size=2000,
            )

            cur.execute("SELECT setval('chat_messages_id_seq', %s, true)", (len(rows),))
            cur.execute("SELECT count(*), min(id), max(id) FROM chat_messages")
            total, min_id, max_id = cur.fetchone()
            cur.execute("SELECT min(created_at), max(created_at) FROM chat_messages")
            first_at, last_at = cur.fetchone()
        print(f"[OK] aktarıldı: {total} mesaj (id {min_id}..{max_id})")
        print(f"     tarih aralığı: {first_at} .. {last_at}")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
