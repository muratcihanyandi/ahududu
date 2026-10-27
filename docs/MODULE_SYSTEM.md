# Modül ve Yapılandırma Sistemi

Ahududu'nun "APK dağıtmadan güncelleme" gereksiniminin kalbi budur. İki ayrı mekanizma net biçimde ayrılır (bkz. `docs/UPDATE_SYSTEM.md`).

## 1. Sunucu taraflı yapılandırma (`app_config`)

Tek bir sürümlü JSONB belge, `GET /api/v1/config` üzerinden ETag ile sunulur. İstemci:

1. Önce diske önbelleklediği belgeyle açılır (çevrimdışı çalışır).
2. Ağ varsa `If-None-Match` ile kontrol eder; değişmişse indirir ve kaydeder.
3. `config.updated` WS olayı gelirse anında yeniler.
4. Belge `schemaVersion` alanı istemcinin desteklediğinden büyükse → bilinen alanları kullanır, bilinmeyenleri yok sayar (ileriye dönük uyumluluk).

### Belge yapısı (özet)

```jsonc
{
  "schemaVersion": 1,
  "themes": { "active": "pudra", "available": [ { "id": "pudra", "colors": {...}, "paper": "..." } ] },
  "letters": { "papers": [ {"id":"klasik","name":"Klasik","background":"...","lines":false} ], "envelopes": [...] },
  "interactions": [ { "kind":"attention", "label":"İlgini istiyorum", "message":"...", "cooldownSec":600, "notify":true } ],
  "strings": { "home.greeting": "Merhaba canım", ... },
  "featureFlags": { "voiceLink": false, "locationSharing": true },
  "limits": { "imageMaxBytes": 26214400, "videoMaxBytes": 209715200 }
}
```

### Ne güncellenebilir, ne güncellenemez

| Sunucudan güncellenebilir | Yeni APK gerektirir |
|---|---|
| Mektup kâğıt/zarf tanımları (yerleşik renderer parametreleri: renk, çizgi, doku adı) | Yeni renderer tipi (ör. yeni bir sayfa efekti kodu) |
| Temalar (renk paleti, tipografi ölçekleri) | Yeni ekran/akış |
| Etkileşim tanımları: metin, ikon referansı, cooldown, bildirim metni | Yeni etkileşim *davranışı* |
| Özellik bayrakları (var olan yetenekleri aç/kapa) | Yeni izin gerektiren yetenek |
| Metinler (strings), limitler, bildirim şablonları | Veritabanı şeması değişikliği |

Kural: config **yerleşik yetenekleri parametreleştirir**; tarayıcıdaki CSS gibi davranır — yeni davranış satırı (kod) getirmez.

## 2. Sunucu modülleri

Backend'te "modül" = `server/src/modules/<ad>/` klasöründeki Fastify plugin'i + kendi tabloları. Yeni bir içerik türü ya da iş akışı eklendiğinde:

1. Yeni modül klasörü + migration yazılır, `src/app.ts`'e kaydedilir.
2. Eski istemciler yeni uçları bilmez → bozulmaz (eklemeler geriye uyumludur).
3. İstemcinin yeni modülü kullanması config'teki `featureFlags` ile yönlendirilir; eski istemci bayrağı yok sayar.

## 3. İstemci modül kaydı

Android tarafında "modül" = bir Feature API'si üzerinden kaydolan UI bölümleri (`FeatureRegistry`). Config'te bayrağı kapatılan modül navigasyondan gizlenir, veri senkronu durur, ancak veriler korunur.
