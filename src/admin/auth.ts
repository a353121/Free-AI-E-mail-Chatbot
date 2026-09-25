import type { Db } from '../data/db.ts';
import type { AppEnv } from '../env.ts';
import { constantTimeEqual } from '../security/guardrails.ts';
import { nowSeconds } from '../shared.ts';

const SESSION_COOKIE = 'admin_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 8;

function base64Url(bytes: Uint8Array): string { let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function fromBase64Url(value: string): Uint8Array { const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4); const raw = atob(padded); return Uint8Array.from(raw, char => char.charCodeAt(0)); }
async function hmac(secret: string, value: string): Promise<string> { const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))); }
async function digest(value: string): Promise<string> { return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))); }

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' }, material, 256));
}

/** Format: pbkdf2-sha256$iterations$base64url-salt$base64url-hash. */
export async function verifyAdminPassword(password: string, encoded: string): Promise<boolean> {
  try {
    const [algorithm, iterationText, saltText, hashText] = encoded.split('$');
    const iterations = Number(iterationText);
    if (algorithm !== 'pbkdf2-sha256' || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) return false;
    const actual = base64Url(await pbkdf2(password, fromBase64Url(saltText), iterations));
    return constantTimeEqual(actual, hashText);
  } catch { return false; }
}

export async function makeAdminSession(secret: string): Promise<{ value: string; csrf: string; expires: number }> {
  const expires = nowSeconds() + SESSION_TTL_SECONDS;
  const csrf = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const payload = `${expires}.${csrf}`;
  return { value: `${payload}.${await hmac(secret, payload)}`, csrf, expires };
}

function cookieValue(request: Request): string | null {
  const cookies = request.headers.get('cookie')?.split(';').map(item => item.trim()) || [];
  const entry = cookies.find(item => item.startsWith(`${SESSION_COOKIE}=`));
  return entry ? decodeURIComponent(entry.slice(SESSION_COOKIE.length + 1)) : null;
}

export async function readAdminSession(request: Request, secret: string | undefined): Promise<{ csrf: string; expires: number } | null> {
  if (!secret) return null;
  const value = cookieValue(request);
  if (!value) return null;
  const [expiresText, csrf, signature] = value.split('.');
  const expires = Number(expiresText);
  if (!csrf || !signature || !Number.isInteger(expires) || expires <= nowSeconds()) return null;
  const expected = await hmac(secret, `${expires}.${csrf}`);
  return constantTimeEqual(expected, signature) ? { csrf, expires } : null;
}

export function sessionCookie(value: string, maxAge: number): string { return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/admin; HttpOnly; Secure; SameSite=Strict`; }
export function clearSessionCookie(): string { return `${SESSION_COOKIE}=; Max-Age=0; Path=/admin; HttpOnly; Secure; SameSite=Strict`; }

export function clientFingerprint(request: Request): string { return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown'; }

export async function loginAllowed(db: Db | undefined, request: Request): Promise<boolean> {
  if (!db) return true;
  const fingerprint = await digest(clientFingerprint(request));
  try {
    const row = await db.first('SELECT COUNT(*) AS count FROM admin_login_events WHERE fingerprint = ?1 AND success = 0 AND created_at >= ?2', fingerprint, nowSeconds() - LOGIN_WINDOW_SECONDS);
    return Number(row?.count || 0) < LOGIN_MAX_FAILURES;
  } catch { return true; }
}

export async function recordLogin(db: Db | undefined, request: Request, success: boolean): Promise<void> {
  if (!db) return;
  const fingerprint = await digest(clientFingerprint(request));
  try {
    await db.run('INSERT INTO admin_login_events (fingerprint, success, created_at) VALUES (?1, ?2, ?3)', fingerprint, success ? 1 : 0, nowSeconds());
    await db.run('DELETE FROM admin_login_events WHERE created_at < ?1', nowSeconds() - 86400);
  } catch { /* never turn an auth audit failure into an authenticated response */ }
}

export function csrfValid(request: Request, session: { csrf: string } | null): boolean {
  if (!session) return false;
  return constantTimeEqual(request.headers.get('x-csrf-token') || '', session.csrf);
}

export { SESSION_COOKIE, SESSION_TTL_SECONDS };
