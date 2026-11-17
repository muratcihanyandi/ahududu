"""WhatsApp dışa aktarımındaki özel satır örneklerini inceler."""
import collections
import io
import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

path = next(pathlib.Path(r"C:\Users\Murat\Downloads").glob("*Selin ile WhatsApp Sohbeti.txt"))
text = path.read_bytes().decode("utf-8-sig")
lines = text.splitlines()

LINE_RE = re.compile(r"^(\d{1,2})[./](\d{1,2})[./](\d{2,4})\s+(\d{1,2}:\d{2})(?::\d{2})?\s+-\s+(.*)$")

samples = collections.defaultdict(list)
multiline_samples = []
current = None
body_lines = []

records = []
for line in lines:
    m = LINE_RE.match(line)
    if m:
        if current is not None:
            records.append((current, "\n".join(body_lines).strip()))
        d, mo, y, t, rest = m.groups()
        if ": " in rest:
            sender, body = rest.split(": ", 1)
            if len(sender) <= 40:
                current = sender
                body_lines = [body]
            else:
                current = None
                body_lines = []
                samples["system"].append(rest[:90])
        else:
            current = None
            body_lines = []
            samples["system"].append(rest[:90])
    else:
        if current is not None:
            body_lines.append(line)
        else:
            samples["orphan"].append(line[:90])
if current is not None:
    records.append((current, "\n".join(body_lines).strip()))

print("toplam kayıt:", len(records))
texts = [b for _s, b in records]
for needle, key in [
    ("<Medya dahil edilmedi>", "media"),
    ("Bu mesaj silindi", "deleted"),
    ("<Bağlantı dahil edilmedi>", "link"),
]:
    hits = [t for t in texts if needle in t]
    print(f"\n{key}: {len(hits)}")
    for t in hits[:4]:
        print("   ", repr(t[:120]))

print("\n--- çok satırlı mesajlar ---")
multi = [(s, b) for s, b in records if "\n" in b]
print("adet:", len(multi))
for s, b in multi[:5]:
    print("   ", s, "->", repr(b[:150]))

print("\n--- sistem satırları ---")
for s in samples["system"][:10]:
    print("   ", s)
print("\n--- sahipsiz satır ---", len(samples["orphan"]))
for s in samples["orphan"][:5]:
    print("   ", s)

print("\n--- en uzun mesaj ---")
longest = max(records, key=lambda r: len(r[1]))
print(len(longest[1]), repr(longest[1][:200]))

print("\n--- 'Murat' gönderen tek kayıt ---")
for s, b in records:
    if s == "Murat":
        print("   ", repr(b[:120]))
