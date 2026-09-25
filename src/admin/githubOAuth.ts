import type { Db } from '../data/db.ts';
import type { AppEnv } from '../env.ts';
import { loadAdminSecrets, saveAdminSecrets } from './runtime.ts';
import { fetchValidatedRedirects, validateOutboundUrl } from '../security/guardrails.ts';

const DEFAULT_SCOPES = 'repo read:user user:email offline_access';

function base64Url(bytes: Uint8Array): string { let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''); }
function randomValue(size = 32): string { return base64Url(crypto.getRandomValues(new Uint8Array(size))); }
async function challenge(verifier: string): Promise<string> { return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))); }

export async function beginGitHubOAuth(db: Db, env: AppEnv, origin: string): Promise<{ authorizationUrl: string }> {
  const secrets = await loadAdminSecrets(db, env);
  const clientId = secrets.GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID || '';
  if (!clientId) throw new Error('Set GITHUB_CLIENT_ID in Admin → Secrets first.');
  const redirectUri = `${origin}/admin/api/github/oauth/callback`;
  const verifier = randomValue(48);
  const state = randomValue(32);
  await db.run('DELETE FROM github_oauth_states WHERE expires_at <= unixepoch()');
  await db.run('INSERT INTO github_oauth_states (state, code_verifier, redirect_uri, expires_at, created_at) VALUES (?1, ?2, ?3, unixepoch() + 600, unixepoch())', state, verifier, redirectUri);
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', secrets.GITHUB_SCOPES || env.GITHUB_SCOPES || DEFAULT_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', await challenge(verifier));
  url.searchParams.set('code_challenge_method', 'S256');
  return { authorizationUrl: url.toString() };
}

export async function completeGitHubOAuth(db: Db, env: AppEnv, state: string, code: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const row = await db.first('SELECT * FROM github_oauth_states WHERE state = ?1 AND expires_at > unixepoch()', state);
  if (!row) throw new Error('GitHub OAuth state is invalid or expired');
  await db.run('DELETE FROM github_oauth_states WHERE state = ?1', state);
  const secrets = await loadAdminSecrets(db, env);
  const clientId = secrets.GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID || '';
  const clientSecret = secrets.GITHUB_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET || '';
  if (!clientId || !clientSecret) throw new Error('Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in Admin → Secrets first.');
  const tokenUrl = validateOutboundUrl('https://github.com/login/oauth/access_token').toString();
  const response = await fetchValidatedRedirects(fetchImpl, tokenUrl, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: String(row.redirect_uri), code_verifier: String(row.code_verifier) }) });
  const payload = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; scope?: string; error?: string };
  if (!response.ok || !payload.access_token) throw new Error(`GitHub token exchange failed (${response.status}${payload.error ? `: ${payload.error}` : ''})`);
  const now = Math.floor(Date.now() / 1000);
  const values: Record<string, string> = { GITHUB_ACCESS_TOKEN: payload.access_token, GITHUB_TOKEN_EXPIRES_AT: String(now + Math.max(60, Number(payload.expires_in || 31_536_000))), GITHUB_GRANTED_SCOPES: payload.scope || '' };
  if (payload.refresh_token) values.GITHUB_REFRESH_TOKEN = payload.refresh_token;
  if (payload.refresh_token_expires_in) values.GITHUB_REFRESH_TOKEN_EXPIRES_AT = String(now + Math.max(60, Number(payload.refresh_token_expires_in)));
  await saveAdminSecrets(db, env.ADMIN_SESSION_SECRET || '', values);
}
