-- 005: Mektuplar — vektörel çizim (stroke JSONB) sayfa modeliyle
CREATE TABLE letters (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL DEFAULT '',
  paper_style text NOT NULL DEFAULT 'klasik',
  envelope_style text NOT NULL DEFAULT 'klasik',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','read')),
  body_md text NOT NULL DEFAULT '',
  client_draft_id text,
  sent_at timestamptz,
  first_read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (author_id, client_draft_id)
);
CREATE INDEX idx_letters_space_time ON letters(space_id, updated_at DESC);

CREATE TABLE letter_pages (
  letter_id uuid NOT NULL REFERENCES letters(id) ON DELETE CASCADE,
  page_no integer NOT NULL,
  background text NOT NULL DEFAULT 'plain' CHECK (background IN ('plain','lined','dotted','grid')),
  strokes jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_media_id uuid REFERENCES media_assets(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (letter_id, page_no)
);

CREATE TABLE letter_attachments (
  letter_id uuid NOT NULL REFERENCES letters(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  PRIMARY KEY (letter_id, media_id)
);

CREATE TABLE letter_favorites (
  letter_id uuid NOT NULL REFERENCES letters(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (letter_id, user_id)
);

-- +Down
DROP TABLE IF EXISTS letter_favorites;
DROP TABLE IF EXISTS letter_attachments;
DROP TABLE IF EXISTS letter_pages;
DROP TABLE IF EXISTS letters;
