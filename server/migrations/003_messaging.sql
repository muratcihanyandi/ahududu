-- 003: Mesajlaşma
CREATE TABLE messages (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  reply_to_id uuid REFERENCES messages(id) ON DELETE SET NULL,
  body text NOT NULL DEFAULT '',
  client_msg_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (sender_id, client_msg_id)
);
CREATE INDEX idx_messages_space_time ON messages(space_id, created_at DESC);

CREATE TABLE message_attachments (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  media_id uuid NOT NULL,
  PRIMARY KEY (message_id, media_id)
);

CREATE TABLE message_receipts (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE message_reactions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reaction text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, reaction)
);

-- +Down
DROP TABLE IF EXISTS message_reactions;
DROP TABLE IF EXISTS message_receipts;
DROP TABLE IF EXISTS message_attachments;
DROP TABLE IF EXISTS messages;
