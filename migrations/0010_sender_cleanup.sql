ALTER TABLE idempotency ADD COLUMN sender_email TEXT;
UPDATE idempotency SET sender_email = (SELECT sender_email FROM conversations WHERE conversations.id = idempotency.conversation_id) WHERE sender_email IS NULL;
CREATE INDEX idx_idempotency_sender ON idempotency(sender_email);
