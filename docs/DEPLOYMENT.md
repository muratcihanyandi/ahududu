# Dağıtım (Raspberry Pi 5 + CasaOS)

## Hedef ortam (doğrulanmış, 2026-10-26)

- Raspberry Pi 5, Debian 13 (trixie), aarch64, 4 çekirdek, 7,9 GB RAM (~3,3 GB müsait)
- Docker + Compose v5.2.0 (kullanıcı `murat` docker grubunda; `sudo` mevcut)
- PostgreSQL 17.10: mevcut `postgres_db` konteyneri, `0.0.0.0:5432`, veri: `/DATA/AppData/postgres_server/pgdata`
- Dolu portlar (dokunma): 80, 1478, 2283, 2368–2371, 2375, 5432, 5678, 8000, 8100, 8123, 8443, 25500–25600, 33464–33465
- **Ahududu portu: 8787** (HTTP + WebSocket, tek konteyner)
- Medya: `/DATA/AppData/ahududu` (SD kart, ~14 GB boş — kota sınırına dikkat, `docs/KNOWN_LIMITATIONS.md`)

## Kurulum (ilk kez)

Tüm adımlar `deploy/` betikleriyle, geliştirme makinesinden SSH üzerinden yürütülür (`python deploy/deploy.py`):

1. **Veritabanı hazırlığı** (yalnızca ilk kurulumda, yönetici yetkisiyle):
   - `ahududu` veritabanı ve `ahududu_app` rolü (yalnızca bu DB'ye yetkili) mevcut `postgres_db` içinde oluşturulur. Mevcut veritabanlarına/rollere dokunulmaz.
2. **Kaynak aktarımı:** `server/` içeriği (node_modules hariç) Pi'ye rsync/scp ile kopyalanır → `/DATA/AppData/ahududu/server`.
3. **İmaj derlemesi Pi üzerinde:** `docker compose build` (`node:24-slim`, arm64). Geliştirme makinesinde Docker yoktur; derleme Pi'de yapılır.
4. **Ortam değişkenleri:** Pi'de `/DATA/AppData/ahududu/server/.env` (mode 600) — `DATABASE_URL`, `MEDIA_DIR`, `PORT=8787`, `TOKEN_SECRET` (rastgele üretilir, bir kez). Gerçek parolalar depoya girmez; şablon: `server/.env.example`.
5. **Başlatma:** `docker compose up -d` → konteyner adı `ahududu-server`. Bağımlılık yok (DB zaten çalışıyor).
6. **Doğrulama:** health check `GET http://192.168.2.170:8787/health` → `{"status":"ok","db":"up"}`; migration durumu logda; WebSocket el sıkışması.

## Günlük güncelleme

`python deploy/deploy.py` — değişen kaynakları kopyalar, imajı yeniden derler, konteyneri yeniden başlatır, health check yapar. Migration'lar konteyner açılışında otomatik uygulanır (kayıp yok: `schema_migrations` kontrolü).

## Kaynak Limitleri (compose)

- `mem_limit: 512m`, `cpus: 1.5` — Pi'deki diğer hizmetler (Immich ML vb.) korunur.
- Log rotasyonu: `json-file, max-size=10m, max-file=3`.
- Ağ: yalnızca `8787` yayınlanır; DB portu açılmaz/değiştirilmez.

## Yedekleme ve Geri Yükleme

- **Veritabanı:** `docker exec postgres_db pg_dump -U muratcihanyandi ahududu > ahududu_db_<tarih>.sql` (Pi üzerinde; betik: `deploy/backup.py`).
- **Medya + config:** `tar -C /DATA/AppData -czf ahududu_media_<tarih>.tar.gz ahududu`.
- **Geri yükleme:** yeni bir boş `ahududu` DB'sine `psql < dump` + medya tar'ını dizine açma. Adımlar `docs/DEPLOYMENT.md` bu bölümünde kalır; yıkıcı adımlar (DB düşürme) yalnızca elle ve kullanıcı onayıyla.
- Öneri: haftalık cron + kopyanın SD kart dışına (USB/harici) alınması.

## Ev Dışı Erişim (belgelendi, kullanıcı eylemi gerektirir)

İki seçenek; uygulama her ikisini de destekler (çift URL yapılandırması — "ev" ve "dışarısı"):

1. **Cloudflare Tunnel** (mevcut desen; fakeyol/nodehaber örnekleri zaten kurulu): `cloudflared` ile 8787 yayımlanır, erişim Cloudflare hesabı + uygulama token yetkisiyle sınırlanır. WebSocket desteklenir.
2. **Tailscale** (önerilen — hiçbir public exposure yok): Pi'ye ve iki telefona Tailscale kurulur; uygulama tailnet IP'sine bağlanır.

Veritabanı portu asla internete açılmaz; doğrudan IP erişimi yerine tünel kullanılır.
