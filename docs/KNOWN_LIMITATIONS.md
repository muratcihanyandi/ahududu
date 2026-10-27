# Bilinen Sınırlamalar

Dürüst durum listesi. Bir özellik "çalışıyor" denmeden önce burası okunur. Maddeler kaldırıldıkça PROGRESS.md'ye işlenir.

## Altyapı

- **Kaynak limiti zorunlu değil:** Pi çekirdeği cgroup bellek/İŞLEM sınırlarını desteklemiyor (`mem_limit: 512m` Docker tarafından "Limitation discarded" uyarısıyla yok sayılıyor). Backend tasarımı zaten hafif (tek process, kuyruksuz); kalıcı çözüm istenirse çekirdek açılış satırına `cgroup_enable=memory cgroup_memory=1` eklenir (kullanıcı kararı — sistem açılış yapılandırması değişikliği).
- **Veritabanı izolasyonu (doğrulanmış):** `ahududu_app` rolü diğer veritabanlarına CONNECT yapabilir (PostgreSQL PUBLIC varsayılanı; geri alınması diğer servisleri etkileyebilir) ancak **hiçbir tabloyu okuyamaz/yazamaz** — gerçek veri sınırı tablo seviyesinde doğrulandı (`permission denied`). Bu, PostgreSQL'in standart duruşudur.
- **Sunucu disk alanı:** Medya dizini SD kartta (~14 GB boş); USB diskte ~8,7 GB boş. Fotoğraf/video biriktikçe dolacak. Yükleme limitleri (görsel 25 MB, video 200 MB) + depolama göstergesi uygulanır; kalıcı çözüm daha büyük bir disk takılması (kullanıcı eylemi).
- **RAM:** Pi'de ~3,3 GB müsait (Immich ML en büyük tüketici). Backend ağır medya dönüşümleri yapmaz; video transcode yok.
- **Video dönüştürme yok:** Videolar orijinal haliyle saklanır (telefon codec'i zaten uyumlu). Video küçük resmi henüz üretilmiyor.
- **Geliştirme makinesinde Docker yok:** İmaj derlemesi Pi üzerinde yapılır.
- **Geliştirme veritabanı = üretim veritabanı:** Yeni ve boş `ahududu` DB'si üzerinde geliştiriliyor; testler ayrı `ahududu_test` DB'sini kullanıyor. İlk gerçek veriler oluştuğunda bu durum yeniden değerlendirilir.

## Bildirim ve Erişim

- **Ev dışı itme bildirimi:** Yerel ağda WS + ön plan servisi çalışır. Ev dışında anlık bildirim; FCM (kullanıcının Firebase projesi açmasını gerektirir — Aşama 4 kararı) veya tünel + ön plan servisi ile sağlanır. Tünel kurulmadan ev dışında arka plan bildirimi garantisi yoktur.
- **TLS:** Yerel ağta düz HTTP planlanıyor (özel LAN). Tünel üzerinden erişimde TLS tünel sağlayıcı tarafından sonlanır. İstemci, tünel URL'si için düz HTTP'ye izin vermez.

## Wear OS / Samsung

- **Stres verisi:** Samsung Health'ın stres ölçümü üçüncü taraf uygulamalara kapalıdır (Health Services ve Health Connect'te yoktur). Bu yüzden uygulama stres göstermez; sahte/elde-türetilmiş puan üretilmez. "Beklemede modül" olarak tanımlı.
- **Saat kurulumu ADB gerektirir:** Play Store dışı dağıtımda telefona otomatik saat kurulumu mümkün değildir (bkz. `docs/WEAR_OS_INSTALLATION.md`).
- **Kalp atışı:** Health Services `MeasureClient` anlık ölçüm ister; sürekli arka plan ölçümü pil/kısıtlama nedeniyle yapılmaz. Değerlerde ölçüm zamanı ve güncellik gösterilir.

## Android

- **S Pen:** Temel çizim standart `PointerInput`/pressure ile çalışır; S Pen SDK'ya özgü gelişmiş özellikler (ör. hava hareketleri) araştırılmadı.
- **Mikrofon ("Sesli Bağlantı"):** Aşama 4 araştırma konusu; uygulanana kadar arayüzde yer almaz. Gizli dinleme tasarımın parçası değildir.
- **APK güncellemeleri:** Kullanıcı onayı ve Android kurulum ekranı atlanamaz; bu bilinçli bir sınırdır.

## Test Kapsamı

- Backend: 15 test (14 birim + 1 entegrasyon) gerçek PostgreSQL 17 üzerinde geçti ✅ (2026-10-26).
- Android: `:app`, `:wear`, `:common` derlemeleri başarılı ✅; ancak **gerçek cihaz veya emülatör testi henüz yapılmadı** — kurulum/giriş ekranının cihaz davranışı doğrulanmayı bekliyor ⏳.
- Sunucu: sağlık kontrolü, yetkisiz istek reddi, doğrulama hataları ve WebSocket el sıkışması üretime karşı doğrulandı ✅.
- Gerçek zamanlı senaryoların (WS kopma/yeniden bağlanma) otomatik testleri Aşama 2'ye planlandı.
