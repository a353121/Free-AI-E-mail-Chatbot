import type { Db } from './db.ts';
import { normalizePlainText } from '../shared.ts';

/** Remove chat, memory, delivery, and execution records while retaining blocks. */
export async function deleteSenderHistory(db: Db, senderEmail: string): Promise<void> {
  const sender = normalizePlainText(senderEmail).toLowerCase();
  const conversationIds = await db.all('SELECT id FROM conversations WHERE sender_email = ?1', sender).catch(() => []);
  const ids = conversationIds.map(row => Number(row.id)).filter(Number.isFinite);
  if (ids.length) {
    for (const id of ids) {
      await db.run('DELETE FROM messages WHERE conversation_id = ?1', id).catch(() => undefined);
      await db.run('DELETE FROM idempotency WHERE conversation_id = ?1', id).catch(() => undefined);
    }
  }
  await db.run('DELETE FROM tool_logs WHERE run_id IN (SELECT id FROM runs WHERE sender_email = ?1)', sender).catch(() => undefined);
  await db.run('DELETE FROM runs WHERE sender_email = ?1', sender).catch(() => undefined);
  await db.run('DELETE FROM idempotency WHERE sender_email = ?1', sender).catch(() => undefined);
  await db.run('DELETE FROM email_outbox WHERE sender_email = ?1', sender).catch(() => undefined);
  await db.run('DELETE FROM mcp_confirmations WHERE sender_email = ?1', sender).catch(() => undefined);
  await db.run("DELETE FROM rate_events WHERE lower(bucket) LIKE 'sender:%:' || ?1", sender).catch(() => undefined);
  await db.run('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE sender_email = ?1)', sender).catch(() => undefined);
  await db.run('DELETE FROM conversations WHERE sender_email = ?1', sender).catch(() => undefined);
  await db.run('DELETE FROM facts WHERE sender_email = ?1', sender).catch(() => undefined);
  await db.run('DELETE FROM contacts WHERE sender_email = ?1', sender).catch(() => undefined);
}

/** Remove every sender-scoped record, including rows created before a conversation existed. */
export async function deleteSenderData(db: Db, senderEmail: string): Promise<void> {
  const sender = normalizePlainText(senderEmail).toLowerCase();
  await deleteSenderHistory(db, sender);
  await db.run('DELETE FROM sender_blocks WHERE sender_email = ?1', sender).catch(() => undefined);
}
