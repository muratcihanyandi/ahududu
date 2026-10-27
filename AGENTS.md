# AGENTS.md — Ahududu Proje Talimatları

Bu dosya, Ahududu deposunda çalışan tüm yazılım ajanları ve geliştiriciler için bağlayıcı kuralları içerir. Global AGENTS.md ile birlikte okunur; çelişki durumunda güvenlik ve veri bütünlüğü kuralları önceliklidir.

## Projenin Amacı

Ahududu, birbirine ait iki kişinin özel kullanımı için tasarlanmış, ticari amaçlı olmayan bir dijital yaşam alanıdır: mektuplar (S Pen çizimli), mesajlaşma, ortak galeri, ortak notlar, romantik etkileşimler, konum ve saat (Wear OS) entegrasyonu. Hedef cihazlar:

- Samsung Galaxy S23 ve S24 Ultra (telefon uygulaması)
- Samsung Galaxy Watch 7 ve Watch Ultra (Wear OS uygulaması)
- Raspberry Pi 5, 8 GB RAM, CasaOS + Docker (sunucu, `192.168.2.170`)

Öncelik sırası: **Gerçek işlevsellik > veri bütünlüğü > kararlılık > kullanıcı deneyimi > görsel ayrıntılar.**

## Mimari Özet

Ayrıntılar `docs/ARCHITECTURE.md` içinde. Kısa özet:

- **Backend:** `server/` — Node.js 24 + TypeScript (erişilebilir sözdizimi, yerel TS çalıştırma), Fastify, WebSocket, PostgreSQL (`pg`), kendi SQL migration koşucusu. Docker ile Pi üzerinde çalışır.
- **Telefon:** `android/app` — Kotlin + Jetpack Compose, minSdk 31.
- **Saat:** `android/wear` — Kotlin + Wear Compose, minSdk 33.
- **Paylaşılan:** `android/common` — tasarım sistemi, DTO'lar, API istemcisi.
- **Veritabanı:** Pi üzerindeki mevcut `postgres_db` konteyneri içinde `ahududu` veritabanı + `ahududu_app` rolü (en az yetki).
- **Port:** Sunucu 8787 (HTTP + WebSocket). CasaOS üzerindeki diğer portlarla çakışmaz.
- **Medya:** `/DATA/AppData/ahududu/media` (SD kart; alan kısıtlı — bkz. `docs/KNOWN_LIMITATIONS.md`).

## Bağlayıcı Mimari Kurallar

1. Modüler monolit: `server/src/modules/<alan>/` yapısındaki modüller Fastify plugin olarak kaydedilir. Yeni mikro servis eklenmez.
2. Modüller birbirini yalnızca paylaşılan `lib/` katmanı ve açıkça tanımlı arayüzler üzerinden kullanır; başka bir modülün tablolarına doğrudan SQL yazmaz.
3. Tüm API uçları `/api/v1/` altında sürümlenir. Geriye dönük uyumluluk bozulacaksa yeni sürüm eklenir ve `docs/API.md`'de belgelenir.
4. Şema değişikliği yalnızca migration dosyasıyla yapılır. Çalışan veritabanında elle `ALTER/DROP` yapılmaz.
5. Büyük medya ve çizim içerikleri PostgreSQL'e gömülmez: medya dosyalara, çizimler vektörel JSONB (stroke verisi) olarak saklanır.
6. İstemci, sunucudan gelen `app_config` ile içerik/tema/özellik bayrağı güncellemelerini alır; yeni APK gerektiren değişiklikler `app_releases` üzerinden yönetilir. İki mekanizma karıştırılmaz.

## Kodlama Standartları

- Kotlin: idiomatik, coroutines + Flow, Compose-first; `ViewModel` + manuel DI (AppContainer). Gereksiz kütüphane eklenmez.
- TypeScript: erişilebilir sözdizimi (enum yok, `import type` kullanılır), `strict` mod, açık hata tipleri.
- Tanımlayıcılar ASCII. Kullanıcıya görünen metinler doğal Türkçe.
- Gizli bilgi kaynak koda, loglara veya dokümanlara yazılmaz. Yapılandırma `.env` / ortam değişkeni ile verilir (bkz. `server/.env.example`).

## Test Zorunlulukları

- Backend: her modül için `server/test/` altında node:test tabanlı testler. Migration'lar boş veritabanında çalıştırılıp geri alınabilir olmalı.
- Android: kritik iş mantığı (kuyruk, senkronizasyon, çizim modeli) birim testli; Compose ekranları için derleme + elle doğrulama.
- Bir özelliği tamamlanmış saymak için: UI + gerçek veri akışı + hata/boş durum + test + dokümantasyon. Göstermelik buton ve sahte veri yasak.
- Çalıştırılmayan test geçmiş olarak raporlanamaz.

## Kök Neden Analizi

Hata görünce semptomu gizleme: (1) yeniden üret, (2) logları ve ilgili kodu oku, (3) gerçek kaynağı bul, (4) en küçük doğru düzeltmeyi yap, (5) testleri tekrar çalıştır, (6) sonucu `docs/PROGRESS.md`'ye işle. Docker ortam değişkenleri, migration durumu, bağlantı adresleri ve sağlık kontrolleri her dağıtımdan sonra açıkça doğrulanır.

## Sunucu ve Kaynak Kuralları (Raspberry Pi 5)

- Pi'de ~3 GB boş RAM ve ~14 GB boş disk (SD) vardır. Ağır worker, sonsuz retry döngüsü, bellekte tam video yükleme yasak.
- Yükleme süreçleri: `deploy/` betikleriyle SSH üzerinden; mevcut CasaOS servislerine, konteynerlerine ve portlarına dokunulmaz.
- Yıkıcı komutlar (`docker system prune`, `DROP DATABASE`, volume silme) yasaktır; yalnızca `ahududu-*` kaynakları yönetilir.
- Medya depolama kotası ve yedekleme: `docs/DEPLOYMENT.md`.

## Uzun Süreli /goal Çalışma Yöntemi

- Her oturumda önce `docs/PROGRESS.md` okunur; "Sıradaki Adımlar" bölümünden devam edilir.
- Her anlamlı aşamadan sonra `docs/PROGRESS.md` güncellenir (yapılanlar, testler, engeller, sıradakiler).
- Yarım işler: çalışan sistem bozulmadan, eksik kısım `docs/ROADMAP.md` ve `docs/KNOWN_LIMITATIONS.md`'de işaretlenerek bırakılır.
- Teknik engel çıkan özellik durdurulmaz, engel belgelenir ve bağımsız özellikler sürer.
- Kullanıcıdan yalnızca gerçekten gerekli girdiler istenir (hesap, fiziksel cihaz, harici onay).

## Güvenlik

- Tüm uçlarda sunucu tarafı üyelik/yetki kontrolü (Bearer token + space üyeliği).
- Parolalar scrypt ile hashlenir; oturum tokenları DB'de hashli tutulur ve iptal edilebilir.
- Yüklenen dosyalarda MIME/boyut doğrulaması; API'de basit rate limit.
- Konum, sağlık ve mikrofon hassas özelliklerdir: yalnızca açık etkinleştirmeyle çalışır, izin akışları aşılmaz. Mikrofon yalnızca iki tarafın da görebildiği, açıkça başlatılan "sesli bağlantı" olarak tasarlanır (bkz. `docs/ARCHITECTURE.md`).
