#!/usr/bin/env bash
# Galaxy Watch 7 / Watch Ultra'ya kablosuz ADB ile Ahududu saat uygulamasını kurar.
# Kullanım: ./scripts/install-wear.sh <saat-ip>:<port>
# Saatte: Ayarlar > Geliştirici Seçenekleri > Kablosuz hata ayıklama açık olmalı.
# İlk kez bağlanıyorsan eşleştirme gerekir:
#   adb pair <saat-ip>:<eslestirme-portu>   (saat ekranındaki kodu gir)
set -euo pipefail

SDK="${ANDROID_HOME:-$LOCALAPPDATA/Android/Sdk}"
ADB="$SDK/platform-tools/adb.exe"
APK="$(dirname "$0")/../wear/build/outputs/apk/debug/wear-debug.apk"

if [ "$#" -lt 1 ]; then
  echo "Kullanım: $0 <saat-ip>:<adb-port>   (ör. $0 192.168.2.55:5555)"
  exit 1
fi
if [ ! -f "$APK" ]; then
  echo "APK bulunamadı: $APK"
  echo "Önce derle: ./gradlew :wear:assembleDebug"
  exit 1
fi

"$ADB" connect "$1"
"$ADB" -s "$1" install -r "$APK"
"$ADB" disconnect "$1"
echo "Kurulum tamamlandı. Saatte ADB hata ayıklamasını kapatabilirsin."
