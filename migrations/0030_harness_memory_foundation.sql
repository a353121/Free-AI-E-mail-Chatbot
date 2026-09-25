-- Harness memory foundation: subject-keyed conversations, conservative token
-- estimates, and a searchable D1 transcript. Original messages remain the
-- canonical archive; the FTS table is only a derived retrieval index.

ALTER TABLE conversations ADD COLUMN conversation_key TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE conversations ADD COLUMN subject_key TEXT NOT NULL DEFAULT '';

UPDATE conversations
SET subject_key = lower(trim(subject)),
    conversation_key = CASE WHEN trim(subject) <> '' THEN 'subject:' || lower(trim(subject)) ELSE 'legacy' END
WHERE conversation_key = 'legacy';

DROP INDEX IF EXISTS idx_conversations_sender_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_sender_key ON conversations(sender_email, conversation_key);
CREATE INDEX IF NOT EXISTS idx_conversations_subject ON conversations(sender_email, subject_key, last_activity DESC);

ALTER TABLE messages ADD COLUMN token_estimate INTEGER NOT NULL DEFAULT 0;
UPDATE messages
SET token_estimate = 12 + ((length(coalesce(content, '')) + length(coalesce(name, '')) + length(coalesce(tool_calls, '')) + 2) / 3)
WHERE token_estimate = 0;

ALTER TABLE conversation_summaries ADD COLUMN summary_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE conversation_summaries ADD COLUMN source_token_estimate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_summaries ADD COLUMN summary_token_estimate INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_summaries ADD COLUMN summary_kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE conversation_summaries ADD COLUMN supersedes_id INTEGER;
ALTER TABLE conversation_summaries ADD COLUMN degraded INTEGER NOT NULL DEFAULT 0;

ALTER TABLE compaction_jobs ADD COLUMN trigger_tokens INTEGER NOT NULL DEFAULT 8000;
ALTER TABLE compaction_jobs ADD COLUMN target_tokens INTEGER NOT NULL DEFAULT 4000;
ALTER TABLE compaction_jobs ADD COLUMN keep_recent_tokens INTEGER NOT NULL DEFAULT 3000;

ALTER TABLE runs ADD COLUMN estimated_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN actual_prompt_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN actual_completion_tokens INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN history_searches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE runs ADD COLUMN context_items_dropped INTEGER NOT NULL DEFAULT 0;

CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
  content,
  conversation_id UNINDEXED,
  user_id UNINDEXED,
  role UNINDEXED,
  created_at UNINDEXED,
  tokenize = 'unicode61'
);

INSERT INTO message_fts(rowid, content, conversation_id, user_id, role, created_at)
SELECT id,
       trim(coalesce(content, '') || ' ' || coalesce(name, '') || ' ' || coalesce(tool_calls, '')),
       conversation_id,
       user_id,
       role,
       created_at
FROM messages
WHERE id NOT IN (SELECT rowid FROM message_fts);

CREATE TRIGGER IF NOT EXISTS messages_fts_after_insert
AFTER INSERT ON messages
BEGIN
  INSERT INTO message_fts(rowid, content, conversation_id, user_id, role, created_at)
  VALUES (new.id, trim(coalesce(new.content, '') || ' ' || coalesce(new.name, '') || ' ' || coalesce(new.tool_calls, '')), new.conversation_id, new.user_id, new.role, new.created_at);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_after_update
AFTER UPDATE OF content, name, tool_calls, conversation_id, user_id, role, created_at ON messages
BEGIN
  DELETE FROM message_fts WHERE rowid = old.id;
  INSERT INTO message_fts(rowid, content, conversation_id, user_id, role, created_at)
  VALUES (new.id, trim(coalesce(new.content, '') || ' ' || coalesce(new.name, '') || ' ' || coalesce(new.tool_calls, '')), new.conversation_id, new.user_id, new.role, new.created_at);
END;

CREATE TRIGGER IF NOT EXISTS messages_fts_after_delete
AFTER DELETE ON messages
BEGIN
  DELETE FROM message_fts WHERE rowid = old.id;
END;

INSERT INTO settings (key, value, updated_at) VALUES
  ('context_caps', '{"systemTokens":1600,"summaryTokens":2000,"recentHistoryTokens":4000,"emailTokens":6000,"attachmentTokens":2000,"toolOutputTokens":1600,"modelContextTokens":12000,"outputTokens":2000}', unixepoch()),
  ('compaction_enabled', 'true', unixepoch()),
  ('compaction_trigger_tokens', '8000', unixepoch()),
  ('compaction_target_tokens', '4000', unixepoch()),
  ('compaction_keep_recent_tokens', '3000', unixepoch()),
  ('compaction_output_tokens', '1200', unixepoch()),
  ('compaction_llm_provider', '', unixepoch()),
  ('compaction_llm_model', '', unixepoch()),
  ('compaction_llm_base_url', '', unixepoch()),
  ('history_search_enabled', 'true', unixepoch()),
  ('history_search_max_calls', '2', unixepoch()),
  ('history_search_max_results', '8', unixepoch()),
  ('history_search_result_tokens', '1600', unixepoch())
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

DELETE FROM settings WHERE key = 'compaction_threshold_messages';
