-- Multi-user identity and administrator approval lifecycle.
-- Provider credentials and MCP ownership are added in a later migration; this
-- table is the first trust boundary and is required before model/tool work.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','declined','suspended','deleted')),
  display_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  approved_at INTEGER,
  approved_by TEXT,
  last_seen_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_status_activity ON users(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);

CREATE TABLE IF NOT EXISTS user_lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  request_fingerprint TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_lifecycle_user ON user_lifecycle_events(user_id, created_at DESC);

-- The delivery key is unique so a retried first email cannot send an
-- unbounded number of pending acknowledgements.
CREATE TABLE IF NOT EXISTS user_onboarding_notices (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notice_type TEXT NOT NULL,
  last_delivery_at INTEGER NOT NULL,
  delivery_key TEXT NOT NULL UNIQUE,
  PRIMARY KEY (user_id, notice_type)
);
