-- 0003_rate_limits.sql — D1-backed rate limiting.
-- KV free writes (1k/day) are too scarce for hit counters, so per-sender/hour
-- and global/day windows live here (D1 writes: 100k/day).

CREATE TABLE rate_events (
  bucket TEXT NOT NULL,   -- 'sender:<email>:2026-09-17T10' | 'global:2026-09-17'
  ts     INTEGER NOT NULL
);
CREATE INDEX idx_rate_bucket ON rate_events(bucket, ts);