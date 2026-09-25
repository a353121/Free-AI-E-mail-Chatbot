-- Encrypted magic-link delivery queue. The raw link is never stored in the
-- ordinary email_outbox or in plaintext in D1.
CREATE TABLE IF NOT EXISTS user_login_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_key TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_ciphertext TEXT NOT NULL,
  headers TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_login_outbox_retry ON user_login_outbox(status, next_attempt_at, lease_until);
