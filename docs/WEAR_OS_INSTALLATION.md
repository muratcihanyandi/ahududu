# Saat Kurulumu (Wear OS — Galaxy Watch 7 / Watch Ultra)

## Gerçek Durum (araştırma sonucu)

Samsung Galaxy Watch 7 ve Watch Ultra Wear OS 5+ (Android 14/API 34 tabanı) çalıştırır. Play Store dışından saat uygulaması kurmanın **desteklenen yolu kablosuz ADB'dir**:

- Telefonun "Galaxy Wearable" uygulaması yalnızca Play Store uygulamalarını kurar; sideload edilen telefon APK'sı saate otomatik kurulmaz.
- "Telefon APK'sının içine saat APK'sı gömme" yalnızca Play Store dağıtımında geçerlidir; özel dağıtımda çalışmaz.
- Bu yüzden telefon uygulamasında **"Saatimi Kur"** bölümü, gerçek durumu dürüstçe anlatır ve kurulumu iki yol ile sunar: (1) geliştirici modu + kablosuz ADB betiği, (2) gerektiğinde bilgisayardan `adb install`.

Sahte "kuruldu" ekranı gösterilmez; kurulum doğrulanana kadar durum "kurulu değil" olarak kalır. Uygulama, saatin kurulu olup olmadığını Wear OS Data Layer `NodeClient.getConnectedNodes()` üzerinden gerçek veriyle tespit eder.

## Kurulum Adımları (kablosuz ADB — önerilen)

1. Saatte: **Ayarlar → Saat Hakkında → Yazılım** → sürümüne 7 kez dokun → geliştirici modu açılır.
2. Saatte: **Ayarlar → Geliştirici Seçenekleri → ADB üzerinden hata ayıklama** açık + **Kablosuz hata ayıklama** açık (saat Wi-Fi'da aynı ağda olmalı; ekranda IP:port gösterilir).
3. Telefonda Ahududu → **Ayarlar → Saatimi Kur**: ekrandaki adımlar + tek dokunuşla çalışan eşleştirme akışı (kod üretir, yönlendirir).
4. Tek seferlik eşleştirme koduyla cihaz eşleşmesi:
   ```bash
   adb pair <saat-ip>:<pair-port>      # ekrandaki eşleştirme kodu girilir
   adb connect <saat-ip>:<adb-port>
   adb install -r wear/build/outputs/apk/debug/wear-debug.apk
   adb disconnect
   ```
   (Bu adımlar `android/scripts/install-wear.sh` betiğinde otomatikleştirilmiştir; betik doğrulama çıktısı verir.)
5. Kurulumdan sonra saatte ADB hata ayıklaması kapatılabilir.

## Güncellemeler

- Saat APK güncellemesi de aynı ADB yöntemiyle yapılır (`install -r` mevcut veriyi korur).
- Uygulama içi sürüm kontrolü `platform=wear` için çalışır; telefon, saatin sürümünü Data Layer üzerinden okur ve güncelleme gerektiğini bildirir.
- Kurulum her durumda kullanıcı eylemi ister; telefonda otomatik saat kurulumu sözü verilmez.

## Notlar

- İmza: saat ve telefon APK'ları aynı anahtarla imzalanır (Data Layer imza eşleşmesi sorunlarını önler).
- Saat uygulaması telefonsuz da kısmen çalışır (önbellekteki son veriler); yeni veri için telefon bağlantısı gerekir. Saatin doğrudan Wi-Fi üzerinden sunucuya bağlanması Aşama 5'te değerlendirilecek opsiyoneldir.
