# Ahududu API Sözleşmesi (v1)

Temel: `http://<sunucu>:8787/api/v1`. Tüm istemciler `Authorization: Bearer <token>` taşır (auth uçları hariç). Yanıtlar JSON; hata zarfı: `{ "error": { "code": "...", "message": "..." } }`, Türkçe mesajlar. Zamanlar ISO-8601 UTC.

> Durum: Aşama 1 uygulamasıyla başlar; her uç implemente edildikçe işaretlenir (✅). Sözleşme bozucu değişiklik yapılırsa `v2` eklenir.

## Auth ve Uzay

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/health` | Sürüm, db durumu (token gerektirmez) |
| POST | `/auth/setup` | İlk kurulum: `{spaceName, username, displayName, password}` → alan + sahip kullanıcı + oturum. Yalnızca boş sistemde çalışır. |
| POST | `/auth/join` | `{inviteCode, username, displayName, password}` → üye katılımı + oturum |
| POST | `/auth/login` | `{username, password, deviceName, platform}` → `{token, expiresAt, user, space}` |
| POST | `/auth/logout` | Oturumu iptal eder |
| GET | `/me` | Profil + cihaz listesi |
| PATCH | `/me` | Görünen ad / avatar |
| POST | `/me/avatar` | Avatar yükleme (multipart) |
| GET | `/space` | Uzay bilgisi, üyeler, davet durumu |
| POST | `/space/invite` | Yeni davet kodu üret (sahip; tek aktif kod) |
| DELETE | `/space/invite` | Davet kodunu iptal et |
| GET | `/devices` · DELETE `/devices/:id` | Cihaz listesi / oturum iptali |

## Yapılandırma ve Güncelleme

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/config` | `app_config` belgesi (ETag / `If-None-Match` → 304). İstemci diske önbellekler. |
| GET | `/app/latest?platform=phone\|wear` | En yeni imzalı sürüm bilgisi: `{versionCode, versionName, changelog, sizeBytes, sha256, downloadPath}` |
| GET | `/app/download/:platform/:versionCode` | APK dosyası (token ile) |

## Olaylar

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/events?since=<seq>&limit=200` | Kaçırılan olayları çeker (WS yeniden bağlanmasında) |

### WebSocket `/ws?token=...`

Sunucu → istemci zarfı: `{ "type": "...", "payload": {...}, "seq": 123, "serverTs": "..." }`
Olay türleri: `message.new`, `message.updated`, `letter.new`, `interaction.new`, `note.updated`, `media.new`, `presence.updated`, `location.updated`, `health.updated`, `config.updated`.

İstemci → sunucu: `{ "type": "ping" }` (30 sn), `{ "type": "typing", payload: {...} }`. Mesaj gönderimi REST üzerinden (idempotency için); WS yalnızca dağıtım/kanal.

## Mesajlaşma

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/messages?before=<ts>&limit=50` | Geçmiş (sayfalama) |
| POST | `/messages` | `{clientMsgId, body, replyToId?}` → idempotent (aynı `clientMsgId` aynı sonucu döner) |
| PATCH | `/messages/:id` | Düzenleme |
| DELETE | `/messages/:id` | Geri çekme (taraflar için silinir) |
| POST | `/messages/:id/reactions` / DELETE | Tepki ekle/kaldır |
| POST | `/messages/:id/read` | Okundu makbuzu |
| POST | `/media` (multipart) | Dosya yükleme → `media_assets` (MIME/boyut doğrulamalı) |
| GET | `/media/:id` · `/media/:id/thumb` | Orijinal / küçük resim (Range destekli) |
| PATCH | `/media/:id` | Açıklama, favori |

## Mektuplar

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/letters?box=inbox\|sent\|drafts&favorite=` | Liste |
| POST | `/letters` | Taslak oluştur/otomatik kaydet (`clientDraftId` idempotent upsert) |
| GET | `/letters/:id` | Mektup + sayfalar (stroke verisi) |
| PATCH | `/letters/:id` | Taslak güncelle (başlık, gövde, sayfalar) |
| POST | `/letters/:id/send` | Gönder (draft→sent; karşı tarafa olay) |
| POST | `/letters/:id/read` | İlk okuma kaydı |
| POST | `/letters/:id/favorite` / DELETE | Favori |

## Notlar

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/notes?q=&pinned=` | Liste |
| POST | `/notes` | Oluştur |
| PATCH | `/notes/:id` | Güncelle — gövdede `baseVersion` zorunlu; uyuşmazlıkta `409` + `{current: ...}` döner |
| DELETE | `/notes/:id` | Sil |
| GET | `/notes/:id/revisions` | Sürüm geçmişi |

## Etkileşimler

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/interactions/definitions` | Config'ten tanımlar (metinler özelleştirilebilir) |
| POST | `/interactions` | `{kind, payload?}` → rate limit uygulanır (429 + kalan süre) |
| POST | `/interactions/:id/answer` | Yanıtla |
| GET | `/interactions?since=` | Geçmiş |

## Konum ve Sağlık

| Yöntem | Yol | Açıklama |
|---|---|---|
| PUT | `/location/status` | `{sharing, lat?, lng?, accuracyM?, recordedAt?}` — paylaşım kapalıysa yalnız durum |
| GET | `/location/partner` | `{sharing, lat, lng, accuracyM, recordedAt, freshness}` |
| POST | `/health/samples` | `{type, value, unit, recordedAt, source}` (saatten/telefondan) |
| GET | `/health/partner?type=heart_rate\|steps` | Son örnek + güncellik |

## Hata Kodları

`400` geçersiz istek · `401` oturum yok/geçersiz · `403` yetki · `404` · `409` sürüm çakışması · `413` dosya çok büyük · `415` desteklenmeyen tür · `429` rate limit (`Retry-After`) · `500` sunucu.
