import type { Db } from '../data/db.ts';
import type { Kv } from '../data/kvCache.ts';
import { cacheGet, cacheSet } from '../data/kvCache.ts';
import type { AppEnv } from '../env.ts';

export interface ContextCaps {
  systemTokens: number;
  summaryTokens: number;
  recentHistoryTokens: number;
  emailTokens: number;
  attachmentTokens: number;
  toolOutputTokens: number;
  modelContextTokens: number;
  outputTokens: number;
}

export interface DestructiveFlags {
  /** Allow built-in tools to mutate external systems. Off by default. */
  externalWrite: boolean;
  invoicing: boolean;
  autopost: boolean;
  outboundSocial: boolean;
  externalSend: boolean;
}

export interface IntentConfig {
  keywords: string[];
  tone: string;
}

export type GuardrailStrictness = 'easy' | 'normal' | 'strict';

export interface AppConfig {
  systemInstructions: string;
  defaultLlm: string;
  llmModel: string;
  llmProvider: 'openrouter' | 'workers-ai' | 'openai-compatible';
  llmBaseUrl: string;
  llmApiKey: string;
  deliveryProvider: 'brevo' | 'cf-send-email';
  senderName: string;
  senderEmail: string;
  maxAgentSteps: number;
  maxToolResultBytes: number;
  parallelTools: number;
  subrequestBudget: number;
  contextCaps: ContextCaps;
  intents: Record<string, IntentConfig>;
  emailIntents: string[];
  rateLimitPerSenderPerHour: number;
  rateLimitGlobalPerDay: number;
  guardrailStrictness: GuardrailStrictness;
  destructiveFlags: DestructiveFlags;
  webhookUrl: string;
  digestSchedule: string;
  digestEnabled: boolean;
  ragEnabled: boolean;
  spamEmailDomains: string[];
  debugEnabled: boolean;
  fileCacheTtlDays: number;
  compactionEnabled: boolean;
  compactionTriggerTokens: number;
  compactionTargetTokens: number;
  compactionKeepRecentTokens: number;
  compactionOutputTokens: number;
  compactionLlmProvider: '' | 'openrouter' | 'workers-ai' | 'openai-compatible';
  compactionLlmModel: string;
  compactionLlmBaseUrl: string;
  historySearchEnabled: boolean;
  historySearchMaxCalls: number;
  historySearchMaxResults: number;
  historySearchResultTokens: number;
}

export const SETTING_KEYS = {
  systemInstructions: 'system_instructions',
  defaultLlm: 'default_llm',
  llmModel: 'llm_model',
  llmProvider: 'llm_provider',
  deliveryProvider: 'delivery_provider',
  maxAgentSteps: 'max_agent_steps',
  maxToolResultBytes: 'max_tool_result_bytes',
  parallelTools: 'parallel_tools',
  subrequestBudget: 'subrequest_budget',
  contextCaps: 'context_caps',
  intents: 'intents',
  emailIntents: 'email_intents',
  rateLimitPerSenderPerHour: 'rate_limit_per_sender_per_hour',
  rateLimitGlobalPerDay: 'rate_limit_global_per_day',
  guardrailStrictness: 'guardrail_strictness',
  destructiveFlags: 'destructive_flags',
  webhookUrl: 'webhook_url',
  digestSchedule: 'digest_schedule',
  digestEnabled: 'digest_enabled',
  ragEnabled: 'rag_enabled',
  spamEmailDomains: 'spam_email_domains',
  debugEnabled: 'debug_enabled',
  fileCacheTtlDays: 'file_cache_ttl_days',
  compactionEnabled: 'compaction_enabled',
  compactionTriggerTokens: 'compaction_trigger_tokens',
  compactionTargetTokens: 'compaction_target_tokens',
  compactionKeepRecentTokens: 'compaction_keep_recent_tokens',
  compactionOutputTokens: 'compaction_output_tokens',
  compactionLlmProvider: 'compaction_llm_provider',
  compactionLlmModel: 'compaction_llm_model',
  compactionLlmBaseUrl: 'compaction_llm_base_url',
  historySearchEnabled: 'history_search_enabled',
  historySearchMaxCalls: 'history_search_max_calls',
  historySearchMaxResults: 'history_search_max_results',
  historySearchResultTokens: 'history_search_result_tokens'
} as const;

export const DEFAULT_CONTEXT_CAPS: ContextCaps = {
  systemTokens: 1600,
  summaryTokens: 2000,
  recentHistoryTokens: 4000,
  emailTokens: 6000,
  attachmentTokens: 2000,
  toolOutputTokens: 1600,
  modelContextTokens: 12000,
  outputTokens: 2000
};

export const DEFAULT_DESTRUCTIVE_FLAGS: DestructiveFlags = {
  externalWrite: false,
  invoicing: false,
  autopost: false,
  outboundSocial: false,
  externalSend: false
};

export const DEFAULT_INTENTS: Record<string, IntentConfig> = {
  support: {
    keywords: ['help', 'broken', 'issue', 'bug', 'fails', 'not working', 'error', 'support'],
    tone: 'helpful and direct',
  },
  info: {
    keywords: ['what', 'who', 'where', 'when', 'how', 'please explain', 'tell me', 'summarize', 'status', 'update'],
    tone: 'informative',
  },
  action: {
    keywords: ['calculate', 'create', 'check', 'fetch', 'convert', 'send', 'prepare', 'build', 'generate', 'diff'],
    tone: 'actionable',
  },
  personal: {
    keywords: ['remember', 'my', 'i like', 'i prefer', 'forget', 'about me'],
    tone: 'warm and concise',
  }
};

export const DEFAULT_CONFIG: AppConfig = {
  systemInstructions:
    'You are a helpful, concise AI email assistant. You reply by email to people writing to your address. Do not claim to have taken external actions. Never invent facts; when unsure, say so clearly.',
  defaultLlm: 'openrouter/free',
  llmModel: '',
  llmProvider: 'openrouter',
  llmBaseUrl: '',
  llmApiKey: '',
  deliveryProvider: 'brevo',
  senderName: 'AI E-mail Chatbot',
  senderEmail: 'ai@yourdomain.com',
  maxAgentSteps: 8,
  maxToolResultBytes: 8192,
  parallelTools: 4,
  subrequestBudget: 40,
  contextCaps: DEFAULT_CONTEXT_CAPS,
  intents: DEFAULT_INTENTS,
  emailIntents: ['support', 'info', 'action', 'personal'],
  rateLimitPerSenderPerHour: 6,
  rateLimitGlobalPerDay: 500,
  guardrailStrictness: 'normal',
  destructiveFlags: DEFAULT_DESTRUCTIVE_FLAGS,
  webhookUrl: '',
  digestSchedule: '0 7 * * *',
  digestEnabled: false,
  ragEnabled: false,
  spamEmailDomains: [],
  debugEnabled: false,
  fileCacheTtlDays: 3,
  compactionEnabled: true,
  compactionTriggerTokens: 8000,
  compactionTargetTokens: 4000,
  compactionKeepRecentTokens: 3000,
  compactionOutputTokens: 1200,
  compactionLlmProvider: '',
  compactionLlmModel: '',
  compactionLlmBaseUrl: '',
  historySearchEnabled: true,
  historySearchMaxCalls: 2,
  historySearchMaxResults: 8,
  historySearchResultTokens: 1600
};

/** Env var name for each setting key (vars fallback; D1 settings win). */
const ENV_FALLBACK: Partial<Record<string, keyof AppEnv>> = {
  [SETTING_KEYS.systemInstructions]: 'SYSTEM_INSTRUCTIONS' as keyof AppEnv,
  [SETTING_KEYS.defaultLlm]: 'DEFAULT_LLM',
  [SETTING_KEYS.llmModel]: 'LLM_MODEL',
  [SETTING_KEYS.llmProvider]: 'LLM_PROVIDER',
  llmBaseUrl: 'LLM_BASE_URL',
  llmApiKey: 'LLM_API_KEY',
  [SETTING_KEYS.deliveryProvider]: 'DELIVERY_PROVIDER',
  [SETTING_KEYS.maxAgentSteps]: 'MAX_AGENT_STEPS',
  [SETTING_KEYS.maxToolResultBytes]: 'MAX_TOOL_RESULT_BYTES',
  [SETTING_KEYS.webhookUrl]: 'WEBHOOK_URL',
  [SETTING_KEYS.compactionTriggerTokens]: 'COMPACTION_TRIGGER_TOKENS',
  [SETTING_KEYS.compactionTargetTokens]: 'COMPACTION_TARGET_TOKENS',
  [SETTING_KEYS.compactionKeepRecentTokens]: 'COMPACTION_KEEP_RECENT_TOKENS',
  [SETTING_KEYS.compactionOutputTokens]: 'COMPACTION_OUTPUT_TOKENS',
  [SETTING_KEYS.compactionLlmProvider]: 'COMPACTION_LLM_PROVIDER',
  [SETTING_KEYS.compactionLlmModel]: 'COMPACTION_LLM_MODEL',
  [SETTING_KEYS.compactionLlmBaseUrl]: 'COMPACTION_LLM_BASE_URL',
  [SETTING_KEYS.historySearchEnabled]: 'HISTORY_SEARCH_ENABLED',
  [SETTING_KEYS.historySearchMaxCalls]: 'HISTORY_SEARCH_MAX_CALLS',
  [SETTING_KEYS.historySearchMaxResults]: 'HISTORY_SEARCH_MAX_RESULTS',
  [SETTING_KEYS.historySearchResultTokens]: 'HISTORY_SEARCH_RESULT_TOKENS'
};

export function parseBool(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', ''].includes(normalized)) return false;
  return fallback;
}

export function parseIntSetting(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function parseJsonSetting<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : (parsed as T);
  } catch {
    return fallback;
  }
}

function parseListSetting(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String).map(s => s.trim()).filter(Boolean);
  }
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

export const SETTINGS_CACHE_KEY = 'config:settings:v1';
const SETTINGS_CACHE_TTL = 60;

/** Reads the whole settings table, cached in KV for a short TTL (write-minimal). */
export async function loadRawSettings(db: Db, kv?: Kv): Promise<Record<string, string>> {
  const cached = await cacheGet<Record<string, string>>(kv, SETTINGS_CACHE_KEY);
  if (cached) {
    return cached;
  }
  const rows = await db.all('SELECT key, value FROM settings');
  const settings: Record<string, string> = {};
  for (const row of rows) {
    settings[String(row.key)] = String(row.value ?? '');
  }
  await cacheSet(kv, SETTINGS_CACHE_KEY, settings, SETTINGS_CACHE_TTL);
  return settings;
}

/** Resolves one setting with precedence: D1 > env var > default. */
function resolve(settings: Record<string, string>, env: AppEnv, key: string, fallback: string): string {
  if (settings[key] !== undefined && settings[key] !== '') {
    return settings[key];
  }
  const envKey = ENV_FALLBACK[key];
  const envValue = envKey ? env[envKey] : undefined;
  if (typeof envValue === 'string' && envValue !== '') {
    return envValue;
  }
  return fallback;
}

/** Builds the merged runtime config for one invocation. */
export async function loadConfig(env: AppEnv, db: Db, kv?: Kv): Promise<AppConfig> {
  const settings = await loadRawSettings(db, kv);

  // Provider connectivity is deployment configuration: an explicit Worker var
  // must be able to switch away from the seeded OpenRouter default.
  const llmProviderRaw = (env.LLM_PROVIDER || resolve(settings, env, SETTING_KEYS.llmProvider, DEFAULT_CONFIG.llmProvider)).toLowerCase();
  const deliveryRaw = resolve(settings, env, SETTING_KEYS.deliveryProvider, DEFAULT_CONFIG.deliveryProvider).toLowerCase();
  const strictnessRaw = settings[SETTING_KEYS.guardrailStrictness]?.toLowerCase();
  const guardrailStrictness: GuardrailStrictness =
    strictnessRaw === 'easy' || strictnessRaw === 'strict' ? strictnessRaw : 'normal';

  const rawContextCaps = parseJsonSetting<Record<string, unknown>>(settings[SETTING_KEYS.contextCaps], {});
  const contextValue = (key: keyof ContextCaps, legacyKey: string): number => parseIntSetting(
    rawContextCaps[key] ?? rawContextCaps[legacyKey],
    DEFAULT_CONTEXT_CAPS[key],
    key === 'modelContextTokens' ? 512 : 128,
    1_000_000
  );
  const contextCaps: ContextCaps = {
    systemTokens: contextValue('systemTokens', 'system'),
    summaryTokens: contextValue('summaryTokens', 'summary'),
    recentHistoryTokens: contextValue('recentHistoryTokens', 'turns'),
    emailTokens: contextValue('emailTokens', 'email'),
    attachmentTokens: contextValue('attachmentTokens', 'attachment'),
    toolOutputTokens: contextValue('toolOutputTokens', 'toolOutput'),
    modelContextTokens: contextValue('modelContextTokens', 'modelContext'),
    outputTokens: contextValue('outputTokens', 'outputReserve')
  };

  const compactionProviderRaw = resolve(settings, env, SETTING_KEYS.compactionLlmProvider, '').toLowerCase();
  const compactionLlmProvider: AppConfig['compactionLlmProvider'] =
    compactionProviderRaw === 'workers-ai'
      ? 'workers-ai'
      : compactionProviderRaw === 'openai-compatible' || compactionProviderRaw === 'openai'
        ? 'openai-compatible'
        : compactionProviderRaw === 'openrouter'
          ? 'openrouter'
          : '';
  const compactionTriggerTokens = parseIntSetting(resolve(settings, env, SETTING_KEYS.compactionTriggerTokens, String(DEFAULT_CONFIG.compactionTriggerTokens)), DEFAULT_CONFIG.compactionTriggerTokens, 512, 1_000_000);
  const compactionTargetTokens = Math.min(
    parseIntSetting(resolve(settings, env, SETTING_KEYS.compactionTargetTokens, String(DEFAULT_CONFIG.compactionTargetTokens)), DEFAULT_CONFIG.compactionTargetTokens, 256, 999_999),
    Math.max(256, compactionTriggerTokens - 128)
  );
  const compactionKeepRecentTokens = Math.min(
    parseIntSetting(resolve(settings, env, SETTING_KEYS.compactionKeepRecentTokens, String(DEFAULT_CONFIG.compactionKeepRecentTokens)), DEFAULT_CONFIG.compactionKeepRecentTokens, 128, 999_999),
    compactionTargetTokens
  );

  const rawDestructiveFlags = parseJsonSetting<Partial<DestructiveFlags> & { external_write?: boolean; outbound_social?: boolean; external_send?: boolean }>(settings[SETTING_KEYS.destructiveFlags], {});
  const destructiveFlags: DestructiveFlags = {
    ...DEFAULT_DESTRUCTIVE_FLAGS,
    ...rawDestructiveFlags,
    externalWrite: rawDestructiveFlags.externalWrite ?? rawDestructiveFlags.external_write ?? DEFAULT_DESTRUCTIVE_FLAGS.externalWrite,
    outboundSocial: rawDestructiveFlags.outboundSocial ?? rawDestructiveFlags.outbound_social ?? DEFAULT_DESTRUCTIVE_FLAGS.outboundSocial,
    externalSend: rawDestructiveFlags.externalSend ?? rawDestructiveFlags.external_send ?? DEFAULT_DESTRUCTIVE_FLAGS.externalSend
  };

  return {
    systemInstructions: resolve(settings, env, SETTING_KEYS.systemInstructions, DEFAULT_CONFIG.systemInstructions),
    defaultLlm: env.DEFAULT_LLM || resolve(settings, env, SETTING_KEYS.defaultLlm, DEFAULT_CONFIG.defaultLlm),
    llmModel: env.LLM_MODEL || resolve(settings, env, SETTING_KEYS.llmModel, DEFAULT_CONFIG.llmModel),
    llmProvider:
      llmProviderRaw === 'workers-ai'
        ? 'workers-ai'
        : llmProviderRaw === 'openai-compatible' || llmProviderRaw === 'openai' || llmProviderRaw === 'custom'
          ? 'openai-compatible'
          : 'openrouter',
    llmBaseUrl: env.LLM_BASE_URL || env.OPENAI_COMPATIBLE_BASE_URL || resolve(settings, env, 'llmBaseUrl', ''),
    llmApiKey: env.LLM_API_KEY || env.OPENAI_COMPATIBLE_API_KEY || env.OPENAI_API_KEY || resolve(settings, env, 'llmApiKey', ''),
    deliveryProvider: deliveryRaw === 'cf-send-email' ? 'cf-send-email' : 'brevo',
    senderName: env.SENDER_NAME || DEFAULT_CONFIG.senderName,
    senderEmail: env.SENDER_EMAIL || DEFAULT_CONFIG.senderEmail,
    maxAgentSteps: parseIntSetting(
      resolve(settings, env, SETTING_KEYS.maxAgentSteps, String(DEFAULT_CONFIG.maxAgentSteps)),
      DEFAULT_CONFIG.maxAgentSteps,
      1,
      50
    ),
    maxToolResultBytes: parseIntSetting(
      resolve(settings, env, SETTING_KEYS.maxToolResultBytes, String(DEFAULT_CONFIG.maxToolResultBytes)),
      DEFAULT_CONFIG.maxToolResultBytes,
      256,
      262144
    ),
    parallelTools: parseIntSetting(settings[SETTING_KEYS.parallelTools], DEFAULT_CONFIG.parallelTools, 1, 6),
    subrequestBudget: parseIntSetting(settings[SETTING_KEYS.subrequestBudget], DEFAULT_CONFIG.subrequestBudget, 1, 2000),
    contextCaps,
    intents: parseJsonSetting<Record<string, IntentConfig>>(settings[SETTING_KEYS.intents], DEFAULT_INTENTS),
    emailIntents: parseListSetting(settings[SETTING_KEYS.emailIntents]).length
      ? parseListSetting(settings[SETTING_KEYS.emailIntents])
      : DEFAULT_CONFIG.emailIntents,
    rateLimitPerSenderPerHour: parseIntSetting(
      settings[SETTING_KEYS.rateLimitPerSenderPerHour],
      DEFAULT_CONFIG.rateLimitPerSenderPerHour,
      1,
      1000
    ),
    rateLimitGlobalPerDay: parseIntSetting(
      settings[SETTING_KEYS.rateLimitGlobalPerDay],
      DEFAULT_CONFIG.rateLimitGlobalPerDay,
      1,
      100000
    ),
    guardrailStrictness,
    destructiveFlags,
    webhookUrl: resolve(settings, env, SETTING_KEYS.webhookUrl, ''),
    digestSchedule: settings[SETTING_KEYS.digestSchedule] || DEFAULT_CONFIG.digestSchedule,
    digestEnabled: parseBool(settings[SETTING_KEYS.digestEnabled], DEFAULT_CONFIG.digestEnabled),
    ragEnabled: parseBool(settings[SETTING_KEYS.ragEnabled], DEFAULT_CONFIG.ragEnabled),
    spamEmailDomains: parseListSetting(settings[SETTING_KEYS.spamEmailDomains]),
    debugEnabled: parseBool(settings[SETTING_KEYS.debugEnabled], DEFAULT_CONFIG.debugEnabled),
    fileCacheTtlDays: parseIntSetting(settings[SETTING_KEYS.fileCacheTtlDays], DEFAULT_CONFIG.fileCacheTtlDays, 1, 14),
    compactionEnabled: parseBool(resolve(settings, env, SETTING_KEYS.compactionEnabled, String(DEFAULT_CONFIG.compactionEnabled)), DEFAULT_CONFIG.compactionEnabled),
    compactionTriggerTokens,
    compactionTargetTokens,
    compactionKeepRecentTokens,
    compactionOutputTokens: parseIntSetting(resolve(settings, env, SETTING_KEYS.compactionOutputTokens, String(DEFAULT_CONFIG.compactionOutputTokens)), DEFAULT_CONFIG.compactionOutputTokens, 128, 64_000),
    compactionLlmProvider,
    compactionLlmModel: resolve(settings, env, SETTING_KEYS.compactionLlmModel, DEFAULT_CONFIG.compactionLlmModel),
    compactionLlmBaseUrl: resolve(settings, env, SETTING_KEYS.compactionLlmBaseUrl, DEFAULT_CONFIG.compactionLlmBaseUrl),
    historySearchEnabled: parseBool(resolve(settings, env, SETTING_KEYS.historySearchEnabled, String(DEFAULT_CONFIG.historySearchEnabled)), DEFAULT_CONFIG.historySearchEnabled),
    historySearchMaxCalls: parseIntSetting(resolve(settings, env, SETTING_KEYS.historySearchMaxCalls, String(DEFAULT_CONFIG.historySearchMaxCalls)), DEFAULT_CONFIG.historySearchMaxCalls, 0, 4),
    historySearchMaxResults: parseIntSetting(resolve(settings, env, SETTING_KEYS.historySearchMaxResults, String(DEFAULT_CONFIG.historySearchMaxResults)), DEFAULT_CONFIG.historySearchMaxResults, 1, 20),
    historySearchResultTokens: parseIntSetting(resolve(settings, env, SETTING_KEYS.historySearchResultTokens, String(DEFAULT_CONFIG.historySearchResultTokens)), DEFAULT_CONFIG.historySearchResultTokens, 128, 32_000)
  };
}
