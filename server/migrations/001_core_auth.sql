-- 001: Çekirdek kimlik — uzaylar, kullanıcılar, üyelik, cihazlar, oturumlar, davetler
CREATE TABLE spaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  event_seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  avatar_media_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz
);

CREATE TABLE space_members (
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, user_id)
);

CREATE TABLE devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('android','wear')),
  model text,
  os_version text,
  push_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz
);

CREATE TABLE sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX idx_sessions_user_active ON sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE invites (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  expires_at timestamptz NOT NULL,
  used_by uuid REFERENCES users(id),
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_invites_space_active ON invites(space_id) WHERE used_by IS NULL;

-- +Down
DROP TABLE IF EXISTS invites;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS space_members;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS spaces;
