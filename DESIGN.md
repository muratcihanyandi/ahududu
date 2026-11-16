# Ahududu — Tasarım Sistemi (DESIGN.md)

## 1. Tasarım Felsefesi ve Estetik Yönelim
Ahududu, standart şablon veya yapay zeka jeneriği (AI-slop) arayüzlerden tamamen uzaktır. Sıcak, dokunsal, romantik ve son derece zarif bir "modern romantizm" estetiği benimser.

- **Duygu:** Samimi, huzurlu, güvenli ve sevimli.
- **Karakter:** Ahududu meyvesinin zengin yakut tonları, kremsi çilekli süt yumuşaklığı ve nostaljik mektup kağıdının dokusu.
- **Son Kullanıcı Deneyimi:** Sıfır teknik kelime (IP, Port, Token, Sync, API gibi kelimeler ASLA arayüzde görünmez). Her şey "Bizim Dünyamız", "Mektubun Hazır", "Kalp Atışım", "Sana Sarıldım" gibi sıcak Türkçe ifadelerle sunulur.

## 2. Renk Paleti (Color Palette)
- **Primary / Velvet Raspberry:** `#BE185D` (Gövde aksanları, mühürler, ana düğmeler)
- **Deep Mulberry / Ruby Dark:** `#831843` (Vurgular, başlıklar)
- **Soft Berry Blush:** `#FDF2F8` (Ana arkaplan geçişleri, yumuşak kart dolguları)
- **Parchment Cream:** `#FFFDF7` (Mektup kağıdı, el yazısı tuvali)
- **Wax Seal Gold:** `#D97706` / `#F59E0B` (Mektup mührü, parlak yıldızlar)
- **Text Espresso Berry:** `#311425` (Okunabilir, sert olmayan sıcak koyu metin)
- **Text Muted Rose:** `#8E5268` (Yardımcı bilgiler, tarih etiketleri)

## 3. Tipografi
- **Başlık ve Ekran:** `Plus Jakarta Sans`, `Outfit` (Modern, yumuşak, sıcak ve son derece net okunabilir)
- **Romantik Mektup & El Yazısı:** `Caveat`, `Dancing Script` veya özel el yazısı kanvası
- **Gövde Metinleri:** 15px - 16px, 1.5 line-height, maksimum 65 karakter satır genişliği

## 4. Dokunsal Geri Bildirim (Haptics)
- **Kalp Atışı:** `[120, 100, 180, 800, 120, 100, 180]` (Gerçek çift atımlı nabız hissi)
- **Kelebek Dokunuşu:** `[50, 50, 50, 50, 100]`
- **İlgi Çağrısı:** `[250, 100, 250, 100, 400]`

## 5. İkonografi ve Mikro Etkileşimler
- Lucide Icons (özel yuvarlatılmış ve pembe-ahududu tonlarında renklendirilmiş)
- Canlı mühür kırma, uçuşan minik kalpler, S-Pen basınç eğrisi yumuşatması
- Yüzen navigasyon çubuğu (Pill bar): Ana sayfa, Mektuplar, Sohbet, Bahçe, Anılar.
  Sohbet ekranında bar yüzen değil, mesaj yazma alanına **yapışık** tam genişlik bar olur.
- Bildirimler: uygulama kapalıyken de gelen mesajlar için native arka plan servisi.

## 6. Yeni Modüllerin Görsel Dili

### Anlık Fotoğraf (Anlar)
- Ana renk: **Ahududu → Rose → Amber** geçişli canlı kart.
- Halka (ring) göstergesi: görülmemiş an varsa dönen amber-rose gradyan.
- Filtreler CSS ile: Normal, Gül, Canlı, Yumuşak, Siyah-Beyaz, Gün Batımı, Rüya.
- Tam ekran görüntüleyicide ilerleme çubukları, dokununca duraklat, tepki emojileri.

### Günlük
- Kağıt dokusu: `#fffdf7` zemin üzerine 30px yatay çizgiler (`.diary-paper`), sol kenarda defter sırtı (`.diary-margin`).
- El yazısı fontu (`Caveat`), sayfa çevirme animasyonu (`pageFlipIn`).
- Kilitli sayfa: gri zemin, kilit ikonu, "Bu sayfa sadece yazanına açık 🔒".

### Hayvan Albümü
- Kategori renkleri: kediler amber, köpekler ahududu, kuşlar sky, balıklar cyan, tavşanlar pink…
- Kartlar 4:5 oranında, fotoğraf yoksa emoji "zıplayan" animasyonla (`petBounce`).
- 4 sütunlu kategori ızgarası ve emoji paleti.

### Sinema Salonu
- Sıcak sinema karanlığı: `#2a0713 → #5c0a20 → #7f1030` geçişleri.
- Kenar perdeleri: dikey çizgili kırmızı gradyanlar; üst perde açılış animasyonu.
- Projektör ışığı: üstten koni gradyan + titreme (`projectorFlicker`).
- Sahne kenarı ışıkları ve koltuk siluetleri (`seatBob`).
- Altın perde çerçevesi: çift halka + dışa yayılan sıcak ışıma.
- Karakterler: koltuk rozetleri, "salonda 🍿" / "salonda değil" durumu, yeşil/gri nokta.
- Başlık: `cinematicIn` (harf aralığı daralan) animasyonu.
- Tepki emojileri `floatUp` ile perde üzerinde yükselir.

## 7. Haptik ve Ses
- An paylaşma: `HAPTIC_PATTERNS.butterfly` (kelebek dokunuşu) + aşk çıngırağı.- Günlük yazma: kısa dokunma titreşimleri; kaydetmede 30 ms.
- Sinema: film başlarken `attention` deseni, tepki gönderirken 15 ms, duraklat/oynat 15 ms.
