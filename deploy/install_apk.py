"""Yeni APK'yı kablosuz adb ile telefona kurar.

Kullanım:
    python deploy/install_apk.py                 # cihazı otomatik ara
    python deploy/install_apk.py --serial 192.168.2.29:44111

Cihaz bağlı değilse nasıl bağlanacağını yazar (telefonda Kablosuz Hata Ayıklama
açık olmalı; port her yeniden bağlanmada değişebilir).
"""

import argparse
import os
import subprocess
import sys
import time

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APK = os.path.join(ROOT, "Ahududu.apk")
ADB = os.path.join(
    os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk", "platform-tools", "adb.exe"
)
DEFAULT_SERIAL = os.getenv("AHUDUDU_DEVICE", "192.168.2.29:44111")


def adb(*args: str, timeout: int = 120) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, *args], capture_output=True, text=True, timeout=timeout,
        encoding="utf-8", errors="replace",
    )


def connected_devices() -> list[str]:
    out = adb("devices").stdout or ""
    return [l.split("\t")[0].strip() for l in out.splitlines() if "\tdevice" in l]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--serial", default=DEFAULT_SERIAL)
    args = parser.parse_args()

    if not os.path.isfile(ADB):
        print(f"[FAIL] adb bulunamadı: {ADB}")
        return 1
    if not os.path.isfile(APK):
        print(f"[FAIL] APK bulunamadı: {APK} (önce: cd frontend/android && gradlew assembleDebug)")
        return 1

    devices = connected_devices()
    if not devices:
        print(f"[..]   Bağlı cihaz yok, {args.serial} deneniyor…")
        print(adb("connect", args.serial).stdout.strip())
        time.sleep(3)
        devices = connected_devices()

    if not devices:
        print("\n[FAIL] Cihaz bağlanamadı.")
        print("Telefonda:")
        print("  1) Ayarlar → Geliştirici Seçenekleri → Kablosuz hata ayıklama AÇIK")
        print("  2) Aynı Wi-Fi ağında olun")
        print("  3) Telefonda 'Kablosuz hata ayıklama' ekranındaki IP:port ile:")
        print("     python deploy/install_apk.py --serial <IP>:<PORT>")
        return 1

    serial = args.serial if args.serial in devices else devices[0]
    print(f"[OK]   cihaz: {serial}")

    # Farklı imzayla derlenmişse normal kurulum başarısız olur: -r yeterli olmazsa
    # kullanıcıya uninstall önerilir, burada zorla silme yapılmaz.
    result = adb("-s", serial, "install", "-r", APK, timeout=300)
    out = (result.stdout or "") + (result.stderr or "")
    if "Success" in out:
        print("[OK]   APK kuruldu.")
        print(adb("-s", serial, "shell", "am", "force-stop", "com.ahududu.app").stdout.strip())
        print(adb("-s", serial, "shell", "am", "start", "-n", "com.ahududu.app/.MainActivity").stdout.strip())
        print("[OK]   Uygulama açıldı. Bildirim iznini kontrol et.")
        return 0

    print("[FAIL] Kurulum başarısız:")
    print(out.strip()[:800])
    if "INSTALL_FAILED_UPDATE_INCOMPATIBLE" in out:
        print("\nİpucu: farklı imzalı bir sürüm kurulu. Şu komutla eskiyi kaldırıp tekrar dene:")
        print(f"  adb -s {serial} uninstall com.ahududu.app")
        print("  (Uygulama verisi silinir; oturum seçimi yeniden yapılır.)")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
