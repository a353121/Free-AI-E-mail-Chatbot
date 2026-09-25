-- 0012_github_oauth.sql
-- OAuth state for the built-in GitHub connector.

CREATE TABLE github_oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_github_oauth_state_expiry ON github_oauth_states(expires_at);
