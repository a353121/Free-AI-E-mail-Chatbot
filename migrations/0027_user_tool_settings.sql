-- 0027_user_tool_settings.sql
-- User preferences can narrow the effective tool surface without overriding
-- administrator policy, capability readiness, or destructive-action guards.

CREATE TABLE IF NOT EXISTS user_tool_settings (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, tool_name)
);
CREATE INDEX IF NOT EXISTS idx_user_tool_settings_user ON user_tool_settings(user_id, enabled, updated_at);
