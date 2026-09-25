-- 0011_google_oauth.sql
-- OAuth state for the built-in Google Workspace connector.

CREATE TABLE google_oauth_states (
  state TEXT PRIMARY KEY,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_google_oauth_state_expiry ON google_oauth_states(expires_at);
