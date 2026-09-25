import type { Db } from './db.ts';
import { nowSeconds } from '../shared.ts';

export interface RateLimitResult { allowed: boolean; senderCount: number; globalCount: number; reason?: string; }

function hourBucket(timestamp: number): string { const date = new Date(timestamp * 1000); return `sender:${date.toISOString().slice(0, 13)}`; }
function dayBucket(timestamp: number): string { return `global:${new Date(timestamp * 1000).toISOString().slice(0, 10)}`; }

export async function checkRateLimit(db: Db, sender: string, perSender: number, globalPerDay: number, timestamp = nowSeconds()): Promise<RateLimitResult> {
  const senderBucket = `${hourBucket(timestamp)}:${sender.trim().toLowerCase()}`;
  const globalBucket = dayBucket(timestamp);
  const senderRow = await db.first('SELECT COUNT(*) AS count FROM rate_events WHERE bucket = ?1 AND ts >= ?2', senderBucket, timestamp - 3600);
  const globalRow = await db.first('SELECT COUNT(*) AS count FROM rate_events WHERE bucket = ?1 AND ts >= ?2', globalBucket, timestamp - 86400);
  const senderCount = Number(senderRow?.count ?? 0);
  const globalCount = Number(globalRow?.count ?? 0);
  if (senderCount >= perSender) return { allowed: false, senderCount, globalCount, reason: 'sender-rate-limit' };
  if (globalCount >= globalPerDay) return { allowed: false, senderCount, globalCount, reason: 'global-rate-limit' };
  const eventId = crypto.randomUUID();
  const senderInsert = await db.run(
    `INSERT INTO rate_events (event_id, bucket, ts)
      SELECT ?1, ?2, ?3
      WHERE (SELECT COUNT(*) FROM rate_events WHERE bucket = ?2 AND ts >= ?4) < ?5`,
    eventId, senderBucket, timestamp, timestamp - 3600, perSender
  );
  if ((senderInsert.changed ?? 0) === 0) {
    return { allowed: false, senderCount: senderCount + 1, globalCount, reason: 'sender-rate-limit' };
  }
  const globalInsert = await db.run(
    `INSERT INTO rate_events (event_id, bucket, ts)
      SELECT ?1, ?2, ?3
      WHERE (SELECT COUNT(*) FROM rate_events WHERE bucket = ?2 AND ts >= ?4) < ?5`,
    `${eventId}:global`, globalBucket, timestamp, timestamp - 86400, globalPerDay
  );
  if ((globalInsert.changed ?? 0) === 0) {
    await db.run('DELETE FROM rate_events WHERE event_id = ?1', eventId);
    return { allowed: false, senderCount, globalCount: globalCount + 1, reason: 'global-rate-limit' };
  }
  return { allowed: true, senderCount: senderCount + 1, globalCount: globalCount + 1 };
}

export async function purgeRateEvents(db: Db, olderThanSeconds = nowSeconds() - 172800): Promise<void> {
  await db.run('DELETE FROM rate_events WHERE ts < ?1', olderThanSeconds);
}
