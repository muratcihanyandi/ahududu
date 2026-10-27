# Test Stratejisi

Kural: çalıştırılmayan test geçmiş raporlanamaz. Her oturumun test sonuçları `docs/PROGRESS.md`'ye gerçek çıktılarıyla işlenir.

## Backend (`server/test/`, node:test)

- **Birim:** scrypt hash, token üretimi, davet kodu, rate limit penceresi, stroke modeli doğrulaması, config şema sürümü.
- **API (entegrasyon):** Fastify `inject` ile: setup/join/login akışı, yetki kontrolü (401/403), mesaj idempotency (aynı `clientMsgId`), not sürüm çakışması (409), dosya yüklemende MIME/boyut reddi, rate limit 429.
- **Veritabanı:** Migration'lar boş DB üzerinde sırayla; her migration'ın `-- +Down` bloğu geri alınabilir.
- Çalıştırma: `npm test` (yerel; DB gerektiren testler `AHUDUDU_TEST_DB` belirtildiğinde koşar, aksi halde atlanıp `# SKIP` ile raporlanır).

## Android (`android/`)

- **Birim (Robolectric/JUnit):** mesaj kuyruğu mantığı, çevrimdışı yeniden gönderme, çizim stroke modeli (basınç, geri al), config önbellek şema uyumu.
- **Derleme:** `:app:assembleDebug`, `:wear:assembleDebug` — her oturumda çalışır.
- **UI:** Compose ekranlarının derlenmesi + kritik akışların elle doğrulanması; emülatör varsa `connectedDebugAndroidTest`.
- **Cihaz:** Gerçek S23/S24 Ultra testleri ayrı işaretlenir (bkz. `docs/KNOWN_LIMITATIONS.md`).

## Dağıtım / Docker

- Her dağıtımdan sonra: health check (`/health`), migration log kontrolü, WS el sıkışma testi (wscat/betik), örneğin uçtan uca: iki kullanıcı kurulumu + mesaj alışverişi.
- Kalıcı veri: konteyner yeniden başlatma sonrası veri korunumu kontrolü.
- Yedekleme: `deploy/backup.py` çıktısının geri yüklenebilirliği (test ortamında) — Aşama 6.

## Durum Etiketleri (PROGRESS.md'de kullanılır)

- ✅ doğrulandı (komut/çıktı ile)
- 🧪 emülatörde doğrulandı
- ⏳ gerçek cihaz bekliyor
- ❌ bilinen hata (kök neden + plan)
