# Ahududu Yol Haritası

Aşamalar ve kabul kriterleri. Bir aşama ancak tüm kriterleri doğrulanınca tamamlanmış sayılır. Durum güncellemeleri `docs/PROGRESS.md`'de izlenir.

## Aşama 0 — Keşif ve Tasarım ✅
- [x] Geliştirme ortamı incelendi (JDK 21 JBR, Android SDK 36, Node 24, SSH/paramiko)
- [x] Pi ve CasaOS incelendi (konteynerler, portlar, diskler, PostgreSQL 17)
- [x] Mimari kararlar alındı (`docs/ARCHITECTURE.md`)
- [x] Proje yapısı, AGENTS.md, dokümantasyon iskeleti kuruldu
- [x] Zor konular araştırıldı ve belgelendi (APK güncelleme, Wear kurulumu, sağlık verileri, bildirim, dağıtım)

## Aşama 1 — Çalışan Temel Sistem
- [x] Backend: health endpoint, config servisi, migration koşucusu, hata işleme
- [x] `ahududu` veritabanı + `ahududu_app` rolü (Pi, mevcut postgres_db içinde)
- [x] Auth: alan oluşturma, davet kodu, katılma, oturum tokenları, cihazlar
- [x] WebSocket kanalı + olay sırası (seq) + REST olay yakalama
- [x] Docker Compose ile Pi'de dağıtım; sağlık kontrolü; başlangıçta migration
- [ ] Android: proje iskeleti derleniyor; tasarım sistemi temeli; kurulum/oturum akışı (UI + gerçek API)
- [ ] İki farklı cihaz/simülasyonda iki kullanıcı bağlanabiliyor
- [x] Testler: auth API testleri, migration testi, Android birim testleri

## Aşama 2 — Mesajlaşma ve Ortak İçerikler
- [x] Mesajlaşma: gönderim, geçmiş, ek, tepki, yanıt, okundu, silme/geri çekme
- [x] Çevrimdışı kuyruk + yeniden gönderme + tekrar önleme (client_msg_id)
- [x] Medya yükleme (görsel/video), küçük resim, tam ekran görüntüleyici
- [x] Ortak galeri + albümler + favoriler
- [x] Ortak notlar: otomatik kaydetme, sürüm/çakışma çözümü, kontrol listeleri
- [ ] Testler: mesaj idempotency, dosya doğrulama, not çakışması, senkronizasyon

## Aşama 3 — Mektuplar ve Romantik Etkileşimler
- [x] Mektup editörü: taslak otomatik kaydetme, kâğıt seçenekleri, gönderme/okuma
- [x] S Pen çizim motoru: vektörel stroke, renk/kalınlık/silgi/geri al, sayfa modeli
- [ ] Mektup animasyonları (zarf/kâğıt), favoriler, ekler
- [x] İlgi isteme + kalp/öpücük/sarılma etkileşimleri, bildirim + uygulama içi animasyon
- [x] Rate limit (spam koruması)
- [ ] Gerçek cihazda doğrulanacaklar listesi (S Pen basınç, titreşim, animasyon performansı)

## Aşama 4 — Cihaz Özellikleri
- [ ] Karşılıklı konum: izin akışları, açık/kapalı paylaşım, harita, güncellik göstergesi
- [ ] Telefon titreştirme: desenler (kısa/uzun/kalp atışı), rate limit
- [ ] Bildirim kanalları, kategori bazlı kapatma, sessiz saatler
- [ ] FCM kararı: kullanıcıyla Firebase projesi netleştirilir; uygulanırsa entegrasyon
- [ ] "Sesli Bağlantı" mikrofon araştırması ve varsa açık-onaylı uygulaması
- [ ] Ev dışı erişim: tünel kurulumu (kullanıcı eylemi) + çift URL desteği

## Aşama 5 — Wear OS
- [ ] `:wear` uygulaması: ana ekran, kalp/mesaj etkileşimi, bağlantı durumu
- [ ] Data Layer ile telefon köprüsü; saat↔sunucu etkileşim akışı
- [ ] Health Services: kalp atışı (MeasureClient) + adım (PassiveMonitorClient), izin akışları
- [ ] Saat titreşimi, özel animasyonlar, pil bilinçli okuma stratejisi
- [ ] Stres verisi: desteklenmediği belgelendi; UI'da sahte veri yok
- [ ] ADB kablosuz kurulum betikleri + `docs/WEAR_OS_INSTALLATION.md`

## Aşama 6 — Güncelleme ve Kararlılık
- [ ] `app_config` düzenleme akışı (yönetim uçları/araç) + istemci önbellek tazeleme
- [ ] APK sürüm kontrolü, indirme + kullanıcı onaylı kurulum akışı
- [ ] Eski istemci uyumluluk testleri (config şema sürümü)
- [ ] Yedekleme/geri yükleme betikleri ve belgesi; sağlık kontrolleri; kaynak sınırları

## Aşama 7 — Teslimat
- [ ] İmzalı telefon + saat APK'ları, kurulum kılavuzları
- [ ] Tam dokümantasyon seti güncel, sınırlamalar listesi net
- [ ] Son entegrasyon ve regresyon testleri
