# Ahududu

İki kişilik özel bir dijital yaşam alanı: mektuplar, mesajlar, ortak anılar, notlar ve romantik etkileşimler. Ticari amaçlı değildir; birbirine ait iki kişi tarafından kullanılır.

## Bileşenler

| Bileşen | Yol | Teknoloji | Hedef |
|---|---|---|---|
| Backend | `server/` | Node.js 24, TypeScript, Fastify, WebSocket, PostgreSQL | Raspberry Pi 5 (CasaOS/Docker), port 8787 |
| Telefon uygulaması | `android/app` | Kotlin, Jetpack Compose | Galaxy S23 / S24 Ultra |
| Saat uygulaması | `android/wear` | Kotlin, Wear Compose | Galaxy Watch 7 / Watch Ultra |
| Paylaşılan katman | `android/common` | Kotlin | Tasarım sistemi, API istemcisi, DTO'lar |

## Hızlı Başlangıç

### Backend (yerel geliştirme)

```bash
cd server
cp .env.example .env        # değerleri düzenle (DB bağlantısı vb.)
npm install
npm run db:migrate          # şemayı uygula
npm run dev                 # http://localhost:8787
```

Testler: `npm test` · Tip kontrolü: `npm run typecheck`

### Android

```bash
cd android
# JAVA_HOME Android Studio JBR'yü göstermeli (JDK 21)
./gradlew :app:assembleDebug      # telefon APK'sı
./gradlew :wear:assembleDebug     # saat APK'sı
```

### Sunucuya Dağıtım

`docs/DEPLOYMENT.md` — Pi üzerindeki CasaOS/Docker kurulumuna `deploy/` betikleriyle yapılır.

## Dokümantasyon

- `docs/ARCHITECTURE.md` — mimari kararlar ve gerekçeler
- `docs/ROADMAP.md` — aşamalar ve kabul kriterleri
- `docs/PROGRESS.md` — güncel durum, testler, sıradaki adımlar
- `docs/API.md` — API ve WebSocket sözleşmesi
- `docs/DATABASE.md` — şema ve migration kuralları
- `docs/UPDATE_SYSTEM.md` — sunucu destekli güncellemeler + APK sürümleri
- `docs/MODULE_SYSTEM.md` — sunucudan yönetilen modül/yapılandırma sistemi
- `docs/DEPLOYMENT.md`, `docs/ANDROID_INSTALLATION.md`, `docs/WEAR_OS_INSTALLATION.md`
- `docs/TESTING.md`, `docs/KNOWN_LIMITATIONS.md`

## Lisans ve Kapsam

Özel kullanım. Kaynak kod ve sunucu yalnızca ilgili iki kişi içindir.
