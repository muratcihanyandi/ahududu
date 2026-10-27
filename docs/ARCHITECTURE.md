# Ahududu Mimarisi

Bu belge Aşama 0'da alınan mimari kararları, gerekçelerini ve alternatifleri içerir. Karar değişiklikleri buraya işlenir.

## 1. Genel Yapı

```
[Galaxy S23]  ──┐                        ┌── PostgreSQL 17 (postgres_db, mevcut)
                ├─ HTTPS/WS ──► [ahududu-server (Docker, Pi, :8787)]
[Galaxy S24 U] ─┤                        └── /DATA/AppData/ahududu/media (dosya depolama)
                │
[Watch 7/Ultra] ─┴─ Wear OS Data Layer ──► telefon uygulaması (ağ köprüsü)
```

- **Modüler monolit backend** tek Docker konteyneri; veritabanı ve dosya depolama konteyner dışında.
- Telefon uygulaması sunucuyla doğrudan konuşur (REST + WebSocket).
- Saat uygulaması varsayılan olarak telefon üzerinden Data Layer API ile iletişir; ağ mantığı telefonda. (Saat Wi-Fi'da doğrudan da bağlanabilir; Aşama 5'te değerlendirilir.)

## 2. Alınan Kararlar ve Gerekçeler

### D-1: Backend = Node.js 24 + TypeScript + Fastify

**Alternatifler:** Kotlin+Ktor (tek dil), Go (en düşük kaynak), Python FastAPI.

**Seçim gerekçesi:**
- Pi'de düşük bellek ayak izi (~120–180 MB; JVM ~300+ MB, Immich-ML zaten RAM'in büyük kısmını kullanıyor; Pi'de ~3,3 GB müsait).
- Güncelleme mimarisinin temeli olan JSON tabanlı modül/yapılandırma sistemi dinamik dilde doğal.
- Geliştirme makinesinde Node 24 mevcut; Node 24 tür silme (erasable type stripping) ile `.ts` dosyalarını derleme adımı olmadan çalıştırır → derleme zinciri basit, sürüm kaymaları olmaz.
- Sözleşme: yalnızca *erişilebilir* TS sözdizimi (enum/namespace yok), `tsc --noEmit` ile tip kontrolü, `node:test` ile testler.

**Kısıtlar:** Yerel modüllerde (sharp) ARM64 prebuild gerekliliği → `node:24-slim` (Debian/glibc) imajı kullanılır.

### D-2: Veritabanı = mevcut PostgreSQL 17 örneği üzerinde yeni `ahududu` DB + rol

**Alternatifler:** Ayrık postgres konteyneri; SQLite.

**Seçim gerekçesi:** Kullanıcının kurulumu (CasaOS `postgres_db`, `192.168.2.170:5432`, `muratcihanyandi` superuser) zaten çalışıyor ve LAN'da erişilebilir; ikinci örnek RAM/israf. SQLite, eşzamanlı yazma + sunucu tarafı yetkilendirme ihtiyaçları için yetersiz.
- `ahududu_app` rolü yalnızca `ahududu` veritabanına yetkilidir (CONNECT/USAGE/CREATE). Migration'lar ayrı yönetici bağlantısıyla çalışır.
- Backend konteyneri DB'ye host IP üzerinden bağlanır (5432 zaten 0.0.0.0'a yayınlanmış; yeni port açılmaz).

### D-3: Gerçek zamanlı iletişim = WebSocket (`/ws`)

Kimliği doğrulanmış istemciler tek uzayın (space) kanalına abone olur. Olay türleri: `message.new`, `letter.new`, `interaction.new`, `note.updated`, `media.new`, `presence`, `location.updated`, `health.updated`. Olay zarfı: `{type, payload, seq, server_ts}` — `seq` uzay başına monoton artan sıra numarası; istemci bağlantı sonrası `last_seq` göndererek kaçırılan olayları REST `GET /api/v1/events?since=<seq>` ile çeker. Bu, WS kopmalarında veri kaybını önler ve tekrar/atlama sorunlarını çözer.

**Alternatif:** SSE + POST. WebSocket çift yönlü (typing göstergeleri, presence ping) için daha uygun.

### D-4: Oturum yönetimi = opak cihaz tokenları

İki kullanıcılı özel sistem için OAuth/JWT aşırı mühendislik. Uzun ömürlü, cihaza bağlı, iptal edilebilir opak token (32 bayt rastgele; DB'de `sha256` hash'i; 180 günlük kayan süre). Parolalar `scrypt` (N=2^15, r=8, p=1) + rastgele tuz ile hashlenir. `Authorization: Bearer` başlığı + her istekte space üyeliği doğrulaması.

### D-5: Medya = dosya sistemi + metadata PostgreSQL'de

- Orijinal dosya: `media/<yy>/<id>.<ext>`; küçük resim `media/thumbs/<id>.webp` (sharp).
- Video dönüştürme Aşama 0–2'de yapılmaz (kaynak zaten telefon codec'i; Pi CPU'su korunur). Video küçük resmi ilk kare ffmpeg ile (imaja ffmpeg eklenir) — uygulanmazsa `docs/KNOWN_LIMITATIONS.md`'de işaretlenir.
- Çizimler: **vektörel JSONB stroke modeli** (`{tool,color,width,points:[[x,y,pressure]]}`) + okuma/listeleme için PNG önizlaması. Raster'i tek kaynak yapmak yasak (yeniden düzenleme ve kalite kaybı).

### D-6: Güncelleme mimarisi = iki katman

1. **Yapılandırma katmanı (APK gerektirmez):** `app_config` tablosunda sürümlü JSONB belge (temalar, mektup şablonları, etkileşim tanımları, özellik bayrakları, metinler). `GET /api/v1/config` ETag ile; istemci diske önbellekler, çevrimdışı çalışır. Ayrıntı: `docs/MODULE_SYSTEM.md`, `docs/UPDATE_SYSTEM.md`.
2. **APK katmanı:** `app_releases` tablosu + imzalı APK dosyaları. İstemci `GET /api/v1/app/latest?platform=phone` ile `versionCode` karşılaştırır, indirme bildirimi gösterir, kurulumu Android paket kurulum akışıyla kullanıcı onayına bırakır. Sessiz/gizli kurulum denenmez.

### D-7: Bildirimler = üç modlu tasarım

1. **Uygulama açık:** WebSocket anında.
2. **Yerel ağ + arka plan:** "Canlı bağlantı" ön plan servisi (kalıcı bildirimli WebSocket) — kullanıcı ayarı.
3. **Uzaktan itme (ev dışı):** FCM entegrasyonu *isteğe bağlı modül* olarak tasarlanır (Firebase projesi kullanıcı hesabı gerektirdiğinden Aşama 4'te kullanıcıyla netleştirilir). Sunucu, bildirim dağıtıcı arayüzü arkasında FCM/WebSocket/no-op implementasyonlarını değiştirilebilir tutar.

Ev dışı erişim: sunucu URL'si ikili yapılandırılabilir ("ev" = `http://192.168.2.170:8787`, "dışarısı" = tünel). Kullanıcının mevcut altyapısında Cloudflare Tunnel deseni zaten kurulu (fakeyol/nodehaber örnekleri); Ahududu için de aynı desen uygulanabilir. Alternatif: Tailscale (hiçbir public exposure yoktur). Her ikisi de belgelendi; karar kullanıcıya bırakıldı, uygulama iki URL'li tasarımı destekler.

### D-8: Android mimarisi

- Tek Gradle deposu: `:app`, `:wear`, `:common`. Sürümler: Gradle 8.14, AGP 8.13, Kotlin 2.2, compileSdk 36, minSdk 31 (telefon) / 33 (saat).
- Manuel DI (AppContainer), MVVM (ViewModel + StateFlow), Compose Navigation.
- Ağ: Ktor client 3 + kotlinx.serialization; Kimlik: DataStore; Yerel önbellek/kuyruk: Room (KSP).
- S Pen çizimi: kendi vektörel çizim motoru (`Canvas` + `PointerInput`, `MotionEvent` pressure/tilt) — S Pen SDK'sine bağımlılık yok; SDK'nın sağladığı ek avantajlar araştırılıp Aşama 3'te değerlendirilir.
- Sağlık verisi: Wear OS Health Services (PassiveMonitorClient/MeasureClient) — kalp atışı ve adım. Stres: Samsung'un üçüncü taraflara kapalı verisidir → **desteklenmiyor**, sahte veri üretilmez (bkz. `docs/KNOWN_LIMITATIONS.md`).

### D-9: Mikrofon / ses özelliği

Gizli dinleme yok. Yalnızca iki tarafın da arayüzünde görünür, açıkça başlatılan/durdurulan **"Sesli Bağlantı"** modülü olarak tasarlanır: mikrofonu açan taraf ön plan servisi + kalıcı bildirim + ekran göstergesiyle başlatır; ses WebSocket üzerinden Opus/WebM segmentleriyle iletilir; kayıt yapılmaz. Aşama 4'te ayrı araştırma konusudur; uygulanabilirlik doğrulanana kadar UI'da yer almaz.

### D-10: Sunucu portu = 8787

Pi'de taranan dolu portlar: 80, 1478, 2283, 2368–2371, 2375, 5432, 5678, 8000, 8100, 8123, 8443, 25500–25600, 33464–33465. 8787 boş ve kolay hatırlanır.

### D-11: Depolama yerleşimi (Pi)

- DB: mevcut `postgres_db` (verisi `/DATA/AppData/postgres_server/pgdata`).
- Medya: `/DATA/AppData/ahududu/media` (SD kart, ~14 GB boş). USB diskte (`/mnt/usb`, ~8,7 GB boş) yer daha da az. → Depolama kotası, yükleme limitleri (görsel 25 MB, video 200 MB varsayılan) ve ileride büyük disk takılması önerisi dokümante edildi. Yol, compose dosyasında yapılandırılabilir.

## 3. Modül Sınırları (backend)

| Modül | Sorumluluk | Tablolar |
|---|---|---|
| `auth` | kayıt, oturum, token, cihaz | users, sessions, devices |
| `space` | uzay, davet, üyelik | spaces, invites, space_members |
| `config` (updates) | app_config, sürüm, ETag | app_config |
| `messaging` | mesaj, ek, tepki, makbuz | messages, message_*, |
| `letters` | mektup, sayfa, çizim, favori | letters, letter_* |
| `media` | yükleme, küçük resim, albüm | media_assets, albums, album_items |
| `notes` | not, sürüm, çakışma çözümü | notes, note_revisions |
| `interactions` | ilgi isteği, kalp/öpücük vb., rate limit | interactions |
| `health` | kalp/adım örnekleri | health_samples |
| `location` | konum durumu/geçmişi | location_status, location_pings |
| `events` | WS hub, seq, olay geçmişi | events |

Modüller arası haberleşme yalnızca `lib/` hizmetleri (db, events, auth-guard) üzerinden. Modül, başka modülün tablosuna yazamaz.

## 4. Bilinçli Olunan Kısıtlar

- Windows geliştirme makinesinde Docker yok → imaj derlemesi Pi üzerinde yapılır (kaynak kopyalanır, `docker compose build` Pi'de çalışır).
- Geliştirme sırasında doğrudan Pi PostgreSQL'i kullanılır (yeni, boş `ahududu` DB'si — henüz üretim verisi yok). İlk gerçek veri oluşmadan ayrı geliştirme DB'si şart değildir; durum `docs/PROGRESS.md`'de izlenir.
- Wear kurulumu Play Store dışından ADB (kablosuz) ile yapılır; telefon saate otomatik kurulum yapamaz (bkz. `docs/WEAR_OS_INSTALLATION.md`).
