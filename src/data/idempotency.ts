import type { Db } from './db.ts';
import { nowSeconds } from '../shared.ts';

const LEASE_SECONDS = 300;
const MAX_ATTEMPTS = 8;
export type IdempotencyStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'permanent_failure';

/** Atomically claims a message for processing, including expired retries. */
export async function claimMessage(db: Db, messageId: string, now = nowSeconds(), senderEmail?: string): Promise<boolean> {
  const trimmed = messageId.trim();
  if (!trimmed) return true;
  await db.run(
    `INSERT OR IGNORE INTO idempotency
      (message_id, sender_email, status, attempt_count, created_at, next_attempt_at)
      VALUES (?1, ?2, 'pending', 0, ?3, ?3)`,
    trimmed, senderEmail?.trim().toLowerCase() || null, now
  );
  if (senderEmail) await db.run('UPDATE idempotency SET sender_email = COALESCE(sender_email, ?2) WHERE message_id = ?1', trimmed, senderEmail.trim().toLowerCase());
  const row = await db.first('SELECT status, attempt_count, lease_until, next_attempt_at FROM idempotency WHERE message_id = ?1', trimmed);
  if (!row) return false;
  const status = String(row.status || 'pending') as IdempotencyStatus;
  if (status === 'succeeded' || status === 'permanent_failure') return false;
  if (status === 'processing' && Number(row.lease_until || 0) > now) return false;
  if (Number(row.attempt_count || 0) >= MAX_ATTEMPTS) return false;
  if (Number(row.next_attempt_at || 0) > now) return false;
  const claimed = await db.run(
    `UPDATE idempotency
      SET status = 'processing', attempt_count = attempt_count + 1,
          lease_until = ?2, last_error = NULL
      WHERE message_id = ?1
        AND (status IN ('pending', 'failed') OR (status = 'processing' AND (lease_until IS NULL OR lease_until <= ?3)))
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?3)
        AND attempt_count < ?4`,
    trimmed, now + LEASE_SECONDS, now, MAX_ATTEMPTS
  );
  return (claimed.changed ?? 0) > 0;
}

/** Compatibility wrapper for older callers. */
export async function recordProcessed(db: Db, messageId: string, _conversationId?: number): Promise<boolean> {
  return claimMessage(db, messageId);
}

export async function markMessageSucceeded(db: Db, messageId: string, conversationId?: number): Promise<void> {
  await db.run(
    `UPDATE idempotency SET status = 'succeeded', conversation_id = COALESCE(?2, conversation_id),
      lease_until = NULL, last_error = NULL, next_attempt_at = NULL WHERE message_id = ?1`,
    messageId.trim(), conversationId ?? null
  );
}

export async function markMessageFailed(db: Db, messageId: string, error: string, permanent = false, now = nowSeconds()): Promise<void> {
  const row = await db.first('SELECT attempt_count FROM idempotency WHERE message_id = ?1', messageId.trim());
  const attempt = Number(row?.attempt_count || 1);
  const terminal = permanent || attempt >= MAX_ATTEMPTS;
  const retryAt = now + Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
  await db.run(
    `UPDATE idempotency SET status = ?2, lease_until = NULL, last_error = ?3, next_attempt_at = ?4
      WHERE message_id = ?1`,
    messageId.trim(), terminal ? 'permanent_failure' : 'failed', String(error).slice(0, 1000), terminal ? null : retryAt
  );
}

/** Look up the conversation id recorded for a message-id, if any. */
export async function conversationForMessage(db: Db, messageId: string): Promise<number | null> {
  const row = await db.first('SELECT conversation_id FROM idempotency WHERE message_id = ?1', messageId.trim());
  const id = row?.conversation_id;
  return id === null || id === undefined ? null : Number(id);
}
