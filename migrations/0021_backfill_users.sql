-- Existing senders become pending users and must be approved explicitly.
INSERT OR IGNORE INTO users (email, status, created_at, updated_at, last_seen_at)
SELECT sender_email, 'pending', unixepoch(), unixepoch(), unixepoch() FROM (
  SELECT sender_email FROM contacts
  UNION SELECT sender_email FROM conversations
  UNION SELECT sender_email FROM facts
) WHERE sender_email IS NOT NULL AND length(sender_email) <= 320;
UPDATE conversations SET user_id = (SELECT id FROM users WHERE users.email = conversations.sender_email) WHERE user_id IS NULL;
UPDATE messages SET user_id = (SELECT user_id FROM conversations WHERE conversations.id = messages.conversation_id) WHERE user_id IS NULL;
UPDATE runs SET user_id = (SELECT user_id FROM conversations WHERE conversations.id = runs.conversation_id) WHERE user_id IS NULL;
UPDATE idempotency SET user_id = (SELECT user_id FROM conversations WHERE conversations.id = idempotency.conversation_id) WHERE user_id IS NULL;
