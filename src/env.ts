import type { D1Database, DurableObjectNamespace, Fetcher, KVNamespace, R2Bucket, SendEmail } from '@cloudflare/workers-types';

/**
 * Shape of the Worker environment (bindings + vars + secrets).
 * Optional bindings are present only when the deployment declares them.
 */
export interface AppEnv {
  // ---- Persistence (always present) ----
  DB?: D1Database;
  CHAT_MEMORY?: KVNamespace;

  // ---- Optional platform bindings ----
  AI?: import('@cloudflare/workers-types').Ai | undefined;
  VECTORIZE?: import('@cloudflare/workers-types').VectorizeIndex | undefined;
  R2?: R2Bucket | undefined;
  QUEUE?: import('@cloudflare/workers-types').Queue<any> | undefined;
  WORKFLOWS?: import('@cloudflare/workers-types').Workflow<any> | undefined;
  EMAIL?: SendEmail | undefined;
  BROWSER?: Fetcher | undefined;
  USAGE_COUNTER?: DurableObjectNamespace | undefined;
  HYPERDRIVE?: import('@cloudflare/workers-types').Hyperdrive | undefined;

  // ---- Vars ----
  DEFAULT_LLM?: string;
  LLM_MODEL?: string;
  LLM_PROVIDER?: string;
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  OPENAI_COMPATIBLE_BASE_URL?: string;
  OPENAI_COMPATIBLE_MODEL?: string;
  DELIVERY_PROVIDER?: string;
  SENDER_NAME?: string;
  SENDER_EMAIL?: string;
  SUBJECT_TRIGGER?: string;
  SUBJECT_TRIGGER_MODE?: string;
  SHARED_PROVIDER_CREDENTIALS?: string;
  EMAIL_INTENTS?: string;
  MAX_AGENT_STEPS?: string;
  MAX_TOOL_RESULT_BYTES?: string;
  COMPACTION_TRIGGER_TOKENS?: string;
  COMPACTION_TARGET_TOKENS?: string;
  COMPACTION_KEEP_RECENT_TOKENS?: string;
  COMPACTION_OUTPUT_TOKENS?: string;
  COMPACTION_LLM_PROVIDER?: string;
  COMPACTION_LLM_MODEL?: string;
  COMPACTION_LLM_BASE_URL?: string;
  HISTORY_SEARCH_ENABLED?: string;
  HISTORY_SEARCH_MAX_CALLS?: string;
  HISTORY_SEARCH_MAX_RESULTS?: string;
  HISTORY_SEARCH_RESULT_TOKENS?: string;
  SYSTEM_INSTRUCTIONS?: string;
  WEBHOOK_URL?: string;
  TOOL_FANOUT_MODE?: string;
  TOOL_FANOUT_URL?: string;
  WORKER_PUBLIC_URL?: string;
  PUBLIC_URL?: string;
  WORKER_URL?: string;

  // ---- Secrets ----
  OPENROUTER_API_KEY?: string;
  BREVO_API_KEY?: string;
  API_TOKEN?: string;
  WEBHOOK_SECRET?: string;

  // ---- Provider secrets and OAuth credentials (optional) ----
  TAVILY_API_KEY?: string;
  SERPAPI_KEY?: string;
  BING_SEARCH_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_COMPATIBLE_API_KEY?: string;
  OPENAI_COMPATIBLE_EXTRA_HEADERS?: string;
  TOOL_FANOUT_SECRET?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_SESSION_SECRET?: string;
  TEMPORARY_ADMIN_MODE?: string;
  TEMPORARY_ADMIN_PASSWORD?: string;
  ANTHROPIC_API_KEY?: string;
  RESEND_API_KEY?: string;
  MAILGUN_API_KEY?: string;
  SENDGRID_API_KEY?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_FROM_NUMBER?: string;
  SLACK_WEBHOOK_URL?: string;
  DISCORD_WEBHOOK_URL?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  GITHUB_TOKEN?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_SCOPES?: string;
  GITHUB_ACCESS_TOKEN?: string;
  GITHUB_REFRESH_TOKEN?: string;
  GITHUB_TOKEN_EXPIRES_AT?: string;
  GITHUB_REFRESH_TOKEN_EXPIRES_AT?: string;
  GITHUB_GRANTED_SCOPES?: string;
  GITLAB_TOKEN?: string;
  LINEAR_API_KEY?: string;
  JIRA_BASE_URL?: string;
  JIRA_EMAIL?: string;
  JIRA_API_TOKEN?: string;
  ZENDESK_SUBDOMAIN?: string;
  ZENDESK_EMAIL?: string;
  ZENDESK_TOKEN?: string;
  HUBSPOT_ACCESS_TOKEN?: string;
  STRIPE_API_KEY?: string;
  SHOPIFY_DOMAIN?: string;
  SHOPIFY_API_VERSION?: string;
  SHOPIFY_ACCESS_TOKEN?: string;
  GOOGLE_CLIENT_EMAIL?: string;
  GOOGLE_PRIVATE_KEY?: string;
  GOOGLE_PROJECT_ID?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_SCOPES?: string;
  GOOGLE_GRANTED_SCOPES?: string;
  GOOGLE_ACCESS_TOKEN?: string;
  GOOGLE_REFRESH_TOKEN?: string;
  GOOGLE_TOKEN_EXPIRES_AT?: string;
  GMAIL_ACCESS_TOKEN?: string;
  OUTLOOK_TOKEN?: string;
  NOTION_API_KEY?: string;
  NOTION_VERSION?: string;
  AIRTABLE_API_KEY?: string;
  AIRTABLE_BASE_ID?: string;
  TWITTER_BEARER_TOKEN?: string;
  TWITTER_API_KEY?: string;
  TWITTER_API_SECRET?: string;
  TWITTER_ACCESS_TOKEN?: string;
  TWITTER_ACCESS_SECRET?: string;
  LINKEDIN_VERSION?: string;
  LINKEDIN_ACCESS_TOKEN?: string;
  NEWSAPI_KEY?: string;
  ALPHAVANTAGE_KEY?: string;
  POLYGON_API_KEY?: string;
  OPENWEATHER_KEY?: string;
  TOMORROWIO_KEY?: string;
  PDF_ENGINE?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  AI_GATEWAY_BASE_URL?: string;
  AI_GATEWAY_API_KEY?: string;
}

/** Type-only helper to treat an untyped env object as AppEnv. */
export function asEnv(env: Record<string, unknown>): AppEnv {
  return env as unknown as AppEnv;
}
