# 🍓 Ahududu — Bizim Dünyamız

Murat ve Sevgilisi için özel olarak geliştirilmiş, romantik, samimi ve teknik karmaşıklıktan tamamen arındırılmış çift uygulaması.

---

## 📱 Cihaz Desteği
- **Samsung Galaxy S24 Ultra:** S-Pen donanımı ile gerçekçi el yazısı ve çizim desteği, aşk mektupları tuvali, basınç hassasiyeti.
- **Samsung Galaxy S23:** Canlı konum, ilgi çağırma, çift sohbeti, sesli telsiz, ortak galeri ve notlar.
- **Samsung Galaxy Watch 7 & Samsung Watch Ultra:** Dairesel Wear OS ekranına özel arayüz, gerçek zamanlı nabız (BPM), adım ve stres takibi, uzaktan kalp atışı titreşimi, saate özel aşk animasyonları.

---

## ✨ Öne Çıkan Özellikler

### 1. 💌 Balmumu Mühürlü Romantik Mektuplar & S-Pen Tuvali
- **S-Pen El Yazısı:** Sevgilinizin S-Pen kalemi veya parmağıyla doğrudan kağıda çizebileceği, basınç hassasiyetli tuval.
- **Daktilo Yazısı:** Özel romantik fontlarla dökülen kalpten hisler.
- **Nostaljik Kağıt Temaları:** Parşömen kağıdı, Gül pembesi, Gece göğü, Lavanta.
- **3D Balmumu Mühür:** Mektup gönderilirken balmumu ile mühürlenir. Karşı taraf açtığında mühür kırılır ve konfeti efekti ile açılır!

### 2. 💖 "Beni Sev!" / İlgi İsteme Butonu
- Ana ekranda dev, sevimli, zıplayan interaktif ilgi butonu.
- Dokunulduğunda sevgilinizin telefonunda ve saatinde özel kalp atışı titreşimleri üretir (`[120, 100, 180, 800, 120, 100, 180]`).
- Hızlı yanıtlar: "Hemen geliyorum!", "Kocaman sarıldım", "Canım benim".

### 3. 📻 Bas-Konuş Telsiz (Walkie-Talkie) & Çift Sohbeti
- Butona basılı tutarak konuşulduğunda, sevgilinizin telefonunda anında şirin bir telsiz sesiyle ("Bip!") otomatik çalar.
- Fotoğraf ve yüksek kaliteli video paylaşımı.

### 4. 🧭 Çift Radarı & Mesafe Takibi
- Aranızdaki gerçek mesafeyi kilometre cinsinden gösterir ("Aramızda 3.2 km var 💕").
- Her iki telefonun pil durumu ve şarj bilgisi.
- "Yanına Yol Tarifi Al" tek tık Google Maps bağlantısı.
- "Telefonunu Titret" uzaktan titreşim tetikleyici.

### 5. ⌚ Galaxy Watch (Watch 7 & Watch Ultra) Entegrasyonu
- Dairesel Wear OS ekranlarına tam uyumlu arayüz (`/watch` rotası).
- Canlı nabız (BPM), adım sayısı ve stres seviyesi senkronizasyonu.
- Saatten saate kalp atışı titreşimi ve aşk animasyonları (sarılma, öpücük).
- **"Saate Kur"** butonu: Tek tıkla saatin tarayıcısından ekleme veya Galaxy Wearable üzerinden otomatik eşleşme.

### 6. 🔄 Sıfır Yeniden Kurulum Prensibi (Live OTA Update)
- APK telefonlara ve saate sadece **BİR DEFA** kurulur.
- Yeni bir özellik eklendiğinde, sunucu güncellendiği anda sevgilinizin telefonuna otomatik yansır. Sevgilinize tekrar tekrar APK gönderme zahmeti tamamen tarihe karışmıştır.

---

## 🏗️ Altyapı ve Dağıtım

### Raspberry Pi 5 & CasaOS
- **Port:** `33470` (API, WebSocket ve Web arayüzü tek porttan sunulur).
- **Veritabanı:** Raspberry Pi 5 üzerindeki yerel PostgreSQL (`ahududu` veritabanı).
- **Docker İmajı:** `ghcr.io/muratcihanyandi/ahududu:latest` (ARM64 native).

### Cloudflare Tunnel Kurulumu (Dış Erişim İçin)
1. CasaOS arayüzünde çalışan Cloudflare paneline (veya Cloudflare Zero Trust paneline) gidin.
2. **Public Hostnames** kısmına yeni hostname ekleyin:
   - **Subdomain:** `ahududu`
   - **Domain:** `muratcihanyandi.com` (veya kendi alan adınız)
   - **Service:** `HTTP` -> `localhost:33470`
3. Kaydettiğinizde `https://ahududu.muratcihanyandi.com` üzerinden güvenli ve şifreli HTTPS bağlantınız tüm dünyaya hazır hale gelir!
