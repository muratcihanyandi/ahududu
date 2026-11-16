# 🎬 Sinema Takvimi — OpenClaw Entegrasyon Kılavuzu

Murat "OpenClaw'a sinema takvimini ayarla dediğimde bağlanıp bütün ayı ayarlayabilmeli"
istedi. Bu dosya OpenClaw'a (veya başka bir otomasyona) verilecek komut kılavuzudur.

**Sunucu:** `http://192.168.2.170:33470`
**Kimlik doğrulama:** Yok (ev ağı / Cloudflare Tunnel içinde iki kişiye özel).

---

## 1. En kolay yol: "şu ayı tamamen ayarla"

OpenClaw yalnızca tek bir POST atar. Tüm ayın takvimi bu istekle oluşur.

```bash
curl -X POST http://192.168.2.170:33470/api/cinema/calendar/import \
  -H "Content-Type: application/json" \
  -d '{
    "month": "2026-12",
    "replace_existing": true,
    "created_by": "openclaw",
    "showtimes": [
      {
        "title": "Aşk Tesadüfleri Sever",
        "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0",
        "show_date": "2026-12-05",
        "show_time": "21:00",
        "description": "İlk birlikte izleyeceğimiz film"
      },
      {
        "title": "Interstellar",
        "video_url": "https://vimeo.com/123456789",
        "show_date": "2026-12-12",
        "show_time": "21:30"
      }
    ]
  }'
```

Yanıt:

```json
{ "success": true, "month": "2026-12", "created": 2, "removed": 1, "showtimes": [ ... ] }
```

- `replace_existing: true` → o ayın eski seansları silinir, takvim baştan kurulur.
- `replace_existing: false` → mevcut takvime ekleme yapılır.
- `video_url` herhangi bir site linki olabilir; sunucu otomatik çözer:
  YouTube, Vimeo, Dailymotion, Bilibili, Twitch, ok.ru, Streamable,
  Facebook, Instagram, `.mp4` / `.m3u8` doğrudan linkler.
- YouTube afişi (poster) otomatik olarak takvim kartına eklenir.

---

## 2. Otomatik planlama (tarihleri kendisi dağıtsın)

Sadece film listesi verin, sunucu tarihleri 4 günde bir olacak şekilde dağıtsın:

```bash
curl -X POST http://192.168.2.170:33470/api/cinema/calendar/auto-schedule \
  -H "Content-Type: application/json" \
  -d '{
    "month": "2027-01",
    "day": 8,
    "time": "21:00",
    "replace_existing": true,
    "films": [
      { "title": "Film A", "video_url": "https://youtu.be/dQw4w9WgXcQ" },
      { "title": "Film B", "video_url": "https://www.youtube.com/watch?v=YoHD9XEInc0" },
      { "title": "Film C", "video_url": "https://example.com/movie.mp4" }
    ]
  }'
```

Sonuç: `2027-01-08`, `2027-01-12`, `2027-01-16` … her biri 21:00'de.

---

## 3. Takvimi okuma / doğrulama

```bash
# Belirli bir ay
curl "http://192.168.2.170:33470/api/cinema/calendar?month=2026-12&viewer=murat"

# Bu akşamki seans
curl "http://192.168.2.170:33470/api/cinema/calendar/tonight?viewer=murat"

# Sıradaki seans
curl "http://192.168.2.170:33470/api/cinema/calendar/next?viewer=murat"

# Dışa aktarma (yedek)
curl "http://192.168.2.170:33470/api/cinema/calendar/export?month=2026-12"
```

---

## 4. Tek seans düzenleme

```bash
# Güncelle (sadece gönderilen alanlar değişir)
curl -X PUT http://192.168.2.170:33470/api/cinema/calendar/42 \
  -H "Content-Type: application/json" \
  -d '{"show_time": "22:00", "title": "Yeni Başlık"}'

# Sil
curl -X DELETE http://192.168.2.170:33470/api/cinema/calendar/42
```

---

## 5. OpenClaw için hazır prompt örnekleri

> **"Sinema takvimini aralık ayı için ayarla. Her cumartesi 21:00'de bir film olsun."**
>
> OpenClaw: `import` ucuna 5 adet cumartesi tarihli seans gönderir.

> **"Bu ay için 4 romantik film ekle, site linklerini sen bul."**
>
> OpenClaw: YouTube'da film fragmanı / full film linklerini bulur,
> `auto-schedule` ile takvime yerleştirir.

> **"Bu akşam ne var?"**
>
> OpenClaw: `GET /api/cinema/calendar/tonight` çağırır ve özetler.

---

## 6. Canlı izleme (/api/cinema/…)

Bilet ve salon uçları da otomasyona açıktır:

```bash
# Bilet al
curl -X POST http://192.168.2.170:33470/api/cinema/calendar/42/ticket \
  -H "Content-Type: application/json" -d '{"user_id":"murat"}'

# Takvimdeki seansı salonda aç (iki cihaz senkron başlar)
curl -X POST http://192.168.2.170:33470/api/cinema/calendar/42/open \
  -H "Content-Type: application/json" -d '{"user_id":"murat"}'

# Film sırasında tepki gönder
curl -X POST http://192.168.2.170:33470/api/cinema/1/react \
  -H "Content-Type: application/json" -d '{"sender":"murat","emoji":"❤️"}'
```

Salonda oynat/duraklat/sarma WebSocket ile senkron çalışır; otomasyon
sadece takvimi kurar, izlemeyi iki telefon kendi arasında senkronlar.

---

## 7. Tüm uçların özeti

| Uç | Yöntem | Açıklama |
| --- | --- | --- |
| `/api/cinema/calendar/import` | POST | **Bütün ayı ayarla** (OpenClaw ana ucu) |
| `/api/cinema/calendar/auto-schedule` | POST | Film listesinden otomatik tarih dağıt |
| `/api/cinema/calendar` | GET | Ay takvimi |
| `/api/cinema/calendar` | POST | Tek seans ekle |
| `/api/cinema/calendar/{id}` | GET/PUT/DELETE | Seans detay / düzenle / sil |
| `/api/cinema/calendar/{id}/ticket` | POST/DELETE | Bilet al / iptal |
| `/api/cinema/calendar/{id}/open` | POST | Seansı salonda aç |
| `/api/cinema/calendar/tonight` | GET | Bu akşamki seans |
| `/api/cinema/calendar/next` | GET | Sıradaki seans |
| `/api/cinema/calendar/export` | GET | Takvimi dışa aktar |

---

## 8. Doğrulama

```bash
python tests/test_cinema_calendar.py   # 23 kontrol: import, bilet, otomatik plan, export
```
