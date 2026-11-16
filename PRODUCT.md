# Ahududu — Ürün Tanımı (PRODUCT.md)

## 1. Vizyon ve Amaç
Ahududu; Murat ve sevgilisi için özel olarak tasarlanmış, romantik, samimi ve teknik hiçbir karmaşıklık içermeyen ikili çift uygulamasıdır. 
Uygulama genel uygulama mağazalarında yayınlanmayacak, doğrudan çiftin kendi cihazlarında (Samsung Galaxy S23, Galaxy S24 Ultra) çalışacaktır.

Sunucu altyapısı Murat'ın evindeki Raspberry Pi 5 üzerinde, CasaOS ortamında Docker konteynerleri ve PostgreSQL veritabanı ile çalışır. Dış dünya erişimi Cloudflare Tunnel ile sağlanır.

## 2. Temel Hedef Kitle ve Kullanıcı Profilleri
- **Murat (Geliştirici & Partner):** Samsung Galaxy S23.
- **Sevgilisi (Son Kullanıcı):** Samsung Galaxy S24 Ultra (S-Pen donanımlı). Yazılımdan veya teknik detaylardan anlamaz; arayüz büyüleyici, tatlı, pürüzsüz ve sıfır çaba gerektiren bir sadelikte olmalıdır.

## 3. Mimari ve "Sıfır Yeniden Kurulum" Prensibi
- **Tek Seferlik Kurulum:** APK her iki telefona sadece bir defa kurulur (Native Shell / Capacitor).
- **Canlı Güncelleme (Live OTA / Instant Web Shell):** Murat projeye yeni bir özellik ekleyip GitHub'a pushladığında ve Pi'ye deploy ettiğinde, sevgilisinin uygulamasında özellikler anında ve otomatik olarak görünür. Sevgilisine tekrar tekrar APK gönderme ihtiyacı tamamen ortadan kaldırılmıştır.
- **Tek Port Kolaylığı:** Sunucu hem WebSocket/API ağ geçidini hem de statik web/mobil arayüzü tek bir port (`33470`) üzerinden sunar; CasaOS ve Cloudflare Tunnel konfigürasyonu çocuk oyuncağıdır.

## 4. Temel Özellikler
1. **Romantik Mektup Bölümü:**
   - S24 Ultra S-Pen kalemi ile gerçek kağıt hissiyle çizim ve el yazısı tuvali (basınç hassasiyeti, yumuşak çizgiler, renk ve fırça seçenekleri).
   - Daktilo/Romantik font ile yazılmış metin mektupları.
   - Gerçekçi 3D balmumu mühürleme (Wax Seal) ve mühür kırma animasyonu.
   - Sonsuza dek saklanan "Mektup Kutumuz" arşivi.

2. **İlgi İsteme Butonu ("Beni Sev!"):**
   - Ana ekranda sevimli, interaktif ilgi butonu.
   - Dokunulduğunda sevgilinin telefonuna anında özel kalp atışı titreşimleri, sesli bildirim ve ekranda uçuşan ahududu ve kalp efektleri gönderir.
   - Hızlı tatlı yanıt butonları ("Hemen geliyorum!", "Kocaman sarıldım", "Canım benim").

3. **Çift Sohbeti / Sesli Notlar:**
   - Anlık mesajlaşma.
   - Yüksek kaliteli fotoğraf, video ve sesli mesaj paylaşımı.
   - Sohbet ekranı TAM EKRAN ve WhatsApp düzenindedir: başlık uygulama başlığına,
     mesaj yazma alanı alt navigasyona yapışıktır; yalnızca mesaj listesi kayar.
   - Sesli mesaj iki modda: basılı tut → bırak → otomatik gönder; tek dokunuş →
     süre + iptal + gönder. Sola sürükleyip bırakınca kayıt iptal olur.
   - Sade başlık: "Selin" (kişi adı), canlı bağlantı göstergesi.

4. **Ortak Galeri ve Anı Defteri:**
   - Fotoğraf & videolar için ortak albümler.
   - "Birlikte geçen günlerimiz" canlı sayaç.
   - Özel tarih ve anı zaman çizelgesi.

5. **Ortak Notlar & İstek Listesi:**
   - Beraber izlenecek dizi/filmler, gezilecek yerler, alışveriş ve romantik yapılacaklar listesi.
   - Canlı senkronizasyon ve tek dokunuşla işaretleme.

6. **Neredeyiz? (Canlı Konum & Mesafe):**
   - Romantik harita görünümü ile sevgilinin anlık konumu, pil durumu ve "Aramızda X km var" göstergesi.
   - "Yanına Git" yol tarifi kısayolu.

7. **Bildirimler (uygulama kapalıyken de):**
   - Telefonda arka planda çalışan bildirim servisi; uygulama tamamen kapalıyken bile mesaj,
     mektup, an, sinema daveti, bilet ve ilgi çağrısı bildirimi gelir.
   - Bildirime dokununca uygulama sohbetle açılır; uygulama açıkken gereksiz bildirim yoktur.

8. **Uzaktan Titreşim (Remote Haptics):**
   - Kalp atışı, sarılma, öpücük ve acil ilgi titreşim desenlerini doğrudan partnerin telefonuna iletme.

9. **Anlık Fotoğraf (Anlar):**
   - "Şu an ne yapıyorum" kareleri; 24 saat sonra kendiliğinden kaybolur.
   - Kamera/galeri, filtreler, duygu etiketi, görüldü bilgisi ve anlık tepki emojileri.

10. **Günlük (Bizim Defterimiz):**
   - Ortak anı defteri: başlık, ruh hali, yıldız puanı, hava, fotoğraf.
   - Kilitli (yalnızca yazanın gördüğü) sayfalar, gün serisi istatistikleri, sayfa çevirme animasyonu.

11. **Hayvan Albümü:**
    - Her hayvana isim + kategori (kedi, köpek, kuş, balık, tavşan, hamster, kaplumbağa, sürüngen, at, diğer).
    - Cins, yaş, hikâye, sevimli notlar, sahiplik, favori ve her hayvana özel fotoğraf galerisi.
    - Kategori normalizasyonu: `köpek` / `kopek` / `Köpek` aynı kategoriye düşer.

12. **Sinema Salonu — Takvim + Birlikte İzleme (Büyük Güncelleme):**
    - **Sinema takvimi:** O ayın yayın programı beyaz perde gibi şık bir takvimde. Murat ya da Selin elle film ekleyebilir;
      OpenClaw "sinema takvimini ayarla" dediğinde bütün ayı tek istekle kurabilir (`/api/cinema/calendar/import`).
    - Herhangi bir siteden video (YouTube, Vimeo, Dailymotion, Bilibili, Twitch, ok.ru, Streamable, .mp4/.m3u8) veya telefondan dosya.
    - Uygulamadan "bilet alınır" (gerçek bilet değil, ortak rezervasyon + bilet kodu). Bilet olmadan salona girilmez.
    - Seans saatinde salona girilir; telefon otomatik yataya döner, animasyonlu sinema salonu açılır.
    - **Senkron izleme:** oynat/duraklat/sarma WebSocket ile anında; sunucu konumu kaydeder, katılan kişi aynı saniyeden devam eder.
    - **Salona giriş bildirimi:** partnerin sinemaya girdiği anda bildirim gelir; Ahududu durumu "Sinemada 🍿" olur.
    - Karakterler (🐻 Murat / 🌸 Selin) perdenin iki yanında görünür.
    - ❤️😂😱😍🍿 tepkileri iki tarafta da uçar; "Tam ekran" ile salon tam ekrana geçer.
    - Film izlerken otomatik güncelleme yenilemesi ertelenir; film bölünmez.

13. **Kullanım Kolaylıkları:**
    - **Android geri tuşu:** Açık pencereyi kapatır, sonra ana ekrana döner, en sonda uygulamayı arkaya alır — uygulamadan çıkarmaz.
    - **Sabit sohbet ekranı:** Başlık ve mesaj yazma alanı sabit; yalnızca mesaj listesi kayar.
    - **Sade başlıklar:** "Selin ile Sohbet" yerine yalnızca kişi adı.
    - **Ana sayfa:** "Biz" sekmesi "Ana sayfa" oldu; pil göstergeleri küçük rozetlere indirildi, durum cümlesi,
      birlikte geçen gün sayısı ve hızlı erişim kartları öne çıktı.
    - **Teknik kelime yok:** Arayüzde teknik terim (API, OpenClaw, format listeleri vb.) görünmez.

14. **Navigasyon:** Alt bar her zaman 5 tuş — **Ana sayfa · Mektuplar · Sohbet · Bahçe · Anılar**.
    Sinema ve Çift Radarı ana sayfa ve "Anılar" sekmesinden açılır.

15. **Anı Bahçesi (demo):** Günün Sorusu, Zaman Kapsülleri, Bizim Şarkılarımız, Yıllar Önce Bugün,
    Duygu Havası — hepsi DEMO etiketiyle. (My Bibi uygulamasından ilham alınmıştır.)
