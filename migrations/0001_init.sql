-- 0001_init.sql — AI Email Bot 2.0 core schema
-- D1 (SQLite) becomes the primary store for agent memory/audit/config.

CREATE TABLE conversations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_email  TEXT NOT NULL,
  subject       TEXT NOT NULL DEFAULT '',
  summary       TEXT,
  metadata      TEXT NOT NULL DEFAULT '{}',
  last_activity INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX idx_conv_sender ON conversations(sender_email, last_activity DESC);

CREATE TABLE messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL CHECK (role IN ('system','user','assistant','tool')),
  name            TEXT,
  content         TEXT,
  tool_calls      TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX idx_msgs_conv ON messages(conversation_id, id);

CREATE TABLE runs (
  id              TEXT PRIMARY KEY,
  sender_email    TEXT,
  conversation_id INTEGER REFERENCES conversations(id),
  kind            TEXT NOT NULL,
  steps           INTEGER NOT NULL DEFAULT 0,
  subrequests     INTEGER NOT NULL DEFAULT 0,
  tool_calls      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL,
  model           TEXT,
  created_at      INTEGER NOT NULL,
  finished_at     INTEGER
);
CREATE INDEX idx_runs_sender ON runs(sender_email, created_at DESC);

CREATE TABLE tool_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT REFERENCES runs(id) ON DELETE CASCADE,
  tool        TEXT NOT NULL,
  status      TEXT NOT NULL,
  input_hash  TEXT,
  duration_ms INTEGER,
  error       TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_tool_run ON tool_logs(run_id, created_at);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE contacts (
  sender_email TEXT PRIMARY KEY,
  name         TEXT,
  meta         TEXT DEFAULT '{}',
  preferences  TEXT DEFAULT '{}',
  last_seen    INTEGER
);

CREATE TABLE facts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_email TEXT NOT NULL,
  fact        TEXT NOT NULL,
  source      TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_facts_sender ON facts(sender_email);

CREATE TABLE knowledge (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  tags       TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE TABLE idempotency (
  message_id      TEXT PRIMARY KEY,
  conversation_id INTEGER,
  created_at      INTEGER NOT NULL
);

CREATE TABLE usage_guard (
  day        TEXT PRIMARY KEY,
  d1_writes  INTEGER DEFAULT 0,
  d1_reads   INTEGER DEFAULT 0,
  kv_writes  INTEGER DEFAULT 0,
  kv_reads   INTEGER DEFAULT 0,
  llm_calls  INTEGER DEFAULT 0,
  degraded   INTEGER DEFAULT 0
);