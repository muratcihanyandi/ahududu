#!/usr/bin/env python3
"""ADB UI yardımcısı — canlı test için: ekran dökümü, metne göre dokunma, yazma."""
import re
import subprocess
import sys
import time

ADB = r"C:\Users\Murat\AppData\Local\Android\Sdk\platform-tools\adb.exe"


def run(args, timeout=60, binary=False):
    if binary:
        return subprocess.run([ADB] + args, capture_output=True, timeout=timeout)
    return subprocess.run([ADB] + args, capture_output=True, text=True, timeout=timeout, errors="replace")


def dump():
    """(metin, merkez_x, merkez_y, sinif) listesi döner."""
    for _ in range(3):
        run(["shell", "uiautomator dump /sdcard/ui_dump.xml"])
        res = run(["shell", "cat /sdcard/ui_dump.xml"])
        if res.stdout and "<hierarchy" in res.stdout:
            out = []
            for m in re.finditer(
                r'<node[^>]*?class="([^"]*)"[^>]*?text="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"',
                res.stdout,
            ):
                cls, text, x1, y1, x2, y2 = m.groups()
                if text.strip():
                    out.append((text, (int(x1) + int(x2)) // 2, (int(y1) + int(y2)) // 2, cls))
            if not out:
                # Nitelik sırası farklı olabilir: ikinci desen
                for m in re.finditer(r"<node([^>]*)>", res.stdout):
                    attrs = m.group(1)
                    t = re.search(r'text="([^"]*)"', attrs)
                    b = re.search(r'bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', attrs)
                    c = re.search(r'class="([^"]*)"', attrs)
                    if t and b and t.group(1).strip():
                        x1, y1, x2, y2 = map(int, b.groups())
                        out.append((t.group(1), (x1 + x2) // 2, (y1 + y2) // 2, c.group(1) if c else ""))
            return out
        time.sleep(0.7)
    return []


def tap_text(text, exact=False):
    items = dump()
    for t, x, y, cls in items:
        if (text == t) if exact else (text.lower() in t.lower()):
            run(["shell", f"input tap {x} {y}"])
            time.sleep(0.6)
            return True
    return False


def tap_xy(x, y):
    run(["shell", f"input tap {x} {y}"])
    time.sleep(0.6)


def type_text(text):
    escaped = text.replace(" ", "%s").replace("'", "\\'")
    run(["shell", f"input text '{escaped}'"])
    time.sleep(0.4)


def shot(path):
    with open(path, "wb") as f:
        f.write(run(["exec-out", "screencap -p"], timeout=90, binary=True).stdout)
    return path


def texts():
    return [t for t, _, _, _ in dump()]


def key(code):
    run(["shell", f"input keyevent {code}"])
    time.sleep(0.4)


def back():
    key(4)


def clear_field():
    run(["shell", "input keyevent KEYCODE_MOVE_END"])
    for _ in range(40):
        run(["shell", "input keyevent KEYCODE_DEL"])


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "dump"
    if cmd == "dump":
        for t, x, y, c in dump():
            print(f"{x},{y}\t{t}\t({c.split('.')[-1]})")
    elif cmd == "tap":
        print("bulundu" if tap_text(sys.argv[2]) else "BULUNAMADI")
    elif cmd == "shot":
        print(shot(sys.argv[2]))
