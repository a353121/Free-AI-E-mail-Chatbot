ALTER TABLE mcp_servers ADD COLUMN oauth_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_servers ADD COLUMN oauth_issuer TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_authorization_url TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_token_url TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_client_id_ciphertext TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_client_secret_ciphertext TEXT;
ALTER TABLE mcp_servers ADD COLUMN oauth_scopes TEXT NOT NULL DEFAULT '';
ALTER TABLE mcp_servers ADD COLUMN oauth_redirect_uri TEXT;
ALTER TABLE mcp_servers ADD COLUMN headers_ciphertext TEXT;

CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
  server_id INTEGER PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
  access_ciphertext TEXT NOT NULL,
  refresh_ciphertext TEXT,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  expires_at INTEGER,
  scope TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_expiry ON mcp_oauth_tokens(expires_at);
