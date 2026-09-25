import type { Db } from '../data/db.ts';
import type { AppEnv } from '../env.ts';
import { loadAdminSecrets } from '../admin/runtime.ts';
import { saveUserProvider } from './providers.ts';
import { nowSeconds } from '../shared.ts';

function base64Url(bytes: Uint8Array): string { let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function randomValue(size = 32): string { return base64Url(crypto.getRandomValues(new Uint8Array(size))); }
async function challenge(verifier: string): Promise<string> { return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))); }

const GOOGLE_DEFAULT_SCOPES = 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive.readonly';
const GITHUB_DEFAULT_SCOPES = 'repo read:user user:email offline_access';

async function googleIdentity(accessToken: string, fetchImpl: typeof fetch): Promise<{ subject?: string; email?: string; name?: string }> {
  try {
    const response = await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo', { headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` } });
    if (!response.ok) return {};
    const value = await response.json() as { sub?: string; email?: string; name?: string };
    return { subject: typeof value.sub === 'string' ? value.sub.slice(0, 320) : undefined, email: typeof value.email === 'string' ? value.email.slice(0, 320) : undefined, name: typeof value.name === 'string' ? value.name.slice(0, 320) : undefined };
  } catch { return {}; }
}

async function githubIdentity(accessToken: string, fetchImpl: typeof fetch): Promise<{ subject?: string; login?: string; email?: string; name?: string }> {
  try {
    const response = await fetchImpl('https://api.github.com/user', { headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${accessToken}`, 'user-agent': 'ai-email-chatbot' } });
    if (!response.ok) return {};
    const value = await response.json() as { id?: number; login?: string; email?: string; name?: string };
    return { subject: Number.isFinite(Number(value.id)) ? String(value.id) : undefined, login: typeof value.login === 'string' ? value.login.slice(0, 320) : undefined, email: typeof value.email === 'string' ? value.email.slice(0, 320) : undefined, name: typeof value.name === 'string' ? value.name.slice(0, 320) : undefined };
  } catch { return {}; }
}

export async function beginUserGoogleOAuth(db: Db, env: AppEnv, userId: number, origin: string): Promise<{ authorizationUrl: string }> {
  const secrets = await loadAdminSecrets(db, env);
  const clientId = secrets.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || '';
  if (!clientId) throw new Error('The administrator must configure the Google OAuth client first.');
  const verifier = randomValue(48); const state = randomValue(32); const redirectUri = `${origin}/user/api/providers/google/oauth/callback`;
  await db.run('INSERT INTO user_google_oauth_states (state, user_id, code_verifier, redirect_uri, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)', state, userId, verifier, redirectUri, nowSeconds() + 600);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth'); url.searchParams.set('client_id', clientId); url.searchParams.set('redirect_uri', redirectUri); url.searchParams.set('response_type', 'code'); url.searchParams.set('scope', secrets.GOOGLE_SCOPES || env.GOOGLE_SCOPES || GOOGLE_DEFAULT_SCOPES); url.searchParams.set('access_type', 'offline'); url.searchParams.set('prompt', 'consent'); url.searchParams.set('state', state); url.searchParams.set('code_challenge', await challenge(verifier)); url.searchParams.set('code_challenge_method', 'S256');
  return { authorizationUrl: url.toString() };
}

export async function completeUserGoogleOAuth(db: Db, env: AppEnv, state: string, code: string, fetchImpl: typeof fetch = fetch, expectedUserId?: number): Promise<number> {
  const row = await db.first('SELECT * FROM user_google_oauth_states WHERE state = ?1 AND expires_at > unixepoch()', state);
  if (!row) throw new Error('Google OAuth state is invalid or expired');
  if (expectedUserId !== undefined && Number(row.user_id) !== expectedUserId) throw new Error('OAuth ownership mismatch');
  await db.run('DELETE FROM user_google_oauth_states WHERE state = ?1', state);
  const secrets = await loadAdminSecrets(db, env); const clientId = secrets.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID || ''; const clientSecret = secrets.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET || '';
  const response = await fetchImpl('https://oauth2.googleapis.com/token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: String(row.redirect_uri), grant_type: 'authorization_code', code_verifier: String(row.code_verifier) }) });
  const payload = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; id_token?: string };
  if (!response.ok || !payload.access_token) throw new Error('Google token exchange failed');
  const identity = await googleIdentity(payload.access_token, fetchImpl);
  await saveUserProvider(db, env.ADMIN_SESSION_SECRET || '', Number(row.user_id), 'google', { GOOGLE_ACCESS_TOKEN: payload.access_token, GOOGLE_REFRESH_TOKEN: payload.refresh_token || '', expiresAt: nowSeconds() + Math.max(60, Number(payload.expires_in || 3600)), grantedScopes: payload.scope || '', providerSubject: identity.subject }, { accountEmail: identity.email || '', accountName: identity.name || '' });
  return Number(row.user_id);
}

export async function beginUserGitHubOAuth(db: Db, env: AppEnv, userId: number, origin: string): Promise<{ authorizationUrl: string }> {
  const secrets = await loadAdminSecrets(db, env); const clientId = secrets.GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID || '';
  if (!clientId) throw new Error('The administrator must configure the GitHub OAuth client first.');
  const verifier = randomValue(48); const state = randomValue(32); const redirectUri = `${origin}/user/api/providers/github/oauth/callback`;
  await db.run('INSERT INTO user_github_oauth_states (state, user_id, code_verifier, redirect_uri, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)', state, userId, verifier, redirectUri, nowSeconds() + 600);
  const url = new URL('https://github.com/login/oauth/authorize'); url.searchParams.set('client_id', clientId); url.searchParams.set('redirect_uri', redirectUri); url.searchParams.set('scope', secrets.GITHUB_SCOPES || env.GITHUB_SCOPES || GITHUB_DEFAULT_SCOPES); url.searchParams.set('state', state); url.searchParams.set('code_challenge', await challenge(verifier)); url.searchParams.set('code_challenge_method', 'S256');
  return { authorizationUrl: url.toString() };
}

export async function completeUserGitHubOAuth(db: Db, env: AppEnv, state: string, code: string, fetchImpl: typeof fetch = fetch, expectedUserId?: number): Promise<number> {
  const row = await db.first('SELECT * FROM user_github_oauth_states WHERE state = ?1 AND expires_at > unixepoch()', state);
  if (!row) throw new Error('GitHub OAuth state is invalid or expired');
  if (expectedUserId !== undefined && Number(row.user_id) !== expectedUserId) throw new Error('OAuth ownership mismatch');
  await db.run('DELETE FROM user_github_oauth_states WHERE state = ?1', state);
  const secrets = await loadAdminSecrets(db, env); const clientId = secrets.GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID || ''; const clientSecret = secrets.GITHUB_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET || '';
  const response = await fetchImpl('https://github.com/login/oauth/access_token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: String(row.redirect_uri), code_verifier: String(row.code_verifier) }) });
  const payload = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; scope?: string };
  if (!response.ok || !payload.access_token) throw new Error('GitHub token exchange failed');
  const identity = await githubIdentity(payload.access_token, fetchImpl);
  await saveUserProvider(db, env.ADMIN_SESSION_SECRET || '', Number(row.user_id), 'github', { GITHUB_ACCESS_TOKEN: payload.access_token, GITHUB_REFRESH_TOKEN: payload.refresh_token || '', expiresAt: nowSeconds() + Math.max(60, Number(payload.expires_in || 31_536_000)), grantedScopes: payload.scope || '', providerSubject: identity.subject }, { accountEmail: identity.email || '', accountLogin: identity.login || '', accountName: identity.name || '' });
  return Number(row.user_id);
}
