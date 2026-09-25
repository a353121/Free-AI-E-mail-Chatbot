import type { Db } from '../data/db.ts';
import type { AppEnv } from '../env.ts';
import { decryptAdminSecret, encryptAdminSecret, loadAdminSecrets } from '../admin/runtime.ts';
import { nowSeconds } from '../shared.ts';

const USER_SECRET_KEYS = [
  'GITHUB_TOKEN', 'GITHUB_ACCESS_TOKEN', 'GITHUB_REFRESH_TOKEN',
  'GITLAB_TOKEN', 'LINEAR_API_KEY', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_BASE_URL',
  'ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_TOKEN', 'HUBSPOT_ACCESS_TOKEN', 'STRIPE_API_KEY',
  'SHOPIFY_DOMAIN', 'SHOPIFY_ACCESS_TOKEN', 'GMAIL_ACCESS_TOKEN', 'GOOGLE_ACCESS_TOKEN', 'GOOGLE_REFRESH_TOKEN',
  'OUTLOOK_TOKEN', 'NOTION_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID', 'TWITTER_ACCESS_TOKEN',
  'TWITTER_ACCESS_SECRET', 'LINKEDIN_ACCESS_TOKEN', 'NEWSAPI_KEY', 'ALPHAVANTAGE_KEY', 'OPENWEATHER_KEY',
  'SERPAPI_KEY', 'TAVILY_API_KEY', 'BING_SEARCH_KEY', 'RESEND_API_KEY', 'MAILGUN_API_KEY', 'SENDGRID_API_KEY',
  'SLACK_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER', 'OPENAI_API_KEY', 'OPENAI_COMPATIBLE_API_KEY', 'ANTHROPIC_API_KEY'
] as const;

const PROVIDER_FIELDS: Record<string, string[]> = {
  github: ['GITHUB_TOKEN', 'GITHUB_ACCESS_TOKEN', 'GITHUB_REFRESH_TOKEN'],
  google: ['GOOGLE_ACCESS_TOKEN', 'GOOGLE_REFRESH_TOKEN', 'GMAIL_ACCESS_TOKEN'],
  gitlab: ['GITLAB_TOKEN'], linear: ['LINEAR_API_KEY'], jira: ['JIRA_EMAIL', 'JIRA_API_TOKEN', 'JIRA_BASE_URL'],
  zendesk: ['ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_TOKEN'], hubspot: ['HUBSPOT_ACCESS_TOKEN'], stripe: ['STRIPE_API_KEY'],
  shopify: ['SHOPIFY_DOMAIN', 'SHOPIFY_ACCESS_TOKEN'], microsoft: ['OUTLOOK_TOKEN'], notion: ['NOTION_API_KEY'], airtable: ['AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID'],
  x: ['TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET'], linkedin: ['LINKEDIN_ACCESS_TOKEN'], newsapi: ['NEWSAPI_KEY'], alphavantage: ['ALPHAVANTAGE_KEY'],
  openweather: ['OPENWEATHER_KEY'], serpapi: ['SERPAPI_KEY'], tavily: ['TAVILY_API_KEY'], bing: ['BING_SEARCH_KEY'], resend: ['RESEND_API_KEY'],
  mailgun: ['MAILGUN_API_KEY'], sendgrid: ['SENDGRID_API_KEY'], slack: ['SLACK_WEBHOOK_URL'], discord: ['DISCORD_WEBHOOK_URL'], telegram: ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'],
  twilio: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'], openai: ['OPENAI_API_KEY'], 'openai-compatible': ['OPENAI_COMPATIBLE_API_KEY'], anthropic: ['ANTHROPIC_API_KEY']
};

function fieldLabel(key: string): string { return key.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, character => character.toUpperCase()); }
function fieldIsSecret(key: string): boolean { return /TOKEN|KEY|SECRET|PASSWORD|PRIVATE|WEBHOOK|AUTH/i.test(key); }

/** Safe metadata for rendering user-owned credential forms; no values are returned. */
export function providerCatalog(): Record<string, unknown>[] {
  return Object.entries(PROVIDER_FIELDS).map(([provider, fields]) => ({ provider, fields: fields.map(key => ({ key, label: fieldLabel(key), secret: fieldIsSecret(key) })) }));
}

function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function allowedFields(provider: string): string[] { return PROVIDER_FIELDS[provider.toLowerCase()] || []; }
function sharedCredentialsEnabled(env: AppEnv): boolean { return ['1', 'true', 'yes', 'on'].includes(String((env as unknown as Record<string, unknown>).SHARED_PROVIDER_CREDENTIALS || '').toLowerCase()); }

export async function saveUserProvider(db: Db, master: string, userId: number, providerValue: string, values: Record<string, unknown>, metadata: Record<string, unknown> = {}): Promise<void> {
  const provider = providerValue.trim().toLowerCase();
  const fields = allowedFields(provider);
  if (!fields.length) throw new Error('unsupported-provider');
  const credentials: Record<string, string> = {};
  for (const key of fields) if (typeof values[key] === 'string' && values[key]) credentials[key] = String(values[key]).slice(0, 20000);
  if (!Object.keys(credentials).length) throw new Error('credential-required');
  const scopes = typeof values.grantedScopes === 'string' ? values.grantedScopes.slice(0, 2000) : '';
  const subject = typeof values.providerSubject === 'string' ? values.providerSubject.slice(0, 320) : null;
  const expires = Number(values.expiresAt || 0) || null;
  await db.run(`INSERT INTO user_provider_connections (user_id, provider, credentials_ciphertext, metadata_ciphertext, granted_scopes, provider_subject, expires_at, status, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'connected', unixepoch(), unixepoch())
    ON CONFLICT(user_id, provider) DO UPDATE SET credentials_ciphertext = excluded.credentials_ciphertext, metadata_ciphertext = excluded.metadata_ciphertext, granted_scopes = excluded.granted_scopes, provider_subject = excluded.provider_subject, expires_at = excluded.expires_at, status = 'connected', updated_at = unixepoch()`,
    userId, provider, await encryptAdminSecret(master, JSON.stringify(credentials)), Object.keys(metadata).length ? await encryptAdminSecret(master, JSON.stringify(metadata)) : null, scopes, subject, expires);
}

export async function deleteUserProvider(db: Db, userId: number, providerValue: string): Promise<void> { await db.run('DELETE FROM user_provider_connections WHERE user_id = ?1 AND provider = ?2', userId, providerValue.trim().toLowerCase()); }

export async function listUserProviders(db: Db, userId: number, master = ''): Promise<Record<string, unknown>[]> {
  const rows = await db.all('SELECT provider, granted_scopes, provider_subject, metadata_ciphertext, expires_at, status, created_at, updated_at FROM user_provider_connections WHERE user_id = ?1 ORDER BY provider', userId);
  return Promise.all(rows.map(async row => {
    let metadata: Record<string, unknown> = {};
    if (master && row.metadata_ciphertext) {
      try { metadata = asRecord(JSON.parse(await decryptAdminSecret(master, String(row.metadata_ciphertext)) || '{}')); } catch { metadata = {}; }
    }
    return {
      provider: String(row.provider), scopes: String(row.granted_scopes || ''), subject: row.provider_subject ? String(row.provider_subject) : null,
      accountEmail: typeof metadata.accountEmail === 'string' ? metadata.accountEmail : null,
      accountLogin: typeof metadata.accountLogin === 'string' ? metadata.accountLogin : null,
      accountName: typeof metadata.accountName === 'string' ? metadata.accountName : null,
      expiresAt: row.expires_at == null ? null : Number(row.expires_at), status: String(row.status || 'connected'), createdAt: Number(row.created_at || 0), updatedAt: Number(row.updated_at || 0)
    };
  }));
}

/** Build the tool environment for one user without exposing another user's or global credentials. */
export async function userToolEnv(env: AppEnv, db: Db, userId: number, fetchImpl: typeof fetch = fetch, parentSignal?: AbortSignal): Promise<AppEnv> {
  const next = { ...(env as unknown as Record<string, unknown>) };
  if (!sharedCredentialsEnabled(env)) for (const key of USER_SECRET_KEYS) delete next[key];
  if (!env.ADMIN_SESSION_SECRET) return next as AppEnv;
  const rows = await db.all('SELECT provider, credentials_ciphertext, granted_scopes, provider_subject, expires_at FROM user_provider_connections WHERE user_id = ?1 AND status = \'connected\'', userId);
  for (const row of rows) {
    const provider = String(row.provider);
    let credentials = asRecord(JSON.parse(await decryptAdminSecret(env.ADMIN_SESSION_SECRET, String(row.credentials_ciphertext)) || '{}'));
    const expiresAt = Number(row.expires_at || 0);
    if (expiresAt > 0 && expiresAt <= nowSeconds() + 60 && (typeof credentials.GOOGLE_REFRESH_TOKEN === 'string' || typeof credentials.GITHUB_REFRESH_TOKEN === 'string')) {
      try {
        const admin = await loadAdminSecrets(db, env);
        const clientId = provider === 'google' ? admin.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_ID : admin.GITHUB_CLIENT_ID || env.GITHUB_CLIENT_ID;
        const clientSecret = provider === 'google' ? admin.GOOGLE_CLIENT_SECRET || env.GOOGLE_CLIENT_SECRET : admin.GITHUB_CLIENT_SECRET || env.GITHUB_CLIENT_SECRET;
        const endpoint = provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://github.com/login/oauth/access_token';
        if (clientId && clientSecret) {
          const refreshToken = String(provider === 'google' ? credentials.GOOGLE_REFRESH_TOKEN : credentials.GITHUB_REFRESH_TOKEN);
          const refreshController = new AbortController();
          const refreshTimer = setTimeout(() => refreshController.abort(), 10_000);
          const signal = parentSignal || refreshController.signal;
          let response: Response;
          try {
            response = await fetchImpl(endpoint, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: String(clientId), client_secret: String(clientSecret), refresh_token: refreshToken, grant_type: 'refresh_token' }), signal });
          } finally { clearTimeout(refreshTimer); }
          const refreshed = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; scope?: string };
          if (response.ok && refreshed.access_token) {
            const accessKey = provider === 'google' ? 'GOOGLE_ACCESS_TOKEN' : 'GITHUB_ACCESS_TOKEN';
            const refreshKey = provider === 'google' ? 'GOOGLE_REFRESH_TOKEN' : 'GITHUB_REFRESH_TOKEN';
            credentials = { ...credentials, [accessKey]: refreshed.access_token, [refreshKey]: refreshed.refresh_token || credentials[refreshKey] };
            await saveUserProvider(db, env.ADMIN_SESSION_SECRET, userId, provider, { ...credentials, expiresAt: nowSeconds() + Math.max(60, Number(refreshed.expires_in || 3600)), grantedScopes: refreshed.scope || String(row.granted_scopes || '') }, { providerSubject: row.provider_subject || '' });
          }
        }
      } catch { /* Leave the connection visible; the provider call will fail safely if refresh is unavailable. */ }
    }
    for (const key of allowedFields(provider)) if (typeof credentials[key] === 'string') next[key] = credentials[key];
    if (provider === 'github' && typeof credentials.GITHUB_ACCESS_TOKEN === 'string') next.GITHUB_TOKEN = credentials.GITHUB_ACCESS_TOKEN;
    if (provider === 'google' && typeof credentials.GOOGLE_ACCESS_TOKEN === 'string') next.GMAIL_ACCESS_TOKEN = credentials.GOOGLE_ACCESS_TOKEN;
  }
  return next as AppEnv;
}

export { PROVIDER_FIELDS, USER_SECRET_KEYS };
