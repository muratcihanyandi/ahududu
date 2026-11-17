"""WhatsApp dışa aktarım dosyasını analiz eder (parse etmeden önce)."""
import collections
import io
import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

path = None
for candidate in pathlib.Path(r"C:\Users\Murat\Downloads").glob("*Selin ile WhatsApp Sohbeti.txt"):
    path = candidate
if path is None:
    print("dosya yok")
    raise SystemExit(1)

print("dosya:", path.name, path.stat().st_size, "bayt")

raw = path.read_bytes()
for enc in ("utf-8-sig", "utf-8", "cp1254"):
    try:
        text = raw.decode(enc)
        print("kodlama:", enc)
        break
    except UnicodeDecodeError:
        continue
else:
    text = raw.decode("utf-8", "replace")
    print("kodlama: utf-8 (replace)")

lines = text.splitlines()
print("satır:", len(lines))

LINE_RE = re.compile(
    r"^(?P<date>\d{1,2}[./]\d{1,2}[./]\d{2,4})\s+(?P<time>\d{1,2}:\d{2})(?::\d{2})?\s+-\s+(?P<rest>.*)$"
)

senders = collections.Counter()
system = collections.Counter()
messages = 0
multi = 0
special = collections.Counter()
unknown_starts = []

current = None
for line in lines:
    m = LINE_RE.match(line)
    if m:
        messages += 1
        rest = m.group("rest")
        if ": " in rest:
            sender, body = rest.split(": ", 1)
            if len(sender) <= 40:
                senders[sender] += 1
                current = sender
            else:
                system[rest[:40]] += 1
                current = None
        else:
            current = None
            system[rest[:60]] += 1
        if m.group("time"):
            pass
    else:
        multi += 1
        if current is None and len(unknown_starts) < 5:
            unknown_starts.append(line[:100])

print("\n--- gönderenler ---")
for k, v in senders.most_common(10):
    print(f"{v:7d}  {k!r}")
print("\n--- sistem/satır başlangıçları ---")
for k, v in system.most_common(10):
    print(f"{v:7d}  {k!r}")
print(f"\nmesaj başlangıcı: {messages}, devam satırı: {multi}")

# özel içerikleri say
for needle in ("<Medya dahil edilmedi>", "<Media omitted>", "bu mesaj silindi", "Bu mesaj silindi",
               "görsel", "Görsel", "video", ".jpg", ".opus", ".pdf", "bağlantı", "https://"):
    c = text.count(needle)
    if c:
        print(f"{needle!r}: {c}")

# tarih aralığı
dates = re.findall(r"^(\d{1,2})[./](\d{1,2})[./](\d{2,4})", text, re.M)
if dates:
    print("\nilk tarih:", dates[0], "son tarih:", dates[-1])
print("ilk 3 satır:", lines[:3])
print("son 3 satır:", lines[-3:])
