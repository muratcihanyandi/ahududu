# Veritabanı Şeması

PostgreSQL 17, `ahududu` veritabanı. Şema değişikliği **yalnızca** `server/migrations/NNN_*.sql` dosyalarıyla yapılır; koşucu `schema_migrations` tablosunu tutar (ad, checksum, süre). Migration'lar geri alınabilir şekilde yazılır (aşağı yönde `-- +Down` bloğu) ve boş DB'de sıralı çalıştığı test edilir.

## Tablolar (Aşama 1–2 tasarımı)

### Kimlik ve uzay
- **spaces** — `id uuid pk`, `name`, `created_at`. İki kişilik özel alan.
- **users** — `id uuid pk`, `space_id fk`, `username` (unique), `display_name`, `password_hash`, `password_salt`, `avatar_media_id`, `created_at`, `last_seen_at`. Parola: scrypt.
- **space_members** — `space_id fk`, `user_id fk`, `role` ('owner'|'member'), `joined_at`. Üyelik doğrulaması her istekte.
- **devices** — `id uuid pk`, `user_id fk`, `name`, `platform` ('android'|'wear'), `model`, `os_version`, `push_token`, `created_at`, `last_active_at`.
- **sessions** — `id uuid pk`, `user_id fk`, `device_id fk`, `token_hash` (unique, sha256), `created_at`, `last_used_at`, `expires_at`, `revoked_at`.
- **invites** — `id uuid pk`, `space_id fk`, `code_hash`, `created_by`, `expires_at`, `used_by`, `used_at`. Tek kullanımlık davet kodları.

### Yapılandırma ve güncelleme
- **app_config** — `id`, `channel` ('stable'), `version int`, `content jsonb`, `updated_at`. İçerik şeması: `docs/MODULE_SYSTEM.md`.
- **app_releases** — `id`, `platform` ('phone'|'wear'), `version_code int`, `version_name`, `changelog`, `file_path`, `file_size`, `sha256`, `created_at`. En yeni sürüm `is_latest` işaretli değil; sorgu `ORDER BY version_code DESC LIMIT 1`.

### Olaylar (WebSocket)
- **events** — `id bigserial pk`, `space_id`, `seq bigint` (uzay bazında monotoni; `(space_id, seq)` unique), `type`, `payload jsonb`, `created_at`. Bağlantı koptuğunda istemci `seq` ile farkı çeker; eski olaylar 30 gün sonra temizlenir.

### Mesajlaşma
- **messages** — `id uuid pk`, `space_id`, `sender_id`, `reply_to_id`, `body text`, `client_msg_id` (gönderici+istemci bazlı unique → tekrar gönderimde idempotency), `created_at`, `edited_at`, `deleted_at`.
- **message_attachments** — `message_id`, `media_id` (unique çift).
- **message_receipts** — `message_id`, `user_id`, `read_at`.
- **message_reactions** — `message_id`, `user_id`, `reaction`, `created_at`.

### Medya ve albümler
- **media_assets** — `id uuid pk`, `space_id`, `uploaded_by`, `kind` ('image'|'video'|'audio'|'file'), `original_path`, `thumb_path`, `mime`, `size_bytes`, `width`, `height`, `duration_ms`, `caption`, `taken_at`, `created_at`, `deleted_at`. Yükleme limitleri: görsel 25 MB, video 200 MB (config'ten).
- **albums** — `id uuid pk`, `space_id`, `title`, `cover_media_id`, `created_by`, `created_at`.
- **album_items** — `album_id`, `media_id`, `added_by`, `added_at` (unique çift).

### Mektuplar
- **letters** — `id uuid pk`, `space_id`, `author_id`, `title`, `paper_style`, `envelope_style`, `status` ('draft'|'sent'|'read'), `body_md`, `client_draft_id` (taslak idempotency), `sent_at`, `first_read_at`, `created_at`, `updated_at`, `deleted_at`.
- **letter_pages** — `letter_id`, `page_no`, `background` ('plain'|'lined'|'dotted'|'grid'), `strokes jsonb` (vektör: `[{tool,color,width,points:[[x,y,pressure]]}]`), `preview_media_id`, `updated_at`.
- **letter_attachments** — `letter_id`, `media_id`.
- **letter_favorites** — `letter_id`, `user_id`.

### Notlar
- **notes** — `id uuid pk`, `space_id`, `created_by`, `title`, `body`, `color`, `pinned bool`, `done bool`, `checklist jsonb`, `version int` (iyimser kilitleme), `created_at`, `updated_at`, `deleted_at`.
- **note_revisions** — `id`, `note_id`, `editor_id`, `snapshot jsonb`, `created_at`. Güncelleme `version` uyuşmazsa 409 + güncel belge döner; istemci birleştirme seçeneği sunar, sessiz üzerine yazma olmaz.

### Etkileşimler
- **interactions** — `id uuid pk`, `space_id`, `sender_id`, `kind` ('attention'|'heart'|'kiss'|'hug'|'star'|'flower'|'custom'), `payload jsonb`, `status` ('pending'|'answered'), `answered_at`, `created_at`. Rate limit: tür başına pencere (ör. attention 10 dk) sunucuda uygulanır.

### Konum ve sağlık
- **location_status** — `user_id pk`, `lat`, `lng`, `accuracy_m`, `recorded_at`, `updated_at`, `sharing` ('on'|'off'|'while_using'). Tek satır/kullanıcı; güncellik buradan okunur.
- **location_pings** — `id`, `user_id`, `lat`, `lng`, `accuracy_m`, `recorded_at`. Saklama: 7 gün.
- **health_samples** — `id`, `user_id`, `type` ('heart_rate'|'steps'), `value numeric`, `unit`, `recorded_at`, `source`, `created_at`. Adım günlük upsert (user+gün unique); kalp atışı son N örnek tutulur. **Stres tipi yok** (Samsung kapalı API).

### Bildirimler
- **notifications_log** — `id`, `user_id`, `kind`, `title`, `body`, `data jsonb`, `created_at`, `read_at`. Tekrar önleme ve uygulama içi bildirim geçmişi.

## İndeksler (önemli olanlar)
- `messages (space_id, created_at DESC)`, `messages (sender_id, client_msg_id) UNIQUE`
- `events (space_id, seq) UNIQUE`
- `media_assets (space_id, created_at DESC)`, `letters (space_id, updated_at DESC)`, `notes (space_id, updated_at DESC)`
- `sessions (token_hash) UNIQUE`, `sessions (user_id) WHERE revoked_at IS NULL`
- `health_samples (user_id, type, recorded_at DESC)`

## Saklama ve Bakım
- Olay geçmişi 30 gün, konum geçmişi 7 gün (periyodik temizlik job'u; Aşama 6).
- Yedekleme: `pg_dump ahududu` + medya dizini tar → `docs/DEPLOYMENT.md`.
- Medya dosyaları asla DB'ye gömülmez; `media_assets` yalnızca yol ve metadata tutar.
