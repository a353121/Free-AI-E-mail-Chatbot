-- User magic-link authentication and revocable sessions.
CREATE TABLE IF NOT EXISTS magic_login_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL,
  request_fingerprint TEXT NOT NULL DEFAULT '',
  delivery_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_magic_login_expiry ON magic_login_tokens(expires_at, consumed_at);
CREATE INDEX IF NOT EXISTS idx_magic_login_user ON magic_login_tokens(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  request_fingerprint TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions(expires_at, revoked_at);
