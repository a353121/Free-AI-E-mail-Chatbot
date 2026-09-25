-- Credentials and integrations owned by an approved user.
CREATE TABLE IF NOT EXISTS user_provider_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  credentials_ciphertext TEXT NOT NULL,
  metadata_ciphertext TEXT,
  granted_scopes TEXT NOT NULL DEFAULT '',
  provider_subject TEXT,
  expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'connected',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_user_provider_user ON user_provider_connections(user_id, status);
CREATE INDEX IF NOT EXISTS idx_user_provider_expiry ON user_provider_connections(expires_at, status);

ALTER TABLE mcp_servers ADD COLUMN owner_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_mcp_owner ON mcp_servers(owner_user_id, enabled, name);
