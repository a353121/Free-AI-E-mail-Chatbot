-- 0008_reliability_capabilities.sql
-- Retryable inbound work, durable delivery, replay protection, and sender cleanup.

ALTER TABLE idempotency ADD COLUMN status TEXT NOT NULL DEFAULT 'succeeded';
ALTER TABLE idempotency ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE idempotency ADD COLUMN lease_until INTEGER;
ALTER TABLE idempotency ADD COLUMN last_error TEXT;
ALTER TABLE idempotency ADD COLUMN next_attempt_at INTEGER;
CREATE INDEX idx_idempotency_retry ON idempotency(status, next_attempt_at, lease_until);

CREATE TABLE email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_key TEXT NOT NULL UNIQUE,
  message_id TEXT,
  sender_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  headers TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL,
  provider_id TEXT,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_outbox_retry ON email_outbox(status, next_attempt_at, lease_until);
CREATE INDEX idx_outbox_sender ON email_outbox(sender_email, created_at DESC);

CREATE TABLE fanout_requests (
  request_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_fanout_expiry ON fanout_requests(expires_at);

CREATE TABLE mcp_confirmations (
  id TEXT PRIMARY KEY,
  sender_email TEXT NOT NULL,
  thread_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER
);
CREATE INDEX idx_mcp_confirmation_lookup ON mcp_confirmations(sender_email, thread_key, status, expires_at);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  server_id INTEGER NOT NULL,
  code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_oauth_state_expiry ON oauth_states(expires_at);

-- Preserve the newest conversation for senders that already have duplicates.
UPDATE messages SET conversation_id = (
  SELECT MAX(newer.id) FROM conversations newer
  WHERE newer.sender_email = (SELECT older.sender_email FROM conversations older WHERE older.id = messages.conversation_id)
) WHERE conversation_id IN (
  SELECT duplicate.id FROM conversations duplicate
  WHERE duplicate.id NOT IN (SELECT MAX(keep.id) FROM conversations keep GROUP BY keep.sender_email)
);
UPDATE idempotency SET conversation_id = (
  SELECT MAX(newer.id) FROM conversations newer
  WHERE newer.sender_email = (SELECT older.sender_email FROM conversations older WHERE older.id = idempotency.conversation_id)
) WHERE conversation_id IN (
  SELECT duplicate.id FROM conversations duplicate
  WHERE duplicate.id NOT IN (SELECT MAX(keep.id) FROM conversations keep GROUP BY keep.sender_email)
);
DELETE FROM conversations WHERE id NOT IN (SELECT MAX(keep.id) FROM conversations keep GROUP BY keep.sender_email);
CREATE UNIQUE INDEX idx_conversations_sender_unique ON conversations(sender_email);

ALTER TABLE rate_events ADD COLUMN event_id TEXT;
UPDATE rate_events SET event_id = 'legacy-' || rowid WHERE event_id IS NULL;
CREATE UNIQUE INDEX idx_rate_event_id ON rate_events(event_id);

-- Empty MCP allowlists no longer mean allow all; require explicit reapproval.
UPDATE mcp_servers SET enabled = 0, requires_confirmation = 1 WHERE allowed_tools IS NULL OR allowed_tools = '' OR allowed_tools = '[]';
