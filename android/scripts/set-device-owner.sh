#!/usr/bin/env bash
# Telefonu "Device Owner" yapar: Ahududu güncellemeleri tamamen otomatik kurulur.
#
# Gereksinimler (tek seferlik):
#   - Telefonda HİÇ hesap eklenmemiş olmalı (Ayarlar > Hesaplar boş).
#     Hesap varsa komut "already has accounts" hatası verir.
#   - USB hata ayıklama açık olmalı.
#   - Uygulama kurulu olmalı (uygulamayı açıp giriş yapmış ol).
#
# Kullanım:
#   android/scripts/set-device-owner.sh            # bağlı tek cihaz
#   android/scripts/set-device-owner.sh <serial>   # belirli cihaz
#
# Geri alma:
#   adb shell dpm remove-active-admin com.ahududu.app/.AhududuDeviceAdmin
set -euo pipefail

SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
ADB="$SDK/platform-tools/adb.exe"
[ -x "$ADB" ] || ADB="adb"

SERIAL_ARGS=()
if [ "$#" -ge 1 ]; then
  SERIAL_ARGS=(-s "$1")
fi

echo "== Cihazlar =="
"$ADB" devices

echo
echo "== Hesap kontrolü =="
ACCOUNTS=$("$ADB" "${SERIAL_ARGS[@]}" shell dumpsys account 2>/dev/null | grep -c 'Account {' || true)
if [ "${ACCOUNTS:-0}" -gt 0 ]; then
  echo "UYARI: Cihazda $ACCOUNTS hesap görünüyor."
  echo "Device Owner ataması yalnızca hesapsız cihazlarda çalışır."
  echo "Hesabı kaldırıp (Ayarlar > Hesaplar) tekrar dene."
  exit 1
fi
echo "Hesap yok — devam edilebilir."

echo
echo "== Device Owner atanıyor =="
"$ADB" "${SERIAL_ARGS[@]}" shell dpm set-device-owner \
  com.ahududu.app/.AhududuDeviceAdmin

echo
echo "== Doğrulama =="
"$ADB" "${SERIAL_ARGS[@]}" shell dpm list-owners

echo
echo "TAMAM. Bundan sonra yeni APK yayınlandığında Ahududu kendini sessizce günceller."
echo "Geri almak için:"
echo "  adb shell dpm remove-active-admin com.ahududu.app/.AhududuDeviceAdmin"
