import type { Db, Row } from './db.ts';
import type { AppEnv } from '../env.ts';
import { deleteConversationFiles } from './files.ts';

function numberParam(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.trunc(parsed))) : fallback;
}

export interface HistoryPage {
  conversations: Row[];
  nextCursor: number | null;
}

/** Export a bounded, owner-scoped JSON archive without including R2 bytes. */
export async function exportUserHistory(db: Db, userId: number): Promise<Record<string, unknown>> {
  const conversations = await db.all('SELECT id, subject, summary, metadata, last_activity, created_at FROM conversations WHERE user_id = ?1 ORDER BY last_activity DESC, id DESC LIMIT 100', userId);
  const result: Array<Record<string, unknown>> = [];
  let bytes = 0;
  for (const conversation of conversations) {
    const messages = await db.all('SELECT id, role, name, content, tool_calls, tool_call_id, created_at FROM messages WHERE conversation_id = ?1 AND user_id = ?2 ORDER BY id LIMIT 500', Number(conversation.id), userId);
    const files = await db.all("SELECT id, message_id, filename, content_type, byte_size, checksum, source_url, status, created_at, expires_at FROM file_objects WHERE conversation_id = ?1 AND user_id = ?2 AND status = 'available' ORDER BY created_at", Number(conversation.id), userId);
    const item = { conversation, messages, files };
    const itemBytes = new TextEncoder().encode(JSON.stringify(item)).byteLength;
    if (bytes + itemBytes > 2_000_000) break;
    result.push(item);
    bytes += itemBytes;
  }
  return { format: 'ai-email-chatbot-history-v1', exportedAt: new Date().toISOString(), userId, truncated: result.length < conversations.length, conversations: result };
}

/** List only conversations belonging to the authenticated user. */
export async function listUserConversations(db: Db, userId: number, input: { limit?: number; cursor?: number; query?: string } = {}): Promise<HistoryPage> {
  const limit = Math.min(50, Math.max(1, Math.trunc(input.limit || 20)));
  const query = (input.query || '').trim().slice(0, 200);
  const conditions = ['c.user_id = ?1'];
  const params: unknown[] = [userId];
  if (input.cursor && input.cursor > 0) { conditions.push(`c.id < ?${params.length + 1}`); params.push(input.cursor); }
  if (query) {
    const placeholder = `?${params.length + 1}`;
    conditions.push(`(lower(c.subject) LIKE ${placeholder} OR lower(c.sender_email) LIKE ${placeholder}
      OR EXISTS (SELECT 1 FROM messages sm WHERE sm.conversation_id = c.id AND sm.user_id = ?1 AND (lower(COALESCE(sm.content, '')) LIKE ${placeholder} OR lower(COALESCE(sm.tool_calls, '')) LIKE ${placeholder}))
      OR EXISTS (SELECT 1 FROM file_objects sf WHERE sf.conversation_id = c.id AND sf.user_id = ?1 AND lower(sf.filename) LIKE ${placeholder}))`);
    params.push(`%${query.toLowerCase()}%`);
  }
  params.push(limit + 1);
  const rows = await db.all(`SELECT c.id, c.subject, c.summary, c.last_activity, c.created_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message
    FROM conversations c WHERE ${conditions.join(' AND ')} ORDER BY c.last_activity DESC, c.id DESC LIMIT ?${params.length}`, ...params);
  const page = rows.slice(0, limit);
  return { conversations: page, nextCursor: rows.length > limit ? Number(page.at(-1)?.id || 0) || null : null };
}

/** Read the durable transcript and file references for one owned conversation. */
export async function readUserConversation(db: Db, userId: number, conversationId: number, input: { limit?: number; before?: number } = {}): Promise<{ conversation: Row; messages: Row[]; files: Row[] } | null> {
  const conversation = await db.first('SELECT id, subject, summary, metadata, last_activity, created_at FROM conversations WHERE id = ?1 AND user_id = ?2', conversationId, userId);
  if (!conversation) return null;
  const limit = Math.min(200, Math.max(1, Math.trunc(input.limit || 100)));
  const messages = input.before && input.before > 0
    ? await db.all('SELECT id, role, name, content, tool_calls, tool_call_id, created_at FROM messages WHERE conversation_id = ?1 AND user_id = ?2 AND id < ?3 ORDER BY id DESC LIMIT ?4', conversationId, userId, input.before, limit)
    : await db.all('SELECT id, role, name, content, tool_calls, tool_call_id, created_at FROM messages WHERE conversation_id = ?1 AND user_id = ?2 ORDER BY id DESC LIMIT ?3', conversationId, userId, limit);
  const files = await db.all("SELECT id, message_id, filename, content_type, byte_size, checksum, source_url, status, created_at, expires_at FROM file_objects WHERE conversation_id = ?1 AND user_id = ?2 AND status = 'available' ORDER BY created_at DESC", conversationId, userId);
  return { conversation, messages: messages.reverse(), files };
}

/** Delete one conversation and all durable data attached to it. */
export async function deleteUserConversation(db: Db, env: AppEnv, userId: number, conversationId: number): Promise<boolean> {
  const owned = await db.first('SELECT id FROM conversations WHERE id = ?1 AND user_id = ?2', conversationId, userId);
  if (!owned) return false;
  await deleteConversationFiles(db, env, userId, conversationId);
  const statements = [
    'DELETE FROM tool_logs WHERE run_id IN (SELECT id FROM runs WHERE conversation_id = ?1)',
    'DELETE FROM messages WHERE conversation_id = ?1',
    'DELETE FROM idempotency WHERE conversation_id = ?1',
    'DELETE FROM runs WHERE conversation_id = ?1',
    'DELETE FROM conversation_summaries WHERE conversation_id = ?1',
    'DELETE FROM compaction_jobs WHERE conversation_id = ?1',
    'DELETE FROM file_objects WHERE conversation_id = ?1',
    'DELETE FROM conversations WHERE id = ?1 AND user_id = ?2'
  ];
  for (const [index, sql] of statements.entries()) {
    const params = index === statements.length - 1 ? [conversationId, userId] : [conversationId];
    await db.run(sql, ...params).catch(() => undefined);
  }
  return true;
}
