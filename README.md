# Ahududu — Çift Uygulaması

İki telefon, bir saat ve tek bir sunucu. Murat ve Selin için yazılmış, kendi
kendine barındırılan bir çift uygulaması.

> Bu proje bir ürün değil, gerçek kullanıcısı olan bir yazılım. İki kişi her gün
> kullanıyor: balmumu mühürlü el yazısı mektuplar, bas-konuş telsiz, canlı konum,
> Galaxy Watch 7 / Watch Ultra entegrasyonu ve S-Pen basınç hassasiyetli çizim.

```
Android (Capacitor)  ──┐
Wear OS tarayıcı     ──┼──►  FastAPI (:33470)  ──►  PostgreSQL
Web arayüzü          ──┘        WebSocket + REST
```

---

## Neden teknik olarak ilginç

Bu bir "aşk temalı CRUD uygulaması" değil. İçinde çözülmesi gereken gerçek
problemler var:

| Problem | Çözüm |
|---|---|
| **S-Pen basınç hassasiyeti** | Pointer Events `pressure` alanı doğrudan kullanılır; çizgi kalınlığı basınca göre değişir. Parmağın ürettiği sabit değer ayrı ele alınır. |
| **Saatte dairesel ekran** | `/watch` rotası ayrı bir düzen: `border-radius: 50%` kırpması, güvenli alan içinde dairesel yerleşim, dokunma hedefleri 44 px üstü. |
| **Uzaktan titreşim deseni** | Telefon ve saat aynı desen dizisini (`[120, 100, 180, 800, 120, 100, 180]`) Vibration API ile çalar; WebSocket olayı ile tetiklenir. |
| **Sıfır yeniden kurulum** | APK bir kez kurulur; arayüz ve iş mantığı sunucudan güncellenir. Yeni özellik için karşı tarafa yeni APK göndermek gerekmez. |
| **Pil/şarj durumu paylaşımı** | Battery Status API + WebSocket; karşı tarafın bataryası ana ekranda canlı görünür. |
| **Konum ve mesafe** | İki cihazın koordinatlarından haversine mesafe hesabı ("Aramızda 3.2 km var 💕"), pil bilgisiyle birlikte tek yayında. |

---

## Özellikler

**Mektuplar**
- S-Pen veya parmakla basınç hassasiyetli el yazısı tuvali
- Daktilo efektiyle yazılan metin, nostaljik kağıt temaları (parşömen, gül pembesi, gece göğü, lavanta)
- **3D balmumu mühür**: mektup mühürlenerek gönderilir, alıcı açtığında mühür kırılır ve konfeti patlar

**İletişim**
- Bas-konuş telsiz: butona basılı tut, karşı tarafta telsiz bip'i ile otomatik çalar
- Çift sohbeti, fotoğraf ve yüksek kaliteli video paylaşımı
- "Beni Sev!" butonu — dokununca karşı telefon ve saatte kalp atışı titreşimi, hızlı yanıtlar

**Radar**
- Gerçek mesafe (km), iki tarafın pil/şarj durumu
- Tek tıkla Google Maps yol tarifi
- Uzaktan "telefonunu titret"

**Galaxy Watch**
- Watch 7 / Watch Ultra dairesel Wear OS arayüzü
- Canlı nabız (BPM), adım, stres seviyesi senkronizasyonu
- Saatten saate titreşim ve aşk animasyonları (sarılma, öpücük)
- "Saate Kur" butonu ile tek tıkla eşleştirme

---

## Mimari

| Katman | Teknoloji |
|---|---|
| Backend | FastAPI + SQLAlchemy |
| Gerçek zamanlı | WebSocket (tek port) |
| Veritabanı | PostgreSQL |
| Mobil | Capacitor (Android) |
| Web | React + Vite |
| Saat | Wear OS tarayıcı (`/watch`) |
| Dağıtım | Docker (ARM64 native), CasaOS, Cloudflare Tunnel |

```
backend/app/
  main.py           # FastAPI uygulaması, WebSocket hub
  models.py         # kullanıcı, mektup, mesaj, medya, konum
  routes/
    auth.py  chat.py  gallery.py  letters.py
    location.py  media.py  …
frontend/src/
  services/
    api.ts          # REST istemcisi
    websocket.ts    # yeniden bağlanmalı WS
    haptics.ts      # titreşim desenleri
    battery.ts      # pil durumu
    galaxyWatch.ts  # saat entegrasyonu
deploy/deploy_pi.py # Pi'ye tek komutla dağıtım
```

---

## Kurulum

### Docker ile (önerilen)

```bash
git clone https://github.com/muratcihanyandi/ahududu.git
cd ahududu
cp .env.example .env      # DATABASE_URL, JWT_SECRET
docker compose up -d
```

Uygulama tek porttan (`33470`) API, WebSocket ve web arayüzünü sunar:
`http://<pi-ip>:33470`

İmaj: `ghcr.io/muratcihanyandi/ahududu:latest` (ARM64 native)

### Dış erişim

Cloudflare Tunnel ile — ayrıntılar [`CLOUDFLARE_GUIDE.md`](CLOUDFLARE_GUIDE.md).
Public hostname → `HTTP → localhost:33470`.

### Android / saat

APK derleme ve saat eşleştirme adımları için [`PRODUCT.md`](PRODUCT.md) ve
[`DESIGN.md`](DESIGN.md).

---

## Belgeler

| Dosya | İçerik |
|---|---|
| [`PRODUCT.md`](PRODUCT.md) | Ürün tanımı, kullanıcı akışları |
| [`DESIGN.md`](DESIGN.md) | Tasarım sistemi, renk, tipografi |
| [`CLOUDFLARE_GUIDE.md`](CLOUDFLARE_GUIDE.md) | Dış erişim kurulumu |
| [`verify_all.py`](verify_all.py) | Uçtan uca doğrulama betiği |

---

## Lisans

Kişisel proje.
