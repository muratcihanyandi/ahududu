# 🍓 Ahududu — Bizim Dünyamız

Murat ve Sevgilisi için özel olarak geliştirilmiş, romantik, samimi ve teknik karmaşıklıktan tamamen arındırılmış çift uygulaması.

---

## 📱 Cihaz Desteği
- **Samsung Galaxy S24 Ultra:** S-Pen donanımı ile gerçekçi el yazısı ve çizim desteği, aşk mektupları tuvali, basınç hassasiyeti.
- **Samsung Galaxy S23:** Canlı konum, ilgi çağırma, çift sohbeti, ortak galeri, notlar ve sinema salonu.

---

## ✨ Öne Çıkan Özellikler

### 1. 💌 Balmumu Mühürlü Romantik Mektuplar & S-Pen Tuvali
- **Mektuplar asla kaybolmaz:** Silme işlemi mektubu **arşive** taşır (kayıt veritabanından
  silinmez) ve ayrıca diske JSON yedeği yazılır (`uploads/letters_backup/`).
  Mektuplar sekmesindeki **"Mektup Arşivi"** bölümünden tek dokunuşla geri getirilir.
- **S-Pen El Yazısı:** Sevgilinizin S-Pen kalemi veya parmağıyla doğrudan kağıda çizebileceği, basınç hassasiyetli tuval.
- **Daktilo Yazısı:** Özel romantik fontlarla dökülen kalpten hisler.
- **Nostaljik Kağıt Temaları:** Parşömen kağıdı, Gül pembesi, Gece göğü, Lavanta.
- **3D Balmumu Mühür:** Mektup gönderilirken balmumu ile mühürlenir. Karşı taraf açtığında mühür kırılır ve konfeti efekti ile açılır!

### 2. 💖 "Beni Sev!" / İlgi İsteme Butonu
- Ana ekranda dev, sevimli, zıplayan interaktif ilgi butonu.
- Dokunulduğunda sevgilinizin telefonunda özel kalp atışı titreşimleri üretir (`[120, 100, 180, 800, 120, 100, 180]`).
- Hızlı yanıtlar: "Hemen geliyorum!", "Kocaman sarıldım", "Canım benim".

### 3. 📸 Anlık Fotoğraf (Anlar)
- Şu an ne yaptığını çek, paylaş — an **24 saat sonra kendiliğinden kaybolur**.
- Kamera veya galeriden seç, 7 filtre (Gül, Canlı, Siyah-Beyaz, Gün Batımı…) ve 7 duygu etiketi.
- Sevgilin açınca "görüldü" işaretlenir, kalp/gülücük/ateş tepkileri anında uçuşur.
- Halka göstergeleri: kimin kaç yeni anı var, hangi anlar görülmedi.

### 4. 📖 Günlük (Bizim Defterimiz)
- İkinizin ortak anı defteri: başlık, günün ruh hali, 1–5 yıldız puan, hava durumu, fotoğraf.
- **Kilitli sayfalar:** `is_locked` ile işaretlenen günlük yalnızca yazanı görür.
- Gün serisi (streak), toplam sayfa, ayrı gün sayısı istatistikleri.
- Kitap sayfası çevirme animasyonu, el yazısı fontu ve defter dokusu.

### 5. 🐾 Hayvan Albümü
- Her hayvan dostu için **isim + kategori** ile ayrı albüm (kedi, köpek, kuş, balık, tavşan, hamster, kaplumbağa, sürüngen, at, diğer).
- Kategoriye göre doğru emoji ve renk otomatik seçilir; `köpek` / `kopek` / `Köpek` aynı kategoriye düşer.
- Cins, yaş, hikâye, "sevimli halleri" notları, sahiplik (Murat / Selin / Bizim), favori.
- Her hayvanın kendi fotoğraf/video galerisi ve tam ekran görüntüleyicisi.

### 6. 🎬 Sinema Salonumuz — Takvim + Birlikte İzleme (Büyük Güncelleme)

#### 🗓️ Sinema Takvimi (beyaz perde)
- **"Bu ayın perdesi" her zaman görünür:** Sinema açıldığında üstte koyu bir perde kartı
  durur — bu ayın seansları, "bu akşam", "sıradaki film" ve tek dokunuşla **"Perdeyi Aç"**.
  Bu kart takvimden bağımsızdır; sayfada yerinden oynamaz.
- **Yalnız takvim açılır/kapanır:** Kartın üzerindeki **"Takvimi Gör / Takvimi Gizle"**
  yalnızca takvim kutusunu açar-kapatır.
- **Koyu tema:** Takvim, seans kartları, seans detayı ve "Film Ekle" penceresi sinema
  salonuyla aynı koyu (gece) temasındadır — göz yormaz.
- **Manuel yönetim:** "Film Ekle" ile tarih, saat, salon, video linki, afiş ve kısa not girilebilir; seanslar düzenlenip silinebilir.
- **Otomatik takvim kurma:** Uygulama içinden "Bu ay için örnek program kur" ile tek dokunuşla aylık program hazırlanır.
  (Otomasyon/entegrasyon için API uçları: [OPENCLAW_CINEMA.md](OPENCLAW_CINEMA.md) — bu bir geliştirici dokümanıdır, arayüzde görünmez.)
- **Bilet:** Her film için ortak "bilet alınır" (gerçek bilet değil). `AHU-XXXXXX` bilet kodu üretilir,
  partnerin ekranında "Selin bilet aldı 🎟️" bildirimi çıkar. Bilet olmadan salona girilemez.

#### 👀 Birlikte izleme
- **Herhangi bir siteden film:** Film sayfasının linkini yapıştır — sunucu sayfayı açıp **gerçek video kaynağını**
  bulur (iframe `data-src`, göreli `.mp4`, oynatıcı adresleri) ve perdeye koyar. YouTube, Vimeo, Dailymotion,
  Bilibili, Twitch, ok.ru, Streamable ve film siteleri desteklenir. Telefondan dosya da yüklenebilir.
- **Zorla giriş yok:** Partner film başlattığında karşı taraf otomatik salona **sokulmaz**; "Katıl" daveti görünür.
  Katılırsan aynı saniyeden devam edersin.
- **Senkron izleme:** Oynat / duraklat / 10 sn ileri-geri / sarma anında karşı tarafa yansır.
  Sunucu konumu 2 saniyede bir kaydeder; ölçülen fark ~0.16 sn.
- **Fullscreen:** Salonda "⤢ Tam ekran" ile perde tüm ekranı kaplar; telefon otomatik yataya döner.
- **Salona giriş bildirimi:** Partnerin sinemaya girdiğinde anında bildirim alırsın; Ahududu durumu otomatik
  **"Sinemada 🍿"** olur, çıkınca eski durumuna döner.
- **Karakterleriniz:** Perdenin iki yanında 🐻 Murat ve 🌸 Selin koltuklarında görünür.
- **Tepkiler:** ❤️😂😱😍🍿 uçar, iki tarafta da görünür.

### 7. 🌸 Anı Bahçemiz *(demo)*
My Bibi uygulamasından ilham alınan çift ritüelleri — hepsi **DEMO** etiketiyle:
- **Günün Sorusu:** Her gün tek soru; ikiniz de cevaplayana kadar karşı tarafın cevabı görünmez.
- **Zaman Kapsülleri:** İleri bir tarihe mühürlenen mesaj; o gün gelmeden kimse (gönderen bile) okuyamaz.
- **Bizim Şarkılarımız:** İkinizin şarkıları + o şarkının hikâyesi.
- **Yıllar Önce Bugün:** Geçmiş yılların aynı günündeki günlükler, mektuplar ve fotoğraflar.
- **Duygu Havası:** Bugünkü gökyüzün (☀️ ⛅ 🌧 ⛈ 🌙), partnerin havası ve son 21 günün ısı haritası.

### 8. 🧭 Navigasyon
Alt bar **her zaman 5 tuş**: **Ana sayfa · Mektuplar · Sohbet · Bahçe · Anılar**.
Sinema ve Çift Radarı ana sayfadaki hızlı erişim kartlarından ve "Anılar" sekmesinden açılır.

### 9. 💬 Çift Sohbeti
- Anlık mesajlaşma, fotoğraf, video ve sesli mesaj paylaşımı.
- Sohbet ekranı sabittir: başlık ve mesaj yazma alanı oynamaz, yalnızca mesajlar kayar.
- **Bildirimler:** Uygulama başka bir sekmedeyken/arka plandayken gelen her mesaj sistem
  bildirimi olarak düşer; alt barda **Sohbet** sayacı görünür.
- **Sesli mesaj:** Yazı yokken mikrofon düğmesi, yazmaya başlayınca Gönder düğmesine dönüşür (WhatsApp gibi).
- **En altta açılır:** Sohbet her açıldığında doğrudan son mesajla açılır.

### 10. 🧭 Çift Radarı & Mesafe Takibi
- Aranızdaki gerçek mesafeyi kilometre cinsinden gösterir ("Aramızda 3.2 km var 💕").
- Her iki telefonun pil durumu ve şarj bilgisi.
- "Yanına Yol Tarifi Al" tek tık Google Maps bağlantısı.
- "Telefonunu Titret" uzaktan titreşim tetikleyici.

### 11. 🔄 Sıfır Yeniden Kurulum (Otomatik Güncelleme)
- APK telefonlara sadece **BİR DEFA** kurulur.
- Yeni bir özellik eklendiğinde sunucuya dağıtım yapılır; sunucu yeni sürümü WebSocket ile anında tüm açık uygulamalara bildirir.
- Uygulama arka plandaysa sessizce, ekranda ise kısa bir geri sayımdan sonra kendini yeniler. Yazı yazarken, çizim yaparken veya **film izlerken** yenileme ertelenir; mektup taslağı cihazda tutulur.
- APK'nın yeniden kurulması yalnızca native tarafta (izinler, yeni bir Android eklentisi, simge vb.) değişiklik olduğunda gerekir.

### 12. 🏗️ Altyapı ve Dağıtım

### Raspberry Pi 5 & CasaOS
- **Port:** `33470` (API, WebSocket ve Web arayüzü tek porttan sunulur).
- **Veritabanı:** Raspberry Pi 5 üzerindeki yerel PostgreSQL (`ahududu` veritabanı).
- **Docker İmajı:** `ghcr.io/muratcihanyandi/ahududu:latest` (ARM64 native).

### Tek Komutla Dağıtım
```bash
python deploy/deploy_pi.py
```
Bu komut sırayla frontend'i derler, `frontend/dist` içeriğini `backend/static`'e senkronize eder, kaynağı Pi 5'e yükleyip Docker imajını yerinde derler, container'ı yeniler ve canlı `build_id` ile yerel derlemenin eşleştiğini doğrular.

Kullanışlı bayraklar:
- `--skip-build` — sadece dağıtım yapar (frontend değişmediyse)
- `--skip-deploy` — sadece derler ve static'i senkronize eder
- `--verify-only` — sadece canlı sürümü doğrular

> Not: `dist → backend/static` kopyalaması bu script'in parçasıdır. Elle `npm run build` yapıp kopyalamayı atlarsanız sunucu eski arayüzü sunmaya devam eder.

### Canlı Doğrulama
```bash
python verify_all.py                     # tüm API uçları + kaldırılan watch uçları
python tests/test_new_features.py        # Anlık fotoğraf, günlük, hayvan albümü, sinema API'leri
python tests/test_live_update_push.py    # canlı WebSocket güncelleme bildirimi
python tests/test_update_push.py         # yerel build algılama + meta enjeksiyonu
```

### Yeni Özellikleri Yerelde Denediniz mi?
```bash
python tests/dev_server.py               # http://127.0.0.1:33471 (SQLite, frontend/dist sunar)
python tests/browser_check.py            # tarayıcıda tüm yeni ekranları gezer + ekran görüntüleri
python tests/test_four_tasks.py          # geri tuşu, sabit sohbet, başlık, sinema takvimi
python tests/test_cinema_calendar.py     # takvim API'leri (import, bilet, otomatik plan)
python tests/test_cinema_presence.py     # salona giriş bildirimi + "Sinemada" durumu
python tests/two_device_sync.py          # iki telefon: birlikte izleme senkron testi
```
Ekran görüntüleri `tests/screenshots/` klasörüne yazılır. Tarayıcı olarak sistemdeki Chrome/Edge kullanılır
(Playwright tarayıcı indirmeye gerek yok).

### Android Geri Tuşu
Geri tuşu artık uygulamadan çıkarmaz:
1. Açık pencere varsa (mektup, sinema, seans detayı, an paylaşma…) onu kapatır.
2. Ana ekranda değilsek ana ekrana döner.
3. Ana ekrandaysa uygulamayı arka plana alır (kapatmaz).

> Bu davranış native tarafta `MainActivity` (OnBackPressedCallback) ve web tarafında
> `src/services/backButton.ts` ile birlikte çalışır. Native değişiklik olduğu için
> **yeni bir APK kurulumu gerekir**; sonraki güncellemeler yine OTA ile gelir.

### Sinema Salonu Test Filmi
`tests/fixtures/testfilm60.mp4` ffmpeg ile üretilmiş 60 saniyelik bir test görüntüsüdür.
Sinema Salonu'nda "Takvimsiz Hızlı İzle → 📁 Dosya" ile yüklenebilir.

### Cloudflare Tunnel Kurulumu (Dış Erişim İçin)
1. CasaOS arayüzünde çalışan Cloudflare paneline (veya Cloudflare Zero Trust paneline) gidin.
2. **Public Hostnames** kısmına yeni hostname ekleyin:
   - **Subdomain:** `ahududu`
   - **Domain:** `muratcihanyandi.com` (veya kendi alan adınız)
   - **Service:** `HTTP` -> `localhost:33470`
3. Kaydettiğinizde `https://ahududu.muratcihanyandi.com` üzerinden güvenli ve şifreli HTTPS bağlantınız tüm dünyaya hazır hale gelir!
