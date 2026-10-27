-- 002: Yapılandırma ve sürüm yönetimi
CREATE TABLE app_config (
  id serial PRIMARY KEY,
  channel text NOT NULL DEFAULT 'stable',
  version integer NOT NULL,
  content jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, version)
);

CREATE TABLE app_releases (
  id uuid PRIMARY KEY,
  platform text NOT NULL CHECK (platform IN ('phone','wear')),
  version_code integer NOT NULL,
  version_name text NOT NULL,
  changelog text NOT NULL DEFAULT '',
  file_path text NOT NULL,
  file_size bigint NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, version_code)
);

-- +Down
DROP TABLE IF EXISTS app_releases;
DROP TABLE IF EXISTS app_config;
