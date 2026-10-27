-- 004: Medya varlıkları ve albümler
CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('image','video','audio','file')),
  original_path text NOT NULL,
  thumb_path text,
  mime text NOT NULL,
  size_bytes bigint NOT NULL,
  width integer,
  height integer,
  duration_ms integer,
  caption text NOT NULL DEFAULT '',
  taken_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_media_space_time ON media_assets(space_id, created_at DESC);

-- 001'de oluşturulan users.avatar_media_id için ileri referans burada bağlanır
ALTER TABLE users
  ADD CONSTRAINT fk_users_avatar FOREIGN KEY (avatar_media_id)
  REFERENCES media_assets(id) ON DELETE SET NULL;

CREATE TABLE albums (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  cover_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE album_items (
  album_id uuid NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (album_id, media_id)
);

-- +Down
DROP TABLE IF EXISTS album_items;
DROP TABLE IF EXISTS albums;
ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_avatar;
DROP TABLE IF EXISTS media_assets;
