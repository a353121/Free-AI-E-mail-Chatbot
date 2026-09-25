-- Retryable, observable markers for importing legacy sender-scoped KV history.
CREATE TABLE IF NOT EXISTS history_backfill_markers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_email TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  source_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','succeeded','failed','permanent_failure')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  imported_messages INTEGER NOT NULL DEFAULT 0,
  source_hash TEXT,
  last_error TEXT,
  next_attempt_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(sender_email, source_key)
);
CREATE INDEX IF NOT EXISTS idx_history_backfill_retry ON history_backfill_markers(status, next_attempt_at, lease_until);
CREATE INDEX IF NOT EXISTS idx_history_backfill_user ON history_backfill_markers(user_id, conversation_id);

-- A deterministic source key and sequence make retries safe even if an
-- invocation fails after inserting one legacy message but before recording
-- the marker as succeeded.
ALTER TABLE messages ADD COLUMN legacy_source_key TEXT;
ALTER TABLE messages ADD COLUMN legacy_sequence INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_legacy_source_sequence
  ON messages(legacy_source_key, legacy_sequence)
  WHERE legacy_source_key IS NOT NULL AND legacy_sequence IS NOT NULL;
