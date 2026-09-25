import type { Db } from './db.ts';
import { nowSeconds } from '../shared.ts';

const MAX_METADATA_BYTES = 2000;

function safeMetadata(value: Record<string, unknown> | undefined): string {
  if (!value) return '{}';
  const cleaned: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(key)) continue;
    if (/(token|secret|password|authorization|header|credential|cookie|magic|cipher|body|content)/i.test(key)) continue;
    if (typeof item === 'string') cleaned[key] = item.replace(/[\r\n]/g, ' ').slice(0, 300);
    else if (typeof item === 'number' && Number.isFinite(item)) cleaned[key] = item;
    else if (typeof item === 'boolean' || item === null) cleaned[key] = item;
  }
  return JSON.stringify(cleaned).slice(0, MAX_METADATA_BYTES);
}

/** Store only redacted security/configuration facts; never pass credential values here. */
export async function recordUserAudit(
  db: Db,
  input: {
    userId: number;
    actor: string;
    action: string;
    targetType?: string;
    targetId?: string | number;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  await db.run(
    `INSERT INTO user_audit_events (user_id, actor, action, target_type, target_id, metadata, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    input.userId,
    input.actor.slice(0, 120),
    input.action.slice(0, 120),
    input.targetType?.slice(0, 80) || null,
    input.targetId == null ? null : String(input.targetId).slice(0, 120),
    safeMetadata(input.metadata),
    nowSeconds()
  );
}

export async function listUserAudit(db: Db, userId: number, limit = 100): Promise<Record<string, unknown>[]> {
  return db.all(
    `SELECT id, actor, action, target_type, target_id, metadata, created_at
       FROM user_audit_events
      WHERE user_id = ?1
      ORDER BY created_at DESC, id DESC
      LIMIT ?2`,
    userId,
    Math.min(200, Math.max(1, Math.trunc(limit)))
  );
}
