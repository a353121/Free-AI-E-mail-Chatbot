import type { Db } from '../data/db.ts';
import type { AppEnv } from '../env.ts';
import { encryptAdminSecret, decryptAdminSecret } from '../admin/runtime.ts';
import { nowSeconds } from '../shared.ts';
import { sendEmail } from '../providers/sendEmail.ts';

const LEASE_SECONDS = 300;
const MAX_ATTEMPTS = 8;

export async function enqueueUserLoginEmail(db: Db, env: AppEnv, input: { deliveryKey: string; userId: number; recipient: string; subject: string; body: string; headers?: Record<string, string> }): Promise<void> {
  if (!env.ADMIN_SESSION_SECRET) throw new Error('admin encryption key is required for login delivery');
  await db.run(`INSERT OR IGNORE INTO user_login_outbox
    (delivery_key, user_id, recipient, subject, body_ciphertext, headers, status, attempt_count, next_attempt_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, ?7, ?7)`,
    input.deliveryKey, input.userId, input.recipient, input.subject, await encryptAdminSecret(env.ADMIN_SESSION_SECRET, input.body), JSON.stringify(input.headers || {}), nowSeconds());
}

async function claim(db: Db, now: number): Promise<Record<string, unknown> | null> {
  const row = await db.first(`SELECT * FROM user_login_outbox WHERE (status IN ('pending','failed') OR (status = 'processing' AND (lease_until IS NULL OR lease_until <= ?1))) AND next_attempt_at <= ?1 AND attempt_count < ?2 ORDER BY id LIMIT 1`, now, MAX_ATTEMPTS);
  if (!row) return null;
  const changed = await db.run(`UPDATE user_login_outbox SET status = 'processing', attempt_count = attempt_count + 1, lease_until = ?2, updated_at = ?1 WHERE id = ?3 AND (status IN ('pending','failed') OR (status = 'processing' AND (lease_until IS NULL OR lease_until <= ?1)))`, now, now + LEASE_SECONDS, Number(row.id));
  return (changed.changed ?? 0) > 0 ? { ...row, attempt_count: Number(row.attempt_count || 0) + 1 } : null;
}

export async function drainUserLoginOutbox(db: Db, env: AppEnv, limit = 2): Promise<void> {
  if (!env.ADMIN_SESSION_SECRET) return;
  for (let index = 0; index < limit; index += 1) {
    const row = await claim(db, nowSeconds());
    if (!row) return;
    try {
      const body = await decryptAdminSecret(env.ADMIN_SESSION_SECRET, String(row.body_ciphertext));
      if (!body) throw new Error('login-message-decryption-failed');
      let headers: Record<string, string> = {};
      try { const parsed = JSON.parse(String(row.headers || '{}')); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) headers = parsed as Record<string, string>; } catch { /* empty headers */ }
      await sendEmail(env, String(row.recipient), String(row.subject), body, headers);
      await db.run("UPDATE user_login_outbox SET status = 'succeeded', lease_until = NULL, last_error = NULL, updated_at = unixepoch() WHERE id = ?1", Number(row.id));
    } catch (error) {
      const attempt = Number(row.attempt_count || 1);
      const permanent = attempt >= MAX_ATTEMPTS;
      await db.run("UPDATE user_login_outbox SET status = ?2, lease_until = NULL, last_error = ?3, next_attempt_at = ?4, updated_at = ?5 WHERE id = ?1", Number(row.id), permanent ? 'permanent_failure' : 'failed', String(error instanceof Error ? error.message : error).slice(0, 1000), permanent ? null : nowSeconds() + Math.min(3600, 30 * (2 ** Math.max(0, attempt - 1))), nowSeconds());
    }
  }
}
