-- 0025_mcp_confirmation_ownership.sql
-- Bind side-effect confirmations to the approved user identity as well as
-- sender/thread/tool/arguments. Legacy rows remain nullable and expire
-- naturally; new confirmations always carry user_id in application code.

ALTER TABLE mcp_confirmations ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_mcp_confirmation_user_lookup ON mcp_confirmations(user_id, sender_email, thread_key, status, expires_at);

UPDATE mcp_confirmations
SET user_id = (SELECT id FROM users WHERE lower(users.email) = lower(mcp_confirmations.sender_email))
WHERE user_id IS NULL;
