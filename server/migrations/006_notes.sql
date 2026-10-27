-- 006: Ortak notlar — iyimser sürümleme ve revizyon geçmişi
CREATE TABLE notes (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id),
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'krem',
  pinned boolean NOT NULL DEFAULT false,
  done boolean NOT NULL DEFAULT false,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_notes_space_time ON notes(space_id, updated_at DESC);

CREATE TABLE note_revisions (
  id uuid PRIMARY KEY,
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  editor_id uuid NOT NULL REFERENCES users(id),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_note_revisions_note ON note_revisions(note_id, created_at DESC);

-- +Down
DROP TABLE IF EXISTS note_revisions;
DROP TABLE IF EXISTS notes;
