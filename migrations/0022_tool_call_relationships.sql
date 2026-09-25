-- Preserve the native assistant/tool relationship in the canonical transcript.
ALTER TABLE messages ADD COLUMN tool_call_id TEXT;
CREATE INDEX IF NOT EXISTS idx_messages_conv_id ON messages(conversation_id, id);
