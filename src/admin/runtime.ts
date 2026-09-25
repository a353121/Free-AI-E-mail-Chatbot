import type { Db } from '../data/db.ts';
import type { AppEnv } from '../env.ts';
import { nowSeconds } from '../shared.ts';

export const ADMIN_RUNTIME_KEYS = [
  'DEFAULT_LLM', 'LLM_MODEL', 'LLM_PROVIDER', 'LLM_BASE_URL', 'OPENAI_COMPATIBLE_BASE_URL', 'OPENAI_COMPATIBLE_MODEL',
  'DELIVERY_PROVIDER', 'SENDER_NAME', 'SENDER_EMAIL', 'SUBJECT_TRIGGER', 'SUBJECT_TRIGGER_MODE', 'SHOPIFY_API_VERSION', 'NOTION_VERSION', 'LINKEDIN_VERSION', 'SHARED_PROVIDER_CREDENTIALS', 'EMAIL_INTENTS', 'MAX_AGENT_STEPS', 'MAX_TOOL_RESULT_BYTES',
  'SYSTEM_INSTRUCTIONS', 'WEBHOOK_URL', 'TOOL_FANOUT_MODE', 'TOOL_FANOUT_URL', 'WORKER_PUBLIC_URL', 'PUBLIC_URL', 'WORKER_URL', 'AI_GATEWAY_BASE_URL'
] as const;

export const ADMIN_SETTING_KEYS = [
  'parallel_tools', 'subrequest_budget', 'context_caps', 'guardrail_strictness', 'rate_limit_per_sender_per_hour',
  'rate_limit_global_per_day', 'destructive_flags', 'digest_schedule', 'digest_enabled', 'rag_enabled', 'spam_email_domains',
  'debug_enabled', 'intents', 'file_cache_ttl_days', 'compaction_enabled', 'compaction_trigger_tokens',
  'compaction_target_tokens', 'compaction_keep_recent_tokens', 'compaction_output_tokens', 'compaction_llm_provider',
  'compaction_llm_model', 'compaction_llm_base_url', 'history_search_enabled', 'history_search_max_calls',
  'history_search_max_results', 'history_search_result_tokens'
] as const;

export const ADMIN_SECRET_KEYS = [
  'OPENROUTER_API_KEY', 'OPENAI_COMPATIBLE_API_KEY', 'OPENAI_API_KEY', 'OPENAI_COMPATIBLE_EXTRA_HEADERS', 'BREVO_API_KEY',
  'TOOL_FANOUT_SECRET', 'API_TOKEN', 'WEBHOOK_SECRET', 'TAVILY_API_KEY', 'SERPAPI_KEY', 'BING_SEARCH_KEY', 'ANTHROPIC_API_KEY',
  'RESEND_API_KEY', 'MAILGUN_API_KEY', 'SENDGRID_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER',
  'SLACK_WEBHOOK_URL', 'DISCORD_WEBHOOK_URL', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GITHUB_TOKEN', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_SCOPES', 'GITHUB_ACCESS_TOKEN', 'GITHUB_REFRESH_TOKEN', 'GITHUB_TOKEN_EXPIRES_AT', 'GITHUB_REFRESH_TOKEN_EXPIRES_AT', 'GITHUB_GRANTED_SCOPES', 'GITLAB_TOKEN',
  'LINEAR_API_KEY', 'JIRA_BASE_URL', 'JIRA_EMAIL', 'JIRA_API_TOKEN', 'ZENDESK_SUBDOMAIN', 'ZENDESK_EMAIL', 'ZENDESK_TOKEN',
  'HUBSPOT_ACCESS_TOKEN', 'STRIPE_API_KEY', 'SHOPIFY_DOMAIN', 'SHOPIFY_ACCESS_TOKEN', 'GOOGLE_CLIENT_EMAIL', 'GOOGLE_PRIVATE_KEY',
  'GOOGLE_PROJECT_ID', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_SCOPES', 'GOOGLE_GRANTED_SCOPES', 'GOOGLE_ACCESS_TOKEN', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_TOKEN_EXPIRES_AT', 'GMAIL_ACCESS_TOKEN', 'OUTLOOK_TOKEN', 'NOTION_API_KEY', 'AIRTABLE_API_KEY', 'AIRTABLE_BASE_ID',
  'TWITTER_BEARER_TOKEN', 'TWITTER_API_KEY', 'TWITTER_API_SECRET', 'TWITTER_ACCESS_TOKEN', 'TWITTER_ACCESS_SECRET',
  'LINKEDIN_ACCESS_TOKEN', 'NEWSAPI_KEY', 'ALPHAVANTAGE_KEY', 'POLYGON_API_KEY', 'OPENWEATHER_KEY', 'TOMORROWIO_KEY', 'PDF_ENGINE',
  'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'AI_GATEWAY_BASE_URL', 'AI_GATEWAY_API_KEY'
] as const;

function bytesToBase64(bytes: Uint8Array): string { let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw); }
function base64ToBytes(value: string): Uint8Array { const raw = atob(value); return Uint8Array.from(raw, char => char.charCodeAt(0)); }
function asRecord(env: AppEnv): Record<string, unknown> { return env as unknown as Record<string, unknown>; }
const ENCRYPTION_VERSION = 'v2';
const WORKER_PBKDF2_ITERATIONS = 100_000;

async function encryptionKey(secret: string, salt: Uint8Array, iterations = WORKER_PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptAdminSecret(master: string, plaintext: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(master, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, new TextEncoder().encode(plaintext));
  return `${ENCRYPTION_VERSION}.${bytesToBase64(salt)}.${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

export async function decryptAdminSecret(master: string, ciphertext: string): Promise<string | null> {
  try {
    const parts = ciphertext.split('.');
    const versioned = parts.length === 4 && parts[0] === ENCRYPTION_VERSION;
    const [saltRaw, ivRaw, encryptedRaw] = versioned ? parts.slice(1) : parts;
    if (!saltRaw || !ivRaw || !encryptedRaw) return null;
    let key = await encryptionKey(master, base64ToBytes(saltRaw));
    // Legacy ciphertext used the unsupported 120,000-iteration derivation.
    // Keep a best-effort migration read for runtimes that still accept it;
    // every newly written value uses the Worker-compatible v2 format above.
    let plaintext: ArrayBuffer;
    try {
      plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivRaw) as unknown as BufferSource }, key, base64ToBytes(encryptedRaw) as unknown as BufferSource);
    } catch (error) {
      if (versioned) throw error;
      key = await encryptionKey(master, base64ToBytes(saltRaw), 120_000);
      plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64ToBytes(ivRaw) as unknown as BufferSource }, key, base64ToBytes(encryptedRaw) as unknown as BufferSource);
    }
    return new TextDecoder().decode(plaintext);
  } catch { return null; }
}

export async function loadAdminSecrets(db: Db | undefined, env: AppEnv): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!db || !env.ADMIN_SESSION_SECRET) return result;
  try {
    const rows = await db.all('SELECT name, ciphertext FROM admin_secrets');
    for (const row of rows) {
      const name = String(row.name);
      if (!(ADMIN_SECRET_KEYS as readonly string[]).includes(name)) continue;
      const value = await decryptAdminSecret(env.ADMIN_SESSION_SECRET, String(row.ciphertext));
      if (value !== null) result[name] = value;
    }
  } catch { /* migration is optional during first boot */ }
  return result;
}

export async function applyRuntimeOverrides(env: AppEnv, db: Db | undefined): Promise<AppEnv> {
  if (!db) return env;
  const next = { ...asRecord(env) };
  try {
    const rows = await db.all('SELECT key, value FROM settings');
    for (const row of rows) {
      const key = String(row.key);
      if ((ADMIN_RUNTIME_KEYS as readonly string[]).includes(key)) next[key] = String(row.value ?? '');
    }
  } catch { /* continue with deployment environment */ }
  const secrets = await loadAdminSecrets(db, env);
  if (secrets.GOOGLE_REFRESH_TOKEN && secrets.GOOGLE_CLIENT_ID && secrets.GOOGLE_CLIENT_SECRET && Number(secrets.GOOGLE_TOKEN_EXPIRES_AT || 0) <= Math.floor(Date.now() / 1000) + 60) {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: secrets.GOOGLE_CLIENT_ID, client_secret: secrets.GOOGLE_CLIENT_SECRET, refresh_token: secrets.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
      const token = await response.json() as { access_token?: string; expires_in?: number };
      if (response.ok && token.access_token) {
        secrets.GOOGLE_ACCESS_TOKEN = token.access_token;
        secrets.GOOGLE_TOKEN_EXPIRES_AT = String(Math.floor(Date.now() / 1000) + Math.max(60, Number(token.expires_in || 3600)));
        await saveAdminSecrets(db, env.ADMIN_SESSION_SECRET || '', { GOOGLE_ACCESS_TOKEN: secrets.GOOGLE_ACCESS_TOKEN, GOOGLE_TOKEN_EXPIRES_AT: secrets.GOOGLE_TOKEN_EXPIRES_AT });
      }
    } catch { /* keep the previous token; the provider will report if it is unusable */ }
  }
  if (secrets.GITHUB_REFRESH_TOKEN && secrets.GITHUB_CLIENT_ID && secrets.GITHUB_CLIENT_SECRET && Number(secrets.GITHUB_TOKEN_EXPIRES_AT || 0) <= Math.floor(Date.now() / 1000) + 60) {
    try {
      const response = await fetch('https://github.com/login/oauth/access_token', { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: secrets.GITHUB_CLIENT_ID, client_secret: secrets.GITHUB_CLIENT_SECRET, refresh_token: secrets.GITHUB_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
      const token = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; refresh_token_expires_in?: number; scope?: string };
      if (response.ok && token.access_token) {
        secrets.GITHUB_ACCESS_TOKEN = token.access_token;
        secrets.GITHUB_TOKEN_EXPIRES_AT = String(Math.floor(Date.now() / 1000) + Math.max(60, Number(token.expires_in || 3600)));
        if (token.refresh_token) secrets.GITHUB_REFRESH_TOKEN = token.refresh_token;
        if (token.refresh_token_expires_in) secrets.GITHUB_REFRESH_TOKEN_EXPIRES_AT = String(Math.floor(Date.now() / 1000) + Math.max(60, Number(token.refresh_token_expires_in)));
        if (token.scope) secrets.GITHUB_GRANTED_SCOPES = token.scope;
        await saveAdminSecrets(db, env.ADMIN_SESSION_SECRET || '', { GITHUB_ACCESS_TOKEN: secrets.GITHUB_ACCESS_TOKEN, GITHUB_REFRESH_TOKEN: secrets.GITHUB_REFRESH_TOKEN, GITHUB_TOKEN_EXPIRES_AT: secrets.GITHUB_TOKEN_EXPIRES_AT, GITHUB_REFRESH_TOKEN_EXPIRES_AT: secrets.GITHUB_REFRESH_TOKEN_EXPIRES_AT, GITHUB_GRANTED_SCOPES: secrets.GITHUB_GRANTED_SCOPES });
      }
    } catch { /* keep the previous token; the provider will report if it is unusable */ }
  }
  Object.assign(next, secrets);
  if (next.GOOGLE_ACCESS_TOKEN) next.GMAIL_ACCESS_TOKEN = next.GOOGLE_ACCESS_TOKEN;
  if (next.GITHUB_ACCESS_TOKEN) next.GITHUB_TOKEN = next.GITHUB_ACCESS_TOKEN;
  return next as AppEnv;
}

export async function saveRuntimeSettings(db: Db, values: Record<string, unknown>): Promise<string[]> {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!(ADMIN_RUNTIME_KEYS as readonly string[]).includes(key) && !(ADMIN_SETTING_KEYS as readonly string[]).includes(key)) continue;
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) continue;
    await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, value === null ? '' : String(value), nowSeconds());
    changed.push(key);
  }
  return changed;
}

export async function saveAdminSecrets(db: Db, master: string, values: Record<string, unknown>): Promise<string[]> {
  const changed: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    if (!(ADMIN_SECRET_KEYS as readonly string[]).includes(key) || typeof value !== 'string' || !value) continue;
    await db.run('INSERT INTO admin_secrets (name, ciphertext, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(name) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at', key, await encryptAdminSecret(master, value), nowSeconds());
    changed.push(key);
  }
  return changed;
}

export async function configuredSecretNames(db: Db | undefined, env: AppEnv): Promise<string[]> {
  const names = new Set<string>();
  for (const key of ADMIN_SECRET_KEYS) if (asRecord(env)[key]) names.add(key);
  if (db) {
    try { for (const row of await db.all('SELECT name FROM admin_secrets')) names.add(String(row.name)); } catch { /* optional migration */ }
  }
  return [...names].sort();
}
