"""Dışa aktarımda altyazılı medya var mı kontrol eder."""
import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

path = next(pathlib.Path(r"C:\Users\Murat\Downloads").glob("*Selin ile WhatsApp Sohbeti.txt"))
text = path.read_bytes().decode("utf-8-sig")

LINE_RE = re.compile(r"^(\d{1,2})[./](\d{1,2})[./](\d{2,4})\s+(\d{1,2}:\d{2})(?::\d{2})?\s+-\s+(.*)$")

records = []
buffer = []
in_msg = False
for line in text.splitlines():
    if LINE_RE.match(line):
        if in_msg:
            records.append("\n".join(buffer))
        in_msg = True
        buffer = [LINE_RE.match(line).group(5)]
    elif in_msg:
        buffer.append(line)
if in_msg:
    records.append("\n".join(buffer))

with_placeholder_caption = [r for r in records if "<Medya dahil edilmedi>" in r and r.strip() != "<Medya dahil edilmedi>"]
print("placeholder içeren toplam:", sum(1 for r in records if "<Medya dahil edilmedi>" in r))
print("aldyazılı/ek metinli:", len(with_placeholder_caption))
for r in with_placeholder_caption[:6]:
    print("   ", repr(r[:180]))

# silinen mesaj + ek metin
deleted_extra = [r for r in records if "Bu mesaj silindi" in r and r.strip() != "Bu mesaj silindi"]
print("\n'Bu mesaj silindi' ek metinli:", len(deleted_extra))
for r in deleted_extra[:4]:
    print("   ", repr(r[:140]))
