import type { Db } from '../data/db.ts';
import type { AppEnv } from '../env.ts';
import { loadAdminSecrets, saveAdminSecrets } from './runtime.ts';
import { fetchValidatedRedirects, validateOutboundUrl } from '../security/guardrails.ts';

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive'
].join(' ');

function base64Url(bytes: Uint8Array): string { let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function randomValue(size = 32): string { return base64Url(crypto.getRandomValues(new Uint8Array(size))); }
async function challenge(verifier: string): Promise<string> { return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))); }
function json(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }

export async function beginGoogleOAuth(db: Db, env: AppEnv, origin: string): Promise<{ authorizationUrl: string }> {
  const secrets = await loadAdminSecrets(db, env);
  const clientId = secrets.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || '';
  if (!clientId) throw new Error('Set GOOGLE_CLIENT_ID in Admin → Secrets first.');
  const redirectUri = `${origin}/admin/api/google/oauth/callback`;
  const verifier = randomValue(48);
  const state = randomValue(32);
  await db.run('DELETE FROM google_oauth_states WHERE expires_at <= unixepoch()');
  await db.run('INSERT INTO google_oauth_states (state, code_verifier, redirect_uri, expires_at, created_at) VALUES (?1, ?2, ?3, unixepoch() + 600, unixepoch())', state, verifier, redirectUri);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('scope', secrets.GOOGLE_SCOPES || env.GOOGLE_SCOPES || DEFAULT_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', await challenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return { authorizationUrl: url.toString() };
}

export async function completeGoogleOAuth(db: Db, env: AppEnv, state: string, code: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const row = await db.first('SELECT * FROM google_oauth_states WHERE state = ?1 AND expires_at > unixepoch()', state);
  if (!row) throw new Error('Google OAuth state is invalid or expired');
  await db.run('DELETE FROM google_oauth_states WHERE state = ?1', state);
  const secrets = await loadAdminSecrets(db, env);
  const clientId = secrets.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || '';
  const clientSecret = secrets.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Admin → Secrets first.');
  const tokenUrl = validateOutboundUrl('https://oauth2.googleapis.com/token').toString();
  const response = await fetchValidatedRedirects(fetchImpl, tokenUrl, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: String(row.redirect_uri), grant_type: 'authorization_code', code_verifier: String(row.code_verifier) }) });
  const payload = json(await response.json().catch(() => ({})));
  if (!response.ok || typeof payload.access_token !== 'string') throw new Error(`Google token exchange failed (${response.status})`);
  const values: Record<string, string> = { GOOGLE_ACCESS_TOKEN: payload.access_token, GOOGLE_TOKEN_EXPIRES_AT: String(Math.floor(Date.now() / 1000) + Math.max(60, Number(payload.expires_in || 3600))) };
  if (typeof payload.scope === 'string') values.GOOGLE_GRANTED_SCOPES = payload.scope;
  if (typeof payload.refresh_token === 'string') values.GOOGLE_REFRESH_TOKEN = payload.refresh_token;
  await saveAdminSecrets(db, env.ADMIN_SESSION_SECRET || '', values);
}

export async function revokeGoogleOAuth(db: Db, env: AppEnv, fetchImpl: typeof fetch = fetch): Promise<void> {
  const secrets = await loadAdminSecrets(db, env);
  const token = secrets.GOOGLE_REFRESH_TOKEN || secrets.GOOGLE_ACCESS_TOKEN;
  if (token) {
    try {
      await fetchValidatedRedirects(fetchImpl, validateOutboundUrl('https://oauth2.googleapis.com/revoke').toString(), { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }) });
    } catch { /* local deletion still prevents future use */ }
  }
  await db.run("DELETE FROM admin_secrets WHERE name IN ('GOOGLE_ACCESS_TOKEN', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_TOKEN_EXPIRES_AT', 'GOOGLE_GRANTED_SCOPES')");
}
