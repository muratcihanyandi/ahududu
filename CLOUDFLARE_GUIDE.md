# 🌐 Ahududu — Cloudflare Tunnel & Dış Erişim Rehberi

Sevgiliniz kendi evindeyken veya dışarıdayken Ahududu uygulamasına kesintisiz bağlanabilmesi için Raspberry Pi 5 CasaOS üzerindeki Cloudflare Tunnel entegrasyonu aşağıda adım adım açıklanmıştır.

---

## 1. Cloudflare Tünel Arayüzüne Giriş
Raspberry Pi 5'inizde zaten `wisdomsky/cloudflared-web` konteyneri (`fakeyol-cloudflared-web` veya `nodehaber-cloudflared-web`) çalışmaktadır.

1. Tarayıcınızdan CasaOS paneline (`http://192.168.2.170`) girin ve Cloudflare simgesine tıklayın (veya doğrudan `https://one.dash.cloudflare.com/` adresinden Cloudflare Zero Trust paneline gidin).
2. **Networks** -> **Tunnels** menüsüne gelin.
3. Mevcut aktif tünelinizi seçip **Configure** butonuna tıklayın.

---

## 2. Ahududu İçin Yeni Hostname Ekleyin
1. **Public Hostnames** sekmesine geçin.
2. **Add a public hostname** butonuna tıklayın.
3. Formu aşağıdaki gibi doldurun:
   - **Subdomain:** `ahududu`
   - **Domain:** `muratcihanyandi.com` (veya Cloudflare'e bağlı alan adınız)
   - **Path:** Boş bırakın (varsayılan)
   - **Type:** `HTTP`
   - **URL:** `192.168.2.170:33470` (veya `localhost:33470`)

4. **Additional application settings (Ekstra Ayarlar):**
   - **HTTP Settings:** Varsayılan değerler yeterlidir.
   - **WebSockets:** Cloudflare Tunnels WebSocket bağlantılarını varsayılan olarak destekler (Ahududu anlık mesajlaşma, canlı telsiz ve titreşim için tam uyumludur).

5. **Save hostname** butonuna basarak kaydedin.

---

## 3. Bağlantının Doğrulanması
Tarayıcınızdan (veya sevgilinizin telefonundan):
```
https://ahududu.muratcihanyandi.com/api/system/version
```
adresine gittiğinizde aşağıdaki gibi bir yanıt göreceksiniz:
```json
{
  "app_name": "Ahududu",
  "version": "1.0.0",
  "env": "production",
  "features": [
    "spen_canvas", "letters_wax_seal", "nudge_button",
    "walkie_talkie", "watch_biometrics", "couple_radar",
    "remote_vibrate", "shared_gallery", "shared_notes"
  ]
}
```

---

## 4. Sevgilinizin Telefonunda Kullanım
Sevgiliniz `https://ahududu.muratcihanyandi.com` adresini Samsung Galaxy S24 Ultra telefonunda açıp:
- Menüden **"Ana Ekrana Ekle"** diyerek tam ekran uygulama gibi kurabilir, VEYA
- Hazırlanan **Ahududu.apk** uygulamasını kurabilir.

Uygulama açıldığında tek yapması gereken:
👉 **"Ben Sevgilimiyim 🌸"** butonuna dokunmak!

Başka hiçbir IP adresi, port, şifre ya da teknik ayar girmesine asla gerek yoktur. Her şey anında çalışır.
