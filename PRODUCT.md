# Ahududu — Ürün Tanımı (PRODUCT.md)

## 1. Vizyon ve Amaç
Ahududu; Murat ve sevgilisi için özel olarak tasarlanmış, romantik, samimi ve teknik hiçbir karmaşıklık içermeyen ikili çift uygulamasıdır. 
Uygulama genel uygulama mağazalarında yayınlanmayacak, doğrudan çiftin kendi cihazlarında (Samsung Galaxy S23, Galaxy S24 Ultra, Samsung Watch 7 ve Watch Ultra) çalışacaktır.

Sunucu altyapısı Murat'ın evindeki Raspberry Pi 5 üzerinde, CasaOS ortamında Docker konteynerleri ve PostgreSQL veritabanı ile çalışır. Dış dünya erişimi Cloudflare Tunnel ile sağlanır.

## 2. Temel Hedef Kitle ve Kullanıcı Profilleri
- **Murat (Geliştirici & Partner):** Samsung Galaxy S23 & Samsung Watch Ultra.
- **Sevgilisi (Son Kullanıcı):** Samsung Galaxy S24 Ultra (S-Pen donanımlı) & Samsung Watch 7. Yazılımdan veya teknik detaylardan anlamaz; arayüz büyüleyici, tatlı, pürüzsüz ve sıfır çaba gerektiren bir sadelikte olmalıdır.

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
   - Dokunulduğunda sevgilinin telefonuna ve saatine anında özel kalp atışı titreşimleri, sesli bildirim ve ekranda uçuşan ahududu ve kalp efektleri gönderir.
   - Hızlı tatlı yanıt butonları ("Hemen geliyorum!", "Kocaman sarıldım", "Canım benim").

3. **Çift Sohbeti & Telsiz (Walkie-Talkie) / Sesli Notlar:**
   - Anlık WebSocket mesajlaşma.
   - Yüksek kaliteli fotoğraf ve video paylaşımı.
   - Bas-Konuş Telsiz (Walkie-Talkie): Butona basılı tutarak konuşulduğunda diğer tarafta anında sevimli bir telsiz sesiyle otomatik çalar.
   - Ortam sesi dinleme / kontrolü: Güvenli, karşılıklı rızaya dayalı anlık ses kontrolü.

4. **Ortak Galeri ve Anı Defteri:**
   - Fotoğraf & videolar için ortak albümler.
   - "Birlikte geçen günlerimiz" canlı sayaç.
   - Özel tarih ve anı zaman çizelgesi.

5. **Ortak Notlar & İstek Listesi:**
   - Beraber izlenecek dizi/filmler, gezilecek yerler, alışveriş ve romantik yapılacaklar listesi.
   - Canlı senkronizasyon ve tek dokunuşla işaretleme.

6. **Çift Radarı (Canlı Konum & Mesafe):**
   - Romantik harita görünümü ile sevgilinin anlık konumu, pil durumu ve "Aramızda X km var" göstergesi.
   - "Yanına Git" yol tarifi kısayolu.

7. **Uzaktan Titreşim (Remote Haptics):**
   - Kalp atışı, sarılma, öpücük ve acil ilgi titreşim desenlerini doğrudan partnerin telefonuna ve saatine iletme.

8. **Samsung Galaxy Watch Entegrasyonu (Watch 7 & Watch Ultra):**
   - Dairesel Wear OS ekranlarına tam uyumlu arayüz.
   - Anlık kalp atışı (BPM), adım sayısı ve stres seviyesi senkronizasyonu.
   - Saatten saate titreşim ve aşk animasyonları.
   - "Saate Kur" tek tıkla kurulum kılavuzu.
