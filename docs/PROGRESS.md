# İlerleme Durumu

> Bu dosya her anlamlı aşamadan sonra güncellenir. Etiketler: ✅ doğrulandı (komut/çıktı ile) · 🧪 emülatörde · ⏳ gerçek cihaz bekliyor · ❌ bilinen hata

## Güncel Durum: Aşama 0 ✅ · Aşama 1 ✅ · Aşama 2 ✅ · Aşama 3 ✅ — çekirdek ürün çalışıyor

Tarih: 2026-10-27 (oturum 3)

## Oturum 4 — Canlı Ses Dinleme + Mesafe Hesabı + Stres Seviyesi + GHCR & CasaOS Dağıtımı

### Eklenen & Doğrulanan Yetenekler
| Özellik | Bileşen | Gerçekleşen Davranış |
|---|---|---|
| **Canlı Ses Dinleme (Fısıltı)** | AudioStreamManager.kt, WS hub forwardEphemeral | Sevgililerin birbirinin ortam sesini düşük gecikmeli (PCM 16kHz) canlı dinlemesi; ses dalgası animasyonu |
| **Mesafe Hesabı** | TogetherScreen.kt, LocationReporter.kt | İki sevgilinin konumu arasındaki gerçek mesafe hesabı ('Aynı yerdesiniz, sımsıkı sarılın! 🥰', '~350 metre 💕', 'Aramızda 12.4 km var 🕊️') |
| **Stres Seviyesi** | Migration 010, health/routes.ts, WearHealth.kt | Kalp ritmi ve sensörden stres seviyesi (%0-100, Sakin/Normal/Stresli); telefonda ve Galaxy Watch'ta anlık senkronizasyon |
| **Bana İlgi Ver! Butonu** | TogetherScreen.kt | Tek dokunuşla sevgilinin telefonunu ve saatini titreten, sevgi alarmı ve animasyon gönderen özel buton |
| **Özel Saat Animasyonları** | Wear OS MainActivity.kt | Ahududu Yağmuru (🍓), Aşk Yıldızları (✨), Kalp Ritmi, Öpücük ve Sarılma tam ekran animasyonları |
| **Tek Dokunuş Güncelleme** | UpdateBannerOverlay, AutoInstallService.kt | Yeni sürüm çıktığında pembe tatlı afiş ('Ahududu için yenilik var! 🍓') + tek tıkla güncelleme + otomatik kurulum onaylayıcı |
| **Galaxy Watch Eşleşmesi** | SettingsScreen.kt, WearCredentialPublisher.kt | 'Saate Giriş Bilgilerini Aktar ⌚' ile saatte şifre girmeden anında telefonla eşleşme |
| **GitHub & GHCR Dağıtımı** | .github/workflows/deploy.yml | ghcr.io/muratcihanyandi/ahududu-server:latest multi-arch (linux/arm64) imajı başarıyla derlendi |
| **Raspberry Pi 5 / CasaOS** | SSH, docker compose, PostgreSQL 17 | GHCR'den CasaOS'e çekildi, port 8787'de sağlıklı çalışıyor; migration 010 uygulandı; APK'lar sunucuda yayınlandı |

### Test & Dağıtım Sonuçları
- npm run typecheck & npm test: ✅ 14/14 geçti, 0 hata.
- gradlew assembleDebug (Phone & Wear): ✅ BUILD SUCCESSFUL (Phone APK v0.2.1, Wear APK v0.2.0).
- GitHub Actions CI/CD: ✅ completed success (ghcr.io/muratcihanyandi/ahududu-server:latest).
- Pi 5 Sağlık Kontrolü: ✅ {'status':'ok','db':'up','version':'0.1.0'} (Up healthy, 0.0.0.0:8787).
- Pi 5 Sürüm Yayınları: ✅ phone v0.2.1 (code 3) ve wear v0.2.0 (code 2) yüklendi ve app_releases tablosuna işlendi.

## Oturum 3 — 7 backend modülü + tam Android uygulaması

### Backend modülleri
| Modül | Uçlar | Öne çıkan davranış |
|---|---|---|
| `messaging` | gönder/geçmiş/düzenle/sil/tepki/okundu/unread | `clientMsgId` idempotency, 60 mesaj/dk limit, silinen mesajın gövdesi gizlenir |
| `media` | multipart yükleme, liste, açıklama, sil, dosya servisi, albümler, depolama | MIME+boyut doğrulama, sharp ile 900px WebP küçük resim, uzay-üyeliği kontrollü dosya erişimi |
| `notes` | CRUD + revizyon geçmişi | İyimser sürümleme; çakışmada `409 + current` (sessiz ezme yok) |
| `interactions` | tanımlar, gönder, yanıtla, geçmiş | Sunucu tarafı cooldown → 429 + `Retry-After` |
| `letters` | liste/kutu/favori, taslak upsert, detay, gönder, okundu | `clientDraftId` idempotent, vektörel stroke doğrulama, taslak gizliliği (403) |
| `health`+konum | konum durumu/partner, sağlık örneği/partner | Paylaşım kapanınca koordinatlar silinir; adım tekilleştirme; stres reddi |
| `updates` | en yeni sürüm, APK indirme | `app_releases` tabanlı sürüm kontrolü |

### Android (5 sekme, gerçek veri)
Ortak katman: 40+ uçlu API istemcisi, **OkHttp WebSocket** (otomatik yeniden bağlanma, üstel bekleme, ping, `seq` telafisi), **kalıcı çevrimdışı kuyruk**.
Ekranlar: Ana · Mesajlar (canlı WS, kuyruk, yanıt/tepki/silme) · Mektuplar (filtreler, otomatik taslak, kâğıt seçimi, gönder/oku) · **S Pen çizim motoru** (basınç duyarlı, vektörel, silgi/fosforlu, geri al/yinele, çok sayfa) · Anılar (yükleme, ızgara, tam ekran, depolama) · Notlar (otomatik kayıt, çakışma diyaloğu) · Ayarlar (profil, davet, sunucu, cihazlar, saat rehberi).

## Oturum 3 Test Sonuçları

| Test | Sonuç |
|---|---|
| `tsc --noEmit` | ✅ hatasız |
| `npm test` (seri, gerçek PG 17) | ✅ **16/16** |
| Modül entegrasyonu | ✅ idempotency, 409+current, 429+Retry-After, taslak 403, stroke filtreleme, konum silme, adım tekilleştirme, stres reddi |
| **WebSocket canlı (2 istemci)** | ✅ 101; `message.new`/`interaction.new`/`letter.new`/`note.updated` anında iletildi |
| **Kopma telafisi** | ✅ 2 kaçırılan mesaj REST `events?since=` ile **2/2** yakalandı |
| Android derleme | ✅ BUILD SUCCESSFUL |
| Üretim | ✅ health 200, 401'ler doğru, WS geçersiz token → 4001, 8/8 migration |

## İlk oturum kaydı (Aşama 0–1)

### Aşama 0 — Keşif ve Tasarım ✅
- **Geliştirme ortamı doğrulandı:** Windows 11 + Git Bash; JDK 21 (Android Studio JBR), Android SDK (platforms 36, build-tools 36.1.0) `%LOCALAPPDATA%\Android\Sdk`; Node.js 24.13; Python 3.11 + paramiko; Gradle 8.14.3 (`C:\Users\Murat\tools`). Docker yok → imaj derlemesi Pi'de.
- **Sunucu doğrulandı (salt-okunur):** Raspberry Pi 5, Debian 13, 4 çekirdek/7,9 GB RAM (~3,3 GB müsait). CasaOS + Docker Compose v5.2.0; 16 konteyner. PostgreSQL 17.10 (`postgres_db`). Port haritası çıkarıldı → **8787** seçildi. Diskler: SD 14 GB boş, USB 8,7 GB boş (medya için kısıtlı — belgelendi).
- **Mimari kararlar** → `docs/ARCHITECTURE.md` (D-1..D-11): Node 24+TS+Fastify, mevcut PG'de `ahududu` DB, WS + uzay-başına seq olay kuyruğu, opak token auth (scrypt), dosya tabanlı medya + vektörel çizim, iki katmanlı güncelleme (config/APK), 8787.
- **Dokümantasyon seti:** AGENTS.md, README, ARCHITECTURE, ROADMAP, PROGRESS, DATABASE, API, MODULE_SYSTEM, UPDATE_SYSTEM, DEPLOYMENT, ANDROID_INSTALLATION, WEAR_OS_INSTALLATION, KNOWN_LIMITATIONS, TESTING (14 dosya).

### Aşama 1 — Temel Sistem (büyük bölüm ✅)
- **Başlatıcı ikonu:** `logo/ahududu_logo.png` her iki uygulamaya adaptive icon olarak entegre edildi (krem zemin + %50 ölçekli işaret; güvenli bölge ölçümüyle doğrulandı: maks. opak uzaklık 33.0dp ≤ sınır). Önizleme: `logo/icon_onizleme.png`. Monokrom (temalı ikon) katmanı dahil.
- **Backend (`server/`):** Fastify 5 + Node 24 doğrudan TS çalıştırma (erişilebilir sözdizimi). Modüller: auth (kurulum/davet/katılım/giriş/oturum/cihaz/alan), config (ETag'li), events (WS hub + seq + presence + REST yakalama), health. scrypt parola, rate limit (IP bazlı), Turkish hata mesajları, advisory-lock'lu kurulum yarış koruması.
- **Migration sistemi:** Bağımlılıksız koşucu (`schema_migrations` + `-- +Down` blokları). 8 migration: çekirdek kimlik, config/sürümler, mesajlaşma, medya/albüm, mektup (vektörel sayfa modeli), notlar (iyimser sürüm), etkileşimler, olaylar/konum/sağlık → 28 tablo.
- **Veritabanı (Pi):** `ahududu` + `ahududu_test` DB'leri ve en-az-yetkili `ahududu_app` rolü oluşturuldu (mevcut DB'lere dokunulmadı). Tablo-seviyesi izolasyon doğrulandı (`permission denied`).
- **Dağıtım (Pi):** `deploy/deploy.py` — paketle → SFTP → Pi'de `docker compose build` → başlat → health check. `ahududu-server` konteyneri sağlıklı çalışıyor; 8/8 migration üretim DB'sinde uygulandı; config tohumlandı.
- **Android (`android/`):** Tek Gradle reposu (`:app` telefon, `:wear` saat, `:common` paylaşımlı). Tasarım sistemi (pudra/mürdüm/krem palet, serif başlık, yumuşak şekiller). Gerçek kurulum akışı: karşılama → alan oluştur / davetle katıl / giriş → ana ekran (üyeler, davet kodu gösterimi) — hepsi gerçek API'ye bağlı (Ktor 3 + kotlinx.serialization). Saat: Data Layer üzerinden gerçek telefon bağlantı durumu. `install-wear.sh` kablosuz ADB betiği.

## Test Sonuçları (gerçek çıktılar)

| Test | Sonuç |
|---|---|
| `tsc --noEmit` (backend tip kontrolü) | ✅ hatasız |
| `npm test` — 14 birim testi | ✅ 14/14 (parola hash, token, davet kodu, migration yapısı, config şekli) |
| `npm test` — entegrasyon (gerçek PG 17) | ✅ 16 adımlık akış: kurulum→davet→katılım→oturum→yetki→çakışma→409/401/404/400 (keşfedilen ve düzeltilen 2 test hatası + 1 erişilebilir-sözdizimi hatası dahil) |
| Pi health check | ✅ `{"status":"ok","db":"up","version":"0.1.0"}` |
| Üretim güvenlik yoklamaları | ✅ yetkisiz→401, geçersiz gövde→400, WS geçersiz token→close 4001 |
| `./gradlew :app:assembleDebug :wear:assembleDebug` | ✅ BUILD SUCCESSFUL — app-debug.apk (com.ahududu.app v0.1.0, yalnız INTERNET izni), wear-debug.apk |
| DB izolasyonu | ✅ ahududu_app başka DB tablosu okuyamıyor |

Derleme sırasında çözülen kök nedenler (kayıt altında):
1. `hub.ts` constructor parametre özelliği → Node strip-only modu reddetti → açık alan atamasına çevrildi.
2. `murdum`/`krem` tema accent renklerinde eksik `#`; davet kodu alfabesinde karıştırılabilir `L` → düzeltildi, testler yakaladı.
3. `:app` modülü Ktor tiplerine erişiyordu → istemci kurulumu `:common`'a kapsüllendi (`AhududuApi.create`).

## Engeller / Riskler
- Pi çekirdeği cgroup kaynak limitlerini desteklemiyor → `mem_limit` etkisiz (belgelendi; tasarım zaten hafif).
- Medya için disk alanı sınırlı (bkz. `docs/KNOWN_LIMITATIONS.md`).
- Ev dışı anlık bildirim: FCM veya tünel kararı Aşama 4'te kullanıcıyla netleştirilecek.
- Gerçek cihaz testleri (S23/S24 Ultra/saatler) yapılmadı ⏳ — adb cihaz bağlı değil.

## Sıradaki Adımlar
1. Kilit açıldığında 5 sekmenin görsel doğrulaması (A05s ekranı şu an kilitli).
2. Mesajlaşmada fotoğraf/video eki UI'ı (backend hazır).
3. Konum paylaşım ekranı + izin akışları (Aşama 4).
4. Bildirim sistemi: kanallar, sessiz saatler, kategori kapatma (Aşama 4).
5. Wear OS uygulamasını gerçek işlevlerle genişletmek (Aşama 5).
6. `app_config` istemci önbelleği + tema uygulama; APK sürüm kontrolü UI'ı (Aşama 6).
