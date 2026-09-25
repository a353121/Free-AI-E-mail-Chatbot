CREATE TABLE IF NOT EXISTS admin_secrets (
  name TEXT PRIMARY KEY,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sender_blocks (
  sender_email TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS admin_login_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_login_events_lookup ON admin_login_events(fingerprint, created_at);
