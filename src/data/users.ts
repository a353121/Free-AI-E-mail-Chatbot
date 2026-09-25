import type { Db } from './db.ts';
import type { AppEnv } from '../env.ts';
import { normalizePlainText, nowSeconds } from '../shared.ts';
import { deleteUserFiles } from './files.ts';

export type UserStatus = 'pending' | 'approved' | 'declined' | 'suspended' | 'deleted';
export const USER_DELETION_COOLDOWN_SECONDS = 86400;

export interface UserRecord {
  id: number;
  email: string;
  status: UserStatus;
  displayName?: string;
  createdAt: number;
  updatedAt: number;
  lastSeenAt?: number;
}

function rowToUser(row: Record<string, unknown>): UserRecord {
  return {
    id: Number(row.id),
    email: String(row.email),
    status: String(row.status || 'pending') as UserStatus,
    displayName: row.display_name ? String(row.display_name) : undefined,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    lastSeenAt: row.last_seen_at == null ? undefined : Number(row.last_seen_at)
  };
}

/** Canonicalize an inbound or portal email address before it becomes an identity key. */
export function normalizeUserEmail(value: string): string {
  const raw = normalizePlainText(value).trim().toLowerCase();
  // ForwardableEmailMessage.from is normally already an address, but accepting
  // the common display form makes the identity boundary deterministic.
  const match = raw.match(/<([^<>\s]+@[^<>\s]+)>$/);
  const email = match ? match[1] : raw;
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('invalid-email');
  return email;
}

/** Atomically creates a pending user on first contact, then returns the same row. */
export async function getOrCreateUser(db: Db, emailValue: string, now = nowSeconds()): Promise<{ user: UserRecord | null; created: boolean; tombstoned?: boolean }> {
  const email = normalizeUserEmail(emailValue);
  const tombstone = await db.first('SELECT last_user_id, deleted_at, available_at FROM user_tombstones WHERE email = ?1', email).catch(() => null);
  if (tombstone && Number(tombstone.available_at || 0) > now) return { user: null, created: false, tombstoned: true };
  const inserted = await db.run(
    `INSERT OR IGNORE INTO users (email, status, created_at, updated_at, last_seen_at)
     VALUES (?1, 'pending', ?2, ?2, ?2)`, email, now
  );
  const row = await db.first('SELECT id, email, status, display_name, created_at, updated_at, last_seen_at FROM users WHERE email = ?1', email);
  if (!row) throw new Error('user-record-unavailable');
  let user = rowToUser(row);
  let created = (inserted.changed ?? 0) > 0;
  if (user.status === 'deleted') {
    if (tombstone && Number(tombstone.available_at || 0) <= now) {
      await db.run('DELETE FROM users WHERE id = ?1 AND status = \'deleted\'', user.id);
      await db.run(
        `INSERT OR IGNORE INTO users (email, status, created_at, updated_at, last_seen_at)
         VALUES (?1, 'pending', ?2, ?2, ?2)`, email, now
      );
      const replacement = await db.first('SELECT id, email, status, display_name, created_at, updated_at, last_seen_at FROM users WHERE email = ?1', email);
      if (!replacement) throw new Error('user-record-unavailable');
      user = rowToUser(replacement);
      created = true;
    } else {
      const deletedAt = Number(user.updatedAt || now);
      await db.run(`INSERT INTO user_tombstones (email, last_user_id, deleted_at, available_at, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?3, ?3)
        ON CONFLICT(email) DO UPDATE SET last_user_id = excluded.last_user_id, deleted_at = excluded.deleted_at, available_at = excluded.available_at, updated_at = excluded.updated_at`, email, user.id, deletedAt, deletedAt + USER_DELETION_COOLDOWN_SECONDS).catch(() => undefined);
      return { user: null, created: false, tombstoned: true };
    }
  }
  await db.run('UPDATE users SET updated_at = ?2, last_seen_at = ?2 WHERE id = ?1', user.id, now);
  return { user, created };
}

/** Record the deletion cooldown before user-owned rows are purged. */
export async function recordUserTombstone(db: Db, user: UserRecord, now = nowSeconds()): Promise<void> {
  await db.run(`INSERT INTO user_tombstones (email, last_user_id, deleted_at, available_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?3, ?3)
    ON CONFLICT(email) DO UPDATE SET last_user_id = excluded.last_user_id, deleted_at = excluded.deleted_at, available_at = excluded.available_at, updated_at = excluded.updated_at`, user.email, user.id, now, now + USER_DELETION_COOLDOWN_SECONDS);
}

export async function findUserByEmail(db: Db, emailValue: string): Promise<UserRecord | null> {
  const email = normalizeUserEmail(emailValue);
  const row = await db.first('SELECT id, email, status, display_name, created_at, updated_at, last_seen_at FROM users WHERE email = ?1', email);
  return row ? rowToUser(row) : null;
}

export async function findUserById(db: Db, id: number): Promise<UserRecord | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const row = await db.first('SELECT id, email, status, display_name, created_at, updated_at, last_seen_at FROM users WHERE id = ?1', id);
  return row ? rowToUser(row) : null;
}

const transitions: Record<UserStatus, UserStatus[]> = {
  pending: ['approved', 'declined', 'suspended', 'deleted'],
  approved: ['declined', 'suspended', 'deleted'],
  declined: ['approved', 'suspended', 'deleted'],
  suspended: ['approved', 'declined', 'deleted'],
  deleted: []
};

/** Apply an administrator lifecycle transition and leave an immutable audit row. */
export async function transitionUser(db: Db, id: number, next: UserStatus, actor: string, reason = '', fingerprint = ''): Promise<UserRecord> {
  const current = await findUserById(db, id);
  if (!current) throw new Error('user-not-found');
  if (current.status === next) return current;
  if (!transitions[current.status].includes(next)) throw new Error(`invalid-user-transition:${current.status}->${next}`);
  const now = nowSeconds();
  const approvedFields = next === 'approved' ? ', approved_at = ?4, approved_by = ?5' : '';
  const params: unknown[] = [id, next, now];
  if (next === 'approved') params.push(now, actor);
  await db.run(`UPDATE users SET status = ?2, updated_at = ?3${approvedFields}, deleted_at = CASE WHEN ?2 = 'deleted' THEN ?3 ELSE deleted_at END WHERE id = ?1`, ...params);
  await db.run('INSERT INTO user_lifecycle_events (user_id, actor, old_status, new_status, reason, request_fingerprint, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)', id, actor, current.status, next, reason.slice(0, 1000), fingerprint.slice(0, 200), now);
  if (next === 'suspended' || next === 'deleted') {
    await db.run('UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, ?2) WHERE user_id = ?1', id, now).catch(() => undefined);
    await db.run('DELETE FROM magic_login_tokens WHERE user_id = ?1', id).catch(() => undefined);
    await db.run('DELETE FROM mcp_confirmations WHERE user_id = ?1', id).catch(() => undefined);
    await db.run("UPDATE compaction_jobs SET status = 'cancelled', lease_until = NULL, updated_at = ?2 WHERE user_id = ?1 AND status IN ('pending','processing','failed')", id, now).catch(() => undefined);
  }
  const updated = await findUserById(db, id);
  if (!updated) throw new Error('user-record-unavailable');
  return updated;
}

/** Purge resources that are not covered by sender-email cleanup. Keep the user
 * tombstone row so a deleted identity cannot silently become approved again. */
export async function deleteUserOwnedData(db: Db, env: AppEnv, userId: number): Promise<void> {
  // R2 is outside D1 transactions. Remove objects first, then remove their
  // metadata so an account deletion cannot leave an orphaned private file.
  await deleteUserFiles(db, env, userId);
  const statements = [
    'DELETE FROM magic_login_tokens WHERE user_id = ?1', 'DELETE FROM user_sessions WHERE user_id = ?1',
    'DELETE FROM user_login_outbox WHERE user_id = ?1', 'DELETE FROM user_provider_connections WHERE user_id = ?1',
    'DELETE FROM user_google_oauth_states WHERE user_id = ?1', 'DELETE FROM user_github_oauth_states WHERE user_id = ?1',
    'DELETE FROM oauth_states WHERE user_id = ?1', 'DELETE FROM file_objects WHERE user_id = ?1',
    'DELETE FROM conversation_summaries WHERE user_id = ?1', 'DELETE FROM compaction_jobs WHERE user_id = ?1',
    'DELETE FROM mcp_confirmations WHERE user_id = ?1', 'DELETE FROM user_tool_settings WHERE user_id = ?1',
    'DELETE FROM user_onboarding_notices WHERE user_id = ?1', 'DELETE FROM user_lifecycle_events WHERE user_id = ?1',
    'DELETE FROM user_audit_events WHERE user_id = ?1',
    'DELETE FROM mcp_servers WHERE owner_user_id = ?1'
  ];
  for (const sql of statements) await db.run(sql, userId).catch(() => undefined);
}

/** Return true when a pending acknowledgement may be sent again. */
export async function claimOnboardingNotice(db: Db, userId: number, noticeType: string, deliveryKey: string, now = nowSeconds(), cooldownSeconds = 3600): Promise<boolean> {
  const previous = await db.first('SELECT last_delivery_at FROM user_onboarding_notices WHERE user_id = ?1 AND notice_type = ?2', userId, noticeType);
  if (previous && now - Number(previous.last_delivery_at || 0) < cooldownSeconds) return false;
  const result = await db.run(
    `INSERT INTO user_onboarding_notices (user_id, notice_type, last_delivery_at, delivery_key)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(user_id, notice_type) DO UPDATE SET last_delivery_at = excluded.last_delivery_at, delivery_key = excluded.delivery_key`,
    userId, noticeType, now, deliveryKey
  );
  return (result.changed ?? 0) > 0;
}

export { rowToUser };
