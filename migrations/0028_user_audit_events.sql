-- 0028_user_audit_events.sql
-- Redacted, owner-scoped security and configuration audit events.

CREATE TABLE IF NOT EXISTS user_audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_audit_user_created
  ON user_audit_events(user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_audit_action
  ON user_audit_events(action, created_at DESC);
