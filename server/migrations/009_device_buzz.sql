-- 009: Cihaz komutları — karşı tarafın telefonunu/saatini titreştirme.
-- Titreşim kalıcı bir iş değildir; son 24 saat tutulur (geçmiş + kopma telafisi için).
CREATE TABLE device_buzzes (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pattern text NOT NULL CHECK (pattern IN ('short','long','heartbeat','sos','kiss')),
  note text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT 'phone' CHECK (source IN ('phone','watch')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sender_id <> target_id)
);
CREATE INDEX idx_device_buzzes_space_time ON device_buzzes(space_id, created_at DESC);

-- +Down
DROP TABLE IF EXISTS device_buzzes;
