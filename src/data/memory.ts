import type { ChatMessage, MessageRole, ToolCall } from '../types.ts';
import { estimateMessageTokens } from '../agent/tokens.ts';
import { normalizeInboundSubject } from '../email/triggers.ts';
import { normalizePlainText, nowSeconds, safeJsonParse } from '../shared.ts';
import type { Db, Row } from './db.ts';

export const MAX_TURNS = 15;
export const MAX_MESSAGES = MAX_TURNS * 2;
function senderKey(senderEmail: string): string { return normalizePlainText(senderEmail).trim().toLowerCase(); }

/** Stable subject identity used for email conversations. */
export function subjectKey(subject: string): string {
  return normalizeInboundSubject(subject).slice(0, 320);
}

export function conversationKey(subject: string): string {
  const key = subjectKey(subject);
  return key ? `subject:${key}` : 'legacy';
}

export interface ConversationRow {
  id: number;
  user_id: number | null;
  sender_email: string;
  subject: string;
  conversation_key: string;
  subject_key: string;
  summary: string | null;
  metadata: string;
  last_activity: number;
  created_at: number;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  user_id: number | null;
  role: MessageRole;
  name: string | null;
  content: string | null;
  tool_calls: string | null;
  tool_call_id: string | null;
  token_estimate: number;
  created_at: number;
}

export interface FactRow {
  id: number;
  sender_email: string;
  fact: string;
  source: string | null;
  created_at: number;
}

export function toConversation(row: Row): ConversationRow {
  return {
    id: Number(row.id),
    user_id: row.user_id == null ? null : Number(row.user_id),
    sender_email: String(row.sender_email),
    subject: String(row.subject ?? ''),
    conversation_key: String(row.conversation_key ?? 'legacy'),
    subject_key: String(row.subject_key ?? ''),
    summary: row.summary === null || row.summary === undefined ? null : String(row.summary),
    metadata: String(row.metadata ?? '{}'),
    last_activity: Number(row.last_activity),
    created_at: Number(row.created_at)
  };
}

export function toMessage(row: Row): MessageRow {
  return {
    id: Number(row.id),
    conversation_id: Number(row.conversation_id),
    user_id: row.user_id == null ? null : Number(row.user_id),
    role: row.role as MessageRole,
    name: row.name === null ? null : String(row.name),
    content: row.content === null ? null : String(row.content),
    tool_calls: row.tool_calls === null ? null : String(row.tool_calls),
    tool_call_id: row.tool_call_id === null || row.tool_call_id === undefined ? null : String(row.tool_call_id),
    token_estimate: Number(row.token_estimate ?? 0),
    created_at: Number(row.created_at)
  };
}

export async function getConversation(db: Db, senderEmail: string, subject?: string): Promise<ConversationRow | null> {
  const sender = senderKey(senderEmail);
  const row = subject === undefined
    ? await db.first('SELECT * FROM conversations WHERE sender_email = ?1 ORDER BY last_activity DESC LIMIT 1', sender)
    : await db.first('SELECT * FROM conversations WHERE sender_email = ?1 AND conversation_key = ?2 LIMIT 1', sender, conversationKey(subject));
  return row ? toConversation(row) : null;
}

export async function getConversationById(db: Db, id: number): Promise<ConversationRow | null> {
  const row = await db.first('SELECT * FROM conversations WHERE id = ?1', id);
  return row ? toConversation(row) : null;
}

export async function createConversation(
  db: Db,
  senderEmail: string,
  subject: string,
  metadata: Record<string, unknown> = {}
): Promise<ConversationRow> {
  const ts = nowSeconds();
  const displaySubject = subjectKey(subject);
  const key = conversationKey(subject);
  const result = await db.run(
    'INSERT INTO conversations (sender_email, subject, conversation_key, subject_key, summary, metadata, last_activity, created_at) VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6, ?6)',
    senderKey(senderEmail),
    displaySubject,
    key,
    displaySubject,
    JSON.stringify(metadata),
    ts
  );
  const id = Number(result.lastRowId);
  return {
    id,
    user_id: null,
    sender_email: senderKey(senderEmail),
    subject: displaySubject,
    conversation_key: key,
    subject_key: displaySubject,
    summary: null,
    metadata: JSON.stringify(metadata),
    last_activity: ts,
    created_at: ts
  };
}

export async function getOrCreateConversation(
  db: Db,
  senderEmail: string,
  subject: string,
  metadata: Record<string, unknown> = {},
  userId?: number
): Promise<ConversationRow> {
  const sender = senderKey(senderEmail);
  const ts = nowSeconds();
  const displaySubject = subjectKey(subject);
  const key = conversationKey(subject);
  await db.run(
    `INSERT INTO conversations
      (sender_email, user_id, subject, conversation_key, subject_key, summary, metadata, last_activity, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, NULL, ?6, ?7, ?7)
      ON CONFLICT(sender_email, conversation_key) DO UPDATE SET last_activity = excluded.last_activity, user_id = COALESCE(excluded.user_id, conversations.user_id)`,
    sender,
    userId ?? null,
    displaySubject,
    key,
    displaySubject,
    JSON.stringify(metadata),
    ts
  );
  const conversation = await getConversation(db, sender, subject);
  if (!conversation) throw new Error('Conversation could not be created');
  return conversation;
}

export async function setConversationSummary(db: Db, conversationId: number, summary: string): Promise<void> {
  await db.run('UPDATE conversations SET summary = ?1 WHERE id = ?2', normalizePlainText(summary), conversationId);
}

export async function setConversationMetadata(db: Db, conversationId: number, metadata: Record<string, unknown>): Promise<void> {
  await db.run('UPDATE conversations SET metadata = ?1 WHERE id = ?2', JSON.stringify(metadata), conversationId);
}

export async function appendMessage(
  db: Db,
  conversationId: number,
  role: MessageRole,
  content: string | null,
  extra: { name?: string; toolCalls?: unknown; toolCallId?: string } = {}
): Promise<MessageRow> {
  const ts = nowSeconds();
  const normalizedContent = content === null ? null : normalizePlainText(content);
  const serializedToolCalls = extra.toolCalls !== undefined ? JSON.stringify(extra.toolCalls) : null;
  const tokenEstimate = estimateMessageTokens({
    role,
    ...(normalizedContent !== null ? { content: normalizedContent } : {}),
    ...(extra.name ? { name: extra.name } : {}),
    ...(Array.isArray(extra.toolCalls) ? { tool_calls: extra.toolCalls as ToolCall[] } : {}),
    ...(extra.toolCallId ? { tool_call_id: extra.toolCallId } : {})
  });
  const result = await db.run(
    'INSERT INTO messages (conversation_id, user_id, role, name, content, tool_calls, tool_call_id, token_estimate, created_at) VALUES (?1, (SELECT user_id FROM conversations WHERE id = ?1), ?2, ?3, ?4, ?5, ?6, ?7, ?8)',
    conversationId,
    role,
    extra.name ?? null,
    normalizedContent,
    serializedToolCalls,
    extra.toolCallId ?? null,
    tokenEstimate,
    ts
  );
  await db.run('UPDATE conversations SET last_activity = ?1 WHERE id = ?2', ts, conversationId);
  const conversation = await db.first('SELECT user_id FROM conversations WHERE id = ?1', conversationId);
  return {
    id: Number(result.lastRowId),
    conversation_id: conversationId,
    user_id: conversation?.user_id == null ? null : Number(conversation.user_id),
    role,
    name: extra.name ?? null,
    content: normalizedContent,
    tool_calls: serializedToolCalls,
    tool_call_id: extra.toolCallId ?? null,
    token_estimate: tokenEstimate,
    created_at: ts
  };
}

export async function loadRecentMessages(db: Db, conversationId: number, limit = MAX_MESSAGES): Promise<MessageRow[]> {
  const rows = await db.all(
    'SELECT * FROM messages WHERE conversation_id = ?1 ORDER BY id DESC LIMIT ?2',
    conversationId,
    limit
  );
  return rows.reverse().map(toMessage);
}

/**
 * Build the prompt buffer for a conversation:
 * Optionally prefix a summary, then retain the most recent complete turns,
 * including native assistant tool calls and their tool results.
 */
export async function buildConversationBuffer(
  db: Db,
  conversationId: number,
  opts: { includeSummary?: boolean; maxMessages?: number } = {}
): Promise<{ summary: string | null; messages: ChatMessage[] }> {
  const conv = await getConversationById(db, conversationId);
  const summary = conv?.summary || null;

  const incoming = await loadRecentMessages(db, conversationId, opts.maxMessages ?? MAX_MESSAGES);
  const firstUser = incoming.findIndex(message => message.role === 'user');
  const complete = firstUser < 0 ? [] : incoming.slice(firstUser).filter(message => {
    return Boolean((message.content && message.content.trim()) || message.tool_calls);
  });
  const buffer = complete.map((message): ChatMessage => ({
    role: message.role,
    ...(message.content !== null ? { content: message.content } : {}),
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls ? { tool_calls: (safeJsonParse(message.tool_calls) || []) as ToolCall[] } : {})
  }));

  return { summary: opts.includeSummary ?? true ? summary : null, messages: buffer };
}

// ---- Facts ----

export async function rememberFact(db: Db, senderEmail: string, fact: string, source?: string): Promise<FactRow> {
  const realFact = normalizePlainText(fact);
  const ts = nowSeconds();
  const result = await db.run(
    'INSERT INTO facts (sender_email, fact, source, created_at) VALUES (?1, ?2, ?3, ?4)',
    senderKey(senderEmail),
    realFact,
    source ? normalizePlainText(source) : null,
    ts
  );
  return { id: Number(result.lastRowId), sender_email: senderKey(senderEmail), fact: realFact, source: source ?? null, created_at: ts };
}

export async function listFacts(db: Db, senderEmail: string, limit = 50): Promise<FactRow[]> {
  const rows = await db.all(
    'SELECT * FROM facts WHERE sender_email = ?1 ORDER BY created_at DESC LIMIT ?2',
    senderKey(senderEmail),
    limit
  );
  return rows.map(row => ({
    id: Number(row.id),
    sender_email: String(row.sender_email),
    fact: String(row.fact),
    source: row.source === null ? null : String(row.source),
    created_at: Number(row.created_at)
  }));
}

export async function forgetFacts(db: Db, senderEmail: string, topic: string): Promise<number> {
  const cleaned = await db.run(
    'DELETE FROM facts WHERE sender_email = ?1 AND lower(fact) LIKE ?2',
    senderKey(senderEmail),
    `%${topic.trim().toLowerCase()}%`
  );
  return Number(cleaned.changed ?? 0);
}

// ---- Contacts ----

export async function upsertContact(
  db: Db,
  senderEmail: string,
  patch: { name?: string; meta?: Record<string, unknown>; preferences?: Record<string, unknown> }
): Promise<void> {
  const existing = await db.first('SELECT * FROM contacts WHERE sender_email = ?1', senderKey(senderEmail));
  const ts = nowSeconds();

  if (!existing) {
    await db.run(
      'INSERT INTO contacts (sender_email, name, meta, preferences, last_seen) VALUES (?1, ?2, ?3, ?4, ?5)',
      senderKey(senderEmail),
      patch.name ?? null,
      JSON.stringify(patch.meta ?? {}),
      JSON.stringify(patch.preferences ?? {}),
      ts
    );
    return;
  }

  const meta = { ...(safeJsonParse(existing.meta as string) as Record<string, unknown> | null ?? {}), ...patch.meta };
  const prefs = { ...(safeJsonParse(existing.preferences as string) as Record<string, unknown> | null ?? {}), ...patch.preferences };
  await db.run(
    'UPDATE contacts SET name = COALESCE(?1, name), meta = ?2, preferences = ?3, last_seen = ?4 WHERE sender_email = ?5',
    patch.name ?? null,
    JSON.stringify(meta),
    JSON.stringify(prefs),
    ts,
    senderKey(senderEmail)
  );
}

export async function getContact(db: Db, senderEmail: string): Promise<Row | null> {
  return db.first('SELECT * FROM contacts WHERE sender_email = ?1', senderKey(senderEmail));
}

// ---- Knowledge base (RAG source) ----

export async function upsertKnowledge(db: Db, title: string, body: string, tags: string[] = []): Promise<number> {
  const result = await db.run(
    'INSERT INTO knowledge (title, body, tags, created_at) VALUES (?1, ?2, ?3, ?4)',
    normalizePlainText(title),
    normalizePlainText(body),
    JSON.stringify(tags),
    nowSeconds()
  );
  return Number(result.lastRowId);
}

export async function searchKnowledge(db: Db, query: string, limit = 5): Promise<Row[]> {
  const term = `%${query.trim().toLowerCase()}%`;
  return db.all(
    `SELECT * FROM knowledge
     WHERE lower(title) LIKE ?1 OR lower(body) LIKE ?1 OR lower(tags) LIKE ?1
     ORDER BY created_at DESC LIMIT ?2`,
    term,
    limit
  );
}

export async function countKnowledge(db: Db): Promise<number> {
  const row = await db.first('SELECT COUNT(*) AS n FROM knowledge');
  return Number(row?.n ?? 0);
}
