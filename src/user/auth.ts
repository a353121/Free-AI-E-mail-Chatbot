import type { Db } from '../data/db.ts';
import { constantTimeEqual } from '../security/guardrails.ts';
import { nowSeconds } from '../shared.ts';
import { findUserById, type UserRecord } from '../data/users.ts';

const SESSION_COOKIE = 'user_session';
const CSRF_COOKIE = 'user_csrf';
const MAGIC_TTL_SECONDS = 15 * 60;
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function base64Url(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function randomToken(size = 32): string { return base64Url(crypto.getRandomValues(new Uint8Array(size))); }
async function hash(value: string): Promise<string> { return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }
async function signCursor(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}
function decodeBase64Url(value: string): string { return atob(value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4)); }
export async function encodeUserHistoryCursor(secret: string, userId: number, id: number, ttlSeconds = 900): Promise<string> {
  const payload = JSON.stringify({ userId, id, expiresAt: nowSeconds() + ttlSeconds });
  const encoded = base64Url(new TextEncoder().encode(payload));
  return `${encoded}.${await signCursor(secret, encoded)}`;
}
export async function decodeUserHistoryCursor(secret: string, userId: number, token: string | null): Promise<number | null> {
  if (!token || token.length > 512) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || !constantTimeEqual(signature, await signCursor(secret, encoded))) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(encoded)) as { userId?: number; id?: number; expiresAt?: number };
    const id = Number(payload.id);
    return payload.userId === userId && Number(payload.expiresAt) > nowSeconds() && Number.isInteger(id) && id > 0 ? id : null;
  } catch { return null; }
}
function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get('cookie')?.split(';').map(item => item.trim()) || [];
  const entry = cookies.find(item => item.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : null;
}
function sessionCookie(value: string, maxAge: number): string { return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`; }
function csrfCookie(value: string, maxAge: number): string { return `${CSRF_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; Secure; SameSite=Strict`; }

export async function createMagicLogin(db: Db, user: UserRecord, fingerprint: string, deliveryKey: string): Promise<{ token: string; expiresAt: number }> {
  const token = randomToken(32);
  const expiresAt = nowSeconds() + MAGIC_TTL_SECONDS;
  await db.run('DELETE FROM magic_login_tokens WHERE user_id = ?1 AND consumed_at IS NULL', user.id);
  await db.run('INSERT INTO magic_login_tokens (user_id, token_hash, expires_at, created_at, request_fingerprint, delivery_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6)', user.id, await hash(token), expiresAt, nowSeconds(), fingerprint.slice(0, 200), deliveryKey);
  return { token, expiresAt };
}

export async function consumeMagicLogin(db: Db, token: string): Promise<{ user: UserRecord; session: string; csrf: string; expiresAt: number } | null> {
  if (!token || token.length > 200) return null;
  const tokenHash = await hash(token);
  const row = await db.first('SELECT id, user_id FROM magic_login_tokens WHERE token_hash = ?1 AND expires_at > ?2 AND consumed_at IS NULL', tokenHash, nowSeconds());
  if (!row) return null;
  const consumed = await db.run('UPDATE magic_login_tokens SET consumed_at = ?2 WHERE id = ?1 AND consumed_at IS NULL AND expires_at > ?2', Number(row.id), nowSeconds());
  if ((consumed.changed ?? 0) === 0) return null;
  const user = await findUserById(db, Number(row.user_id));
  if (!user || user.status !== 'approved') return null;
  const session = randomToken(40);
  const csrf = randomToken(24);
  const expiresAt = nowSeconds() + SESSION_TTL_SECONDS;
  await db.run('INSERT INTO user_sessions (user_id, token_hash, csrf_hash, expires_at, created_at, last_seen_at, request_fingerprint) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)', user.id, await hash(session), await hash(csrf), expiresAt, nowSeconds(), '');
  return { user, session, csrf, expiresAt };
}

export async function readUserSession(request: Request, db: Db | undefined): Promise<{ user: UserRecord; csrfHash: string; sessionId: number } | null> {
  if (!db) return null;
  const raw = cookieValue(request, SESSION_COOKIE);
  if (!raw) return null;
  const row = await db.first(`SELECT s.id, s.user_id, s.csrf_hash, u.id AS uid, u.email, u.status, u.display_name, u.created_at, u.updated_at, u.last_seen_at
    FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND s.revoked_at IS NULL`, await hash(raw), nowSeconds());
  if (!row || String(row.status) !== 'approved') return null;
  await db.run('UPDATE user_sessions SET last_seen_at = ?2 WHERE id = ?1 AND revoked_at IS NULL', Number(row.id), nowSeconds()).catch(() => undefined);
  return { user: { id: Number(row.uid), email: String(row.email), status: 'approved', displayName: row.display_name ? String(row.display_name) : undefined, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), lastSeenAt: row.last_seen_at == null ? undefined : Number(row.last_seen_at) }, csrfHash: String(row.csrf_hash), sessionId: Number(row.id) };
}

export async function userCsrfValid(request: Request, session: { csrfHash: string } | null): Promise<boolean> {
  if (!session) return false;
  const token = request.headers.get('x-csrf-token') || cookieValue(request, CSRF_COOKIE) || '';
  return Boolean(token) && constantTimeEqual(await hash(token), session.csrfHash);
}

export async function revokeUserSession(db: Db, sessionId: number): Promise<void> { await db.run('UPDATE user_sessions SET revoked_at = ?2 WHERE id = ?1', sessionId, nowSeconds()); }
export async function revokeAllUserSessions(db: Db, userId: number): Promise<void> { await db.run('UPDATE user_sessions SET revoked_at = ?2 WHERE user_id = ?1 AND revoked_at IS NULL', userId, nowSeconds()); }
export async function deleteUserAuth(db: Db, userId: number): Promise<void> {
  await db.run('DELETE FROM magic_login_tokens WHERE user_id = ?1', userId);
  await db.run('DELETE FROM user_login_outbox WHERE user_id = ?1', userId).catch(() => undefined);
  await db.run('DELETE FROM user_sessions WHERE user_id = ?1', userId);
}

export function userSessionCookies(session: { session: string; csrf: string; expiresAt: number }): string[] {
  const maxAge = Math.max(0, session.expiresAt - nowSeconds());
  return [sessionCookie(session.session, maxAge), csrfCookie(session.csrf, maxAge)];
}
export function clearUserSessionCookies(): string[] { return [`${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`, `${CSRF_COOKIE}=; Max-Age=0; Path=/; Secure; SameSite=Strict`]; }
export { CSRF_COOKIE, SESSION_COOKIE, MAGIC_TTL_SECONDS, SESSION_TTL_SECONDS, hash };
