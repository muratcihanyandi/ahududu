-- 007: Etkileşimler — ilgi isteme, kalp/öpücük/sarılma vb.
CREATE TABLE interactions (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  kind text NOT NULL CHECK (kind IN ('attention','heart','kiss','hug','star','flower','custom')),
  payload jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','answered')),
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_interactions_space_time ON interactions(space_id, created_at DESC);

-- +Down
DROP TABLE IF EXISTS interactions;
