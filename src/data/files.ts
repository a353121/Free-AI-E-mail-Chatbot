import type { Db } from './db.ts';
import type { AppEnv } from '../env.ts';
import { nowSeconds } from '../shared.ts';
import { constantTimeEqual } from '../security/guardrails.ts';

interface R2Like { put(key: string, value: ArrayBuffer | ArrayBufferView | ReadableStream | string, options?: unknown): Promise<unknown>; get(key: string): Promise<{ body?: ReadableStream; httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> } | null>; delete(key: string): Promise<void>; }
function r2(env: AppEnv): R2Like | null { return env.R2 ? env.R2 as unknown as R2Like : null; }
function safeFilename(value: string): string { const cleaned = value.replace(/[^a-zA-Z0-9._ -]+/g, '_').trim().slice(0, 160); return cleaned || 'download'; }
function base64Url(bytes: Uint8Array): string { let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
async function fileSignature(secret: string, userId: number, id: number, expiresAt: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`file:${userId}:${id}:${expiresAt}`))));
}
export async function signedFilePath(secret: string, userId: number, id: number, ttlSeconds = 300): Promise<string> {
  const expiresAt = nowSeconds() + Math.min(Math.max(Math.trunc(ttlSeconds), 60), 900);
  return `/user/api/files/${id}?expires=${expiresAt}&signature=${encodeURIComponent(await fileSignature(secret, userId, id, expiresAt))}`;
}
export async function validFileSignature(secret: string, userId: number, id: number, expiresValue: string | null, signature: string | null): Promise<boolean> {
  const expiresAt = Number(expiresValue);
  if (!signature || !Number.isInteger(expiresAt) || expiresAt <= nowSeconds() || expiresAt > nowSeconds() + 900) return false;
  return constantTimeEqual(signature, await fileSignature(secret, userId, id, expiresAt));
}
async function checksum(bytes: Uint8Array): Promise<string> { const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource); return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join(''); }

export async function storeUserFile(db: Db, env: AppEnv, input: { userId: number; conversationId?: number; messageId?: number; filename?: string; contentType?: string; bytes: Uint8Array; sourceUrl?: string; ttlSeconds?: number }): Promise<{ id: number; key: string; expiresAt: number; checksum: string; bytes: number }> {
  const bucket = r2(env);
  if (!bucket) throw new Error('R2 is required for file retention');
  const key = `users/${input.userId}/files/${crypto.randomUUID()}`;
  const digest = await checksum(input.bytes);
  const expiresAt = nowSeconds() + Math.min(Math.max(Math.trunc(input.ttlSeconds || 3 * 86400), 3600), 14 * 86400);
  await bucket.put(key, input.bytes, { httpMetadata: { contentType: input.contentType || 'application/octet-stream' }, customMetadata: { userId: String(input.userId), expiresAt: String(expiresAt) } });
  try {
    const result = await db.run('INSERT INTO file_objects (user_id, conversation_id, message_id, r2_key, filename, content_type, byte_size, checksum, source_url, status, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, \'available\', ?10, ?11)', input.userId, input.conversationId ?? null, input.messageId ?? null, key, safeFilename(input.filename || 'download'), (input.contentType || 'application/octet-stream').slice(0, 200), input.bytes.byteLength, digest, input.sourceUrl ? input.sourceUrl.slice(0, 2000) : null, nowSeconds(), expiresAt);
    return { id: Number(result.lastRowId), key, expiresAt, checksum: digest, bytes: input.bytes.byteLength };
  } catch (error) { await bucket.delete(key).catch(() => undefined); throw error; }
}

/** Keep only a small authenticated portal reference in the transcript. */
export async function appendFileReferences(db: Db, messageId: number, references: string[]): Promise<void> {
  if (!references.length) return;
  const existing = await db.first('SELECT content FROM messages WHERE id = ?1', messageId);
  const suffix = `\n\nAttached files (available for a few days in your account):\n${references.join('\n')}`;
  await db.run('UPDATE messages SET content = ?1 WHERE id = ?2', `${String(existing?.content || '')}${suffix}`.slice(0, 100000), messageId);
}

export async function getUserFile(db: Db, env: AppEnv, userId: number, id: number): Promise<{ row: Record<string, unknown>; object: { body?: ReadableStream; httpMetadata?: Record<string, string> } } | null> {
  const row = await db.first('SELECT * FROM file_objects WHERE id = ?1 AND user_id = ?2 AND status = \'available\'', id, userId);
  if (!row) return null;
  if (Number(row.expires_at || 0) <= nowSeconds()) { await removeUserFile(db, env, userId, id); return null; }
  const bucket = r2(env); if (!bucket) return null;
  const object = await bucket.get(String(row.r2_key));
  return object ? { row, object } : null;
}

export async function removeUserFile(db: Db, env: AppEnv, userId: number, id: number): Promise<boolean> {
  const row = await db.first('SELECT r2_key FROM file_objects WHERE id = ?1 AND user_id = ?2 AND status IN (\'available\',\'quarantined\')', id, userId);
  if (!row) return false;
  await r2(env)?.delete(String(row.r2_key)).catch(() => undefined);
  await db.run("UPDATE file_objects SET status = 'deleted', deleted_at = unixepoch() WHERE id = ?1 AND user_id = ?2", id, userId);
  return true;
}

/** Delete every R2 object owned by a user before their D1 rows are removed. */
export async function deleteUserFiles(db: Db, env: AppEnv, userId: number): Promise<number> {
  const rows = await db.all('SELECT id, r2_key FROM file_objects WHERE user_id = ?1', userId);
  const bucket = r2(env);
  for (const row of rows) {
    if (bucket) await bucket.delete(String(row.r2_key)).catch(() => undefined);
    await db.run("UPDATE file_objects SET status = 'deleted', deleted_at = unixepoch() WHERE id = ?1", Number(row.id)).catch(() => undefined);
  }
  return rows.length;
}

/** Delete R2 objects and file metadata attached to one owned conversation. */
export async function deleteConversationFiles(db: Db, env: AppEnv, userId: number, conversationId: number): Promise<number> {
  const rows = await db.all('SELECT id, r2_key FROM file_objects WHERE user_id = ?1 AND conversation_id = ?2', userId, conversationId);
  const bucket = r2(env);
  for (const row of rows) {
    if (bucket) await bucket.delete(String(row.r2_key)).catch(() => undefined);
    await db.run("UPDATE file_objects SET status = 'deleted', deleted_at = unixepoch() WHERE id = ?1 AND user_id = ?2", Number(row.id), userId).catch(() => undefined);
  }
  return rows.length;
}

export async function cleanupExpiredFiles(db: Db, env: AppEnv, limit = 50): Promise<number> {
  const rows = await db.all("SELECT id, user_id, r2_key FROM file_objects WHERE status = 'available' AND expires_at <= unixepoch() ORDER BY expires_at LIMIT ?1", limit);
  let cleaned = 0;
  for (const row of rows) { await r2(env)?.delete(String(row.r2_key)).catch(() => undefined); await db.run("UPDATE file_objects SET status = 'expired', deleted_at = unixepoch() WHERE id = ?1", Number(row.id)); cleaned += 1; }
  return cleaned;
}
