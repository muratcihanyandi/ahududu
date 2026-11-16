"""Cihazda bildirim uçtan uca testi (kablosuz adb).

Kullanım:
    python tests/test_device_notifications.py                    # uygulama kapalıyken
    python tests/test_device_notifications.py --keep-open        # uygulama açıkken

Yaptığı:
  1. Bağlı cihazı bulur (adb devices).
  2. Uygulamayı kapatır (force-stop).
  3. Sunucuda "diğer kişi"nden bir mesaj gönderir (varsayılan Selin -> Murat).
  4. 8 saniye bekleyip bildirim tepsisinde `com.ahududu.app` bildirimi arar.
  5. Ekran görüntüsünü tests/screenshots_device/ altına kaydeder.
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "screenshots_device")
ADB = os.path.join(
    os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk", "platform-tools", "adb.exe"
)
DEFAULT_SERIAL = os.getenv("AHUDUDU_DEVICE", "192.168.2.29:44111")
SERVER = os.getenv("AHUDUDU_SERVER", "http://192.168.2.170:33470")
PKG = "com.ahududu.app"
os.makedirs(OUT, exist_ok=True)


def adb(*args: str, serial: str | None = None, timeout: int = 30) -> subprocess.CompletedProcess:
    cmd = [ADB]
    if serial:
        cmd += ["-s", serial]
    cmd += list(args)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, encoding="utf-8", errors="replace")


def pick_device() -> str | None:
    result = adb("devices")
    lines = [l for l in result.stdout.splitlines() if "\tdevice" in l]
    if not lines:
        return None
    serials = [l.split("\t")[0].strip() for l in lines]
    if DEFAULT_SERIAL in serials:
        return DEFAULT_SERIAL
    return serials[0]


def screenshot(serial: str, name: str) -> str:
    remote = f"/sdcard/{name}.png"
    adb("shell", "screencap", "-p", remote, serial=serial)
    local = os.path.join(OUT, f"{name}.png")
    adb("pull", remote, local, serial=serial)
    adb("shell", "rm", "-f", remote, serial=serial)
    return local


def post_message(sender: str, content: str) -> dict:
    body = json.dumps(
        {"sender": sender, "message_type": "text", "content": content}
    ).encode()
    req = urllib.request.Request(
        f"{SERVER}/api/chat/messages", data=body, method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as res:
        return json.loads(res.read().decode())


def find_notifications(serial: str) -> str:
    """Yalnızca GERÇEKTEN gösterilmiş bildirimleri (NotificationRecord) döndürür.

    `dumpsys notification` çıktısında bildirim kanalları da bu paket adını
    içerir; onları saymıyoruz, yoksa yanlış "bildirim var" sonucu çıkar.
    Kaydın kimliği ilk satırdaki `pkg=<paket>` alanındadır.
    """
    result = adb("shell", "dumpsys", "notification", "--noredact", serial=serial, timeout=60)
    text = result.stdout or ""
    records = []
    current = None
    for line in text.splitlines():
        if "NotificationRecord(" in line:
            if current:
                records.append(current)
            current = [line]
        elif current is not None:
            if line.startswith("  AppSettings") or line.startswith("NotificationRecord("):
                records.append(current)
                current = None
            else:
                current.append(line)
    if current:
        records.append(current)

    matched = []
    for record in records:
        header = record[0]
        if f"pkg={PKG}" in header:
            matched.append("\n".join(record))
    return "\n".join(matched)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keep-open", action="store_true", help="Uygulamayı kapatma")
    parser.add_argument("--sender", default="selin")
    parser.add_argument("--wait", type=int, default=10)
    args = parser.parse_args()

    if not os.path.isfile(ADB):
        print(f"[FAIL] adb bulunamadı: {ADB}")
        return 1

    serial = pick_device()
    if not serial:
        print("[FAIL] Bağlı cihaz yok. `adb connect` ile bağlan.")
        return 1
    print(f"[OK]   cihaz: {serial}")

    if not args.keep_open:
        adb("shell", "am", "force-stop", PKG, serial=serial)
        print("[OK]   uygulama kapatıldı")
        time.sleep(2)

    content = f"Bildirim testi {time.strftime('%H:%M:%S')}"
    message = post_message(args.sender, content)
    print(f"[OK]   mesaj gönderildi: id={message.get('id')} '{content}'")
    print(f"[..]   {args.wait} saniye bekleniyor…")
    time.sleep(args.wait)

    blocks = find_notifications(serial)
    has_message = bool(blocks.strip())
    shot = screenshot(serial, "notify_test")
    print(f"[..]   ekran görüntüsü: {shot}")

    if has_message:
        print("\n[OK]   BİLDİRİM BULUNDU:\n")
        print(blocks[:1200])
        return 0

    print("\n[FAIL] Bildirim bulunamadı.")
    # Tanılama: uygulama çalışıyor mu, servis ayakta mı?
    pid = adb("shell", "pidof", PKG, serial=serial).stdout.strip()
    print(f"        pid: {pid or '(yok)'}")
    services = adb("shell", "dumpsys", "activity", "services", PKG, serial=serial, timeout=60).stdout or ""
    for line in services.splitlines():
        if PKG in line:
            print("        ", line.strip()[:160])
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
