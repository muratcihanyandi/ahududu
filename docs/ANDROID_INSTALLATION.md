# Telefon Kurulumu (Android)

## Gereksinimler

- Samsung Galaxy S23 / S24 Ultra (Android 13+; minSdk 31)
- Ahududu sunucusuna erişim: ev ağı içinde `http://192.168.2.170:8787`, ev dışında tünel adresi (bkz. `docs/DEPLOYMENT.md`)

## Kurulum Adımları

1. **APK'yı edin:** Sunucudan uygulama içinden (`Ayarlar → Güncellemeler`) veya doğrudan `http://192.168.2.170:8787` üzerinden indirilen `ahududu-<sürüm>.apk`.
2. **Bilinmeyen kaynaklara izin ver:** İlk kurulumda Android "Bilinmeyen uygulamaların yüklenmesi" ekranı açılır (APK'yı hangi uygulamayla açtıysanız — Dosyalar/Tarayıcı — o uygulama için kaynak izni istenir). Bu, Play Store dışı dağıtımın normal adımıdır; yalnızca söz konusu uygulama için geçerlidir.
3. **Kurulumu onayla:** Android paket kurulum ekranı → *Yükle*. Uygulama imzalı APK ile gelir; imza doğrulaması Android tarafından yapılır.
4. **İlk açılış:** Kurulum sihirbazı — sunucu adresi (otomatik algılama ev ağında) → *Alan oluştur* (ilk kullanıcı) veya *Davet koduyla katıl* (ikinci kullanıcı).
5. **Güncellemeler:** Uygulama yeni sürümü bildirir; indirme + kurulum onayı kullanıcıdan alınır (`docs/UPDATE_SYSTEM.md`). `REQUEST_INSTALL_PACKAGES` izni güncelleme akışında, açıklamasıyla istenir.

## Güvenlik Notları

- Oturum tokenı cihazda Android Keystore ile şifrelenmiş olarak saklanır.
- Parola yalnızca kurulum/girişte kullanılır; günlük kullanımda biyometrik kilit (isteğe bağlı).
- Cihaz kaybı durumunda: diğer cihazdan `Ayarlar → Cihazlar` → oturumu iptal et; parola değişikliği tüm oturumları düşürür.

## Geliştirici Kurulumu (ZCode/CLI)

```bash
cd android
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"   # Git Bash
./gradlew :app:assembleDebug
$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe install -r app/build/outputs/apk/debug/app-debug.apk
```

USB ile cihaza `adb install` en hızlı dağıtım yöntemidir. Kablosuz ADB (`adb pair`/`adb connect`) da desteklenir.
