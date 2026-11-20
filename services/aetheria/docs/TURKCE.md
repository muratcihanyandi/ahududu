# Türkçe Yerelleştirme & Mobil Uyumluluk

Bu dosya Aetheria'nın Türkçe dil desteği ve mobil düzeltmeleri için yol haritasıdır.

## Dil sistemi

- Sözlükler: `packages/client/src/locales/{tr,en,th}.ts`
- Kanca: `useT()` → `t("key", { param })`
- Varsayılan dil **Türkçe**. Seçim `localStorage["lang"]` içinde saklanır
  (`tr` | `en` | `th`) ve `<html lang>` otomatik güncellenir.
- Dil değiştirme: Ayarlar paneli → 🌐 (Türkçe / ภาษาไทย / English)
- `t()` sırası: seçili dil → Türkçe → İngilizce → ham anahtar.
  Yani eksik bir anahtar asla boş metin göstermez.

### Yeni metin eklerken

1. Anahtarı **üç** dosyaya da ekleyin (`tr.ts`, `en.ts`, `th.ts`).
2. `{param}` yer tutucularını koruyun — sözlükler arasında birebir eşleşmeli.
3. Bileşenlerde sabit metin yerine `t("...")` kullanın.

Hızlı doğrulama (anahtar/yer tutucu farkı bulmak için):

```bash
cd packages/client
node -e "const fs=require('fs');const p=k=>[...fs.readFileSync('src/locales/'+k+'.ts','utf8').matchAll(/^\s*\"([^\"]+)\"\s*:/gm)].map(m=>m[1]);const a=p('en'),b=p('tr');console.log('eksik:',a.filter(k=>!b.includes(k)),'fazla:',b.filter(k=>!a.includes(k)))"
```

## Çevrilen katmanlar

| Katman | Kapsam |
|---|---|
| İstemci arayüzü | ~775 anahtar (tüm paneller, HUD, menü, eğitim) |
| `packages/shared` | eşya/NPC/görev/meslek/harita/canavar/tarif/başarım/bölge adları |
| `packages/server` | sistem & sohbet mesajları (~200 dize) |
| `packages/client/index.html` | başlık, `lang="tr"`, meta açıklama |

> Not: Bazı alanlar geriye dönük uyumluluk için `nameTh` adını korur
> (`jobs.ts` yetenek ağacı, `recipes.ts` tezgâhlar). İçerikleri artık Türkçedir;
> alan adını değiştirmek gerekmez.

## Mobil düzeltmeleri

- **Görünüm yüksekliği**: `html/body/#root` artık `100dvh` kullanır
  (`--vh-safe`); panellerin `100vh` sınırları mobil tarayıcının gizli adres
  çubuğunu saymıyordu.
- **Dokunmatik hedefler**: menü ikonları ≥44×44px (`mobile-icon-btn`).
- **Kaydırılabilir modaller**: `[role="dialog"]` artık `overflow-y:auto`.
- **Saldır düğmesi çapası**: `left:1.5rem !important` hatası giderildi; düğme
  her ekranda sağ-altta (`right:1.5rem`).
- **Dikey ekran (portre) yerleşimi**: yardımcı satır (`utility-row`)
  `bottom:12.5rem`'e taşındı ve ikon altı yazılar gizlendi → beceri yayıyla
  çakışma bitti. En soldaki beceri (`skill-arc-0`) dar ekranlarda içe çekildi.
- **Dünya haritası**: kare harita artık yüksekliğe göre de sınırlanır
  (`min(88vw, 560px, 100dvh - 13rem)`); yatay telefonda kırpılmıyor.
- **Sabit genişlikler**: `AccountRecovery`, `LoadingScreen`, `TradeWindow`,
  `NpcDialog` için `max-w-[92-94vw]` eklendi.
- **Giriş ekranı**: kısa ekranlarda kaydırılabilir; başlık ve alt ipucu
  `max-height:520px` altında gizlenir (formla çakışmasın).
- **Erişilebilirlik**: `user-scalable=no` kaldırıldı (yakınlaştırma açık);
  açık tema panel metinleri koyu renge çevrildi (kontrast ≥3:1).

### Duman testi

Değişiklikten sonra:

```bash
cd packages/client && node smoketest.mjs   # sunucu çalışıyor olmalı
```

Bu doküman, mobil yerleşimi bozmadan yeni panel eklemek isteyen oturumlar için
kısa bir referanstır.
