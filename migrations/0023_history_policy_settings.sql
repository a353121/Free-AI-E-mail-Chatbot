INSERT INTO settings (key, value, updated_at) VALUES
  ('file_cache_ttl_days', '3', 0),
  ('compaction_enabled', 'true', 0),
  ('compaction_threshold_messages', '30', 0)
ON CONFLICT(key) DO NOTHING;
