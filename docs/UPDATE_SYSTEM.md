# Güncelleme Sistemi

İki katman, iki farklı sorumluluk. Karıştırmak yasak (bkz. `docs/MODULE_SYSTEM.md`).

## 1. İçerik/yapılandırma güncellemeleri (APK gerektirmez)

**Kapsam:** mektup şablonları, temalar, etkileşim tanımları ve metinleri, özellik bayrakları, bildirim içerikleri, arayüz metinleri, limitler, yeni *sunucu tarafı* iş akışları.

**Akış:**
1. Değişiklik `app_config` belgesine işlenir (`version` artırılır). Düzenleme aracı: Aşama 6'da `POST /api/v1/admin/config` (sahip yetkisi) veya sunucuda betik.
2. Açık istemciler `config.updated` WS olayıyla anında günceller.
3. Kapalı istemciler açılışta/arka plan dönüşünde ETag kontrolüyle günceller.
4. Çevrimdışı istemci son önbellekle çalışmaya devam eder.

**Güvenceler:** `schemaVersion` uyumluluk kontrolü, disk önbelleği atomik yazım, hatalı belge gelirse son geçerli belge korunur (asla silinmez).

## 2. Yerel uygulama (APK) güncellemeleri

**Kapsam:** yeni kod, yeni ekran, yeni izin, veritabanı/protokol değişikliği.

**Akış:**
1. Yeni APK derlenir, imzalanır, sunucuda `app_releases`'e kaydedilir (betik: `deploy/publish-apk`).
2. Telefon uygulaması periyodik/açılışta `GET /api/v1/app/latest` çağırır.
3. `versionCode` cihazdakinden büyükse: güncelleme kartı gösterilir (sürüm adı + değişiklik notları).
4. Kullanıcı onaylarsa APK güvenli biçimde indirilir (sha256 doğrulanır) ve Android'in paket kurulum ekranı açılır (`ACTION_VIEW` + `APPLICATION_VND_ANDROID_PACKAGE_ARCHIVE`, FileProvider üzerinden).
5. Kurulum tamamen Android ve kullanıcının onayına bağlıdır: `REQUEST_INSTALL_PACKAGES` izni kullanıcıya açıklanır; bilinmeyen kaynaklar akışı belgelenir (`docs/ANDROID_INSTALLATION.md`). Sessiz/gizli kurulum denenmez.

**Saat (Wear):** aynı mekanizma `platform=wear` için ayrı çalışır; kurulum yöntemi için `docs/WEAR_OS_INSTALLATION.md`.

## 3. Sürümleme Kuralları

- `versionName`: `MAJOR.MINOR.PATCH`; `versionCode`: her yayında mutlaka artan tamsayı.
- Config `schemaVersion` istemcinin desteklediğinden ileri gidemez (istemci yok sayar); APK geriye dönük olarak eski config belgeleriyle çalışır.
- Eski istemci + yeni sunucu: yalnızca *eklemeler* → çalışır. Kalanma zorunlu ise: config'te `minAppVersion` bayrağı ile güncelleme zorlaması gösterilir; API kırıcı değişiklik yapılmaz.
