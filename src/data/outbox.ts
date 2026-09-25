import type { Db } from './db.ts';
import { nowSeconds } from '../shared.ts';
import type { ThreadHeaders } from '../types.ts';

const LEASE_SECONDS = 300;
const MAX_ATTEMPTS = 8;

export interface OutboxMessage {
  id?: number;
  deliveryKey: string;
  messageId?: string;
  senderEmail: string;
  subject: string;
  body: string;
  headers: ThreadHeaders;
  attemptCount?: number;
}

export async function enqueueEmail(db: Db, message: OutboxMessage, now = nowSeconds()): Promise<void> {
  await db.run(`INSERT OR IGNORE INTO email_outbox
    (delivery_key, message_id, sender_email, subject, body, headers, status, attempt_count, next_attempt_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, ?7, ?7)`,
    message.deliveryKey, message.messageId || null, message.senderEmail, message.subject, message.body, JSON.stringify(message.headers || {}), now);
}

async function claimNext(db: Db, now: number): Promise<OutboxMessage | null> {
  const row = await db.first(`SELECT * FROM email_outbox
    WHERE (status IN ('pending','failed') OR (status = 'processing' AND (lease_until IS NULL OR lease_until <= ?1)))
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?1) AND attempt_count < ?2
    ORDER BY id LIMIT 1`, now, MAX_ATTEMPTS);
  if (!row) return null;
  const changed = await db.run(`UPDATE email_outbox SET status = 'processing', attempt_count = attempt_count + 1,
    lease_until = ?2, updated_at = ?1
    WHERE id = ?3 AND (status IN ('pending','failed') OR (status = 'processing' AND (lease_until IS NULL OR lease_until <= ?1)))`, now, now + LEASE_SECONDS, Number(row.id));
  if ((changed.changed ?? 0) === 0) return null;
  return {
    id: Number(row.id), deliveryKey: String(row.delivery_key), messageId: row.message_id ? String(row.message_id) : undefined,
    senderEmail: String(row.sender_email), subject: String(row.subject), body: String(row.body),
    headers: parseHeaders(row.headers), attemptCount: Number(row.attempt_count || 0) + 1
  };
}

function parseHeaders(value: unknown): ThreadHeaders {
  if (typeof value !== 'string') return {};
  try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as ThreadHeaders : {}; } catch { return {}; }
}

async function markOutboxSucceeded(db: Db, id: number): Promise<void> {
  await db.run("UPDATE email_outbox SET status = 'succeeded', lease_until = NULL, last_error = NULL, next_attempt_at = NULL, updated_at = unixepoch() WHERE id = ?1", id);
}

async function markOutboxFailed(db: Db, id: number, attempt: number, error: unknown, now: number): Promise<void> {
  const permanent = attempt >= MAX_ATTEMPTS;
  const retryAt = now + Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1)));
  await db.run("UPDATE email_outbox SET status = ?2, lease_until = NULL, last_error = ?3, next_attempt_at = ?4, updated_at = ?5 WHERE id = ?1", id, permanent ? 'permanent_failure' : 'failed', String(error instanceof Error ? error.message : error).slice(0, 1000), permanent ? null : retryAt, now);
}

export async function drainEmailOutbox(db: Db, send: (message: OutboxMessage) => Promise<void>, limit = 4, now = nowSeconds()): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  for (let index = 0; index < limit; index += 1) {
    const message = await claimNext(db, nowSeconds());
    if (!message?.id) break;
    try { await send(message); await markOutboxSucceeded(db, message.id); sent += 1; }
    catch (error) { await markOutboxFailed(db, message.id, message.attemptCount || 1, error, nowSeconds()); failed += 1; }
  }
  return { sent, failed };
}
