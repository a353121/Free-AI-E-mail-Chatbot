ALTER TABLE oauth_states ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_oauth_state_user ON oauth_states(user_id, expires_at);
