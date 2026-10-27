-- 008: Olay kuyruğu (WS), konum, sağlık, bildirim günlüğü
CREATE TABLE events (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, seq)
);

CREATE TABLE location_status (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  sharing text NOT NULL DEFAULT 'off' CHECK (sharing IN ('on','off','while_using')),
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  recorded_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE location_pings (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_m double precision,
  recorded_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_location_pings_user_time ON location_pings(user_id, recorded_at DESC);

CREATE TABLE health_samples (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('heart_rate','steps')),
  value numeric NOT NULL,
  unit text NOT NULL,
  recorded_at timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_health_user_type_time ON health_samples(user_id, type, recorded_at DESC);

CREATE TABLE notifications_log (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  data jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);

-- +Down
DROP TABLE IF EXISTS notifications_log;
DROP TABLE IF EXISTS health_samples;
DROP TABLE IF EXISTS location_pings;
DROP TABLE IF EXISTS location_status;
DROP TABLE IF EXISTS events;
