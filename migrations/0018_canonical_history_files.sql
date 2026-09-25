-- D1 is the canonical history store. KV remains optional cache only.
ALTER TABLE conversations ADD COLUMN user_id INTEGER REFERENCES users(id);
UPDATE conversations SET user_id = (SELECT id FROM users WHERE users.email = conversations.sender_email) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_user_activity ON conversations(user_id, last_activity DESC);

ALTER TABLE messages ADD COLUMN user_id INTEGER REFERENCES users(id);
UPDATE messages SET user_id = (SELECT user_id FROM conversations WHERE conversations.id = messages.conversation_id) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_user_created ON messages(user_id, created_at DESC);

ALTER TABLE runs ADD COLUMN user_id INTEGER REFERENCES users(id);
UPDATE runs SET user_id = (SELECT user_id FROM conversations WHERE conversations.id = runs.conversation_id) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_runs_user_created ON runs(user_id, created_at DESC);

ALTER TABLE idempotency ADD COLUMN user_id INTEGER REFERENCES users(id);
UPDATE idempotency SET user_id = (SELECT user_id FROM conversations WHERE conversations.id = idempotency.conversation_id) WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_idempotency_user ON idempotency(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS file_objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES messages(id) ON DELETE SET NULL,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','expired','deleted','quarantined')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_files_user_created ON file_objects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_expiry ON file_objects(status, expires_at);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_start_message_id INTEGER NOT NULL,
  source_end_message_id INTEGER NOT NULL,
  summary TEXT NOT NULL,
  summary_hash TEXT NOT NULL,
  model TEXT,
  config_hash TEXT,
  created_at INTEGER NOT NULL,
  valid INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_summary_conversation ON conversation_summaries(conversation_id, source_end_message_id DESC);

CREATE TABLE IF NOT EXISTS compaction_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_start_message_id INTEGER NOT NULL,
  source_end_message_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','permanent_failure','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(conversation_id, source_start_message_id, source_end_message_id)
);
CREATE INDEX IF NOT EXISTS idx_compaction_retry ON compaction_jobs(status, next_attempt_at, lease_until);
