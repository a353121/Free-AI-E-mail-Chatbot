-- 0026_user_deletion_tombstones.sql
-- Keep only the minimum identity tombstone needed to prevent immediate
-- account reactivation after a user purge. The old user row is retained until
-- the cooldown expires, then the next contact replaces it with a new ID.

CREATE TABLE IF NOT EXISTS user_tombstones (
  email TEXT PRIMARY KEY,
  last_user_id INTEGER,
  deleted_at INTEGER NOT NULL,
  available_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_tombstones_available ON user_tombstones(available_at);

INSERT OR IGNORE INTO user_tombstones (email, last_user_id, deleted_at, available_at, created_at, updated_at)
SELECT email, id, COALESCE(deleted_at, updated_at, unixepoch()), COALESCE(deleted_at, updated_at, unixepoch()) + 86400, COALESCE(deleted_at, updated_at, unixepoch()), unixepoch()
FROM users WHERE status = 'deleted';
