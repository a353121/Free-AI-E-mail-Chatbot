import type { AppConfig } from '../config/loader.ts';
import type { AppEnv } from '../env.ts';
import { sleep } from '../shared.ts';
import type { ChatMessage, ToolCall, ToolDef } from '../types.ts';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_TIMEOUT_MS = 20_000;
export const OPENROUTER_MAX_ATTEMPTS = 3;
export const WORKERS_AI_DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_DEFAULT_MODEL = 'gpt-4o-mini';

export type LlmProvider = 'openrouter' | 'workers-ai' | 'openai-compatible';
export interface LlmConfig { provider: LlmProvider; model: string; apiKey?: string; baseUrl?: string; }
export interface LlmUsage { promptTokens?: number; completionTokens?: number; }
export interface LlmResponse { ok: boolean; content?: string; toolCalls?: ToolCall[]; finishReason?: string; usage?: LlmUsage; reason?: string; }
export interface LlmCallOptions {
  tools?: ToolDef[]; toolChoice?: 'auto' | 'none' | 'required'; reasoning?: boolean;
  temperature?: number; maxTokens?: number; fetchImpl?: typeof fetch; timeoutMs?: number;
  llmOverride?: Partial<LlmConfig>;
}
export interface LlmProviderAdapter { (env: AppEnv, config: LlmConfig, messages: ChatMessage[], opts: LlmCallOptions): Promise<LlmResponse>; }

export function resolveLlmConfig(env: AppEnv, config: AppConfig): LlmConfig {
  if (config.llmProvider === 'workers-ai') return { provider: 'workers-ai', model: config.llmModel || WORKERS_AI_DEFAULT_MODEL };
  if (config.llmProvider === 'openai-compatible') return {
    provider: 'openai-compatible', model: config.llmModel || env.OPENAI_COMPATIBLE_MODEL || OPENAI_DEFAULT_MODEL,
    apiKey: config.llmApiKey || env.OPENAI_COMPATIBLE_API_KEY || env.OPENAI_API_KEY,
    baseUrl: config.llmBaseUrl || env.OPENAI_COMPATIBLE_BASE_URL || OPENAI_DEFAULT_BASE_URL
  };
  return { provider: 'openrouter', model: config.llmModel || config.defaultLlm, apiKey: config.llmApiKey || env.OPENROUTER_API_KEY, baseUrl: OPENROUTER_URL };
}

export function modelSupportsNativeTools(model: string): boolean {
  const normalized = model.toLowerCase().trim();
  return Boolean(normalized) && normalized !== 'openrouter/free' && !normalized.includes(':free') && !normalized.endsWith('/free');
}

function parseUsage(payload: Record<string, unknown>): LlmUsage {
  const usage = payload.usage as Record<string, unknown> | undefined;
  return { promptTokens: typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : undefined, completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : undefined };
}

function textFromContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value.map(part => typeof part === 'string' ? part : part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '').join('');
}

function parseToolCalls(payload: Record<string, unknown>): ToolCall[] | undefined {
  const message = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined;
  if (!Array.isArray(message?.tool_calls)) return undefined;
  const calls = message.tool_calls.map((call, index): ToolCall | null => {
    if (!call || typeof call !== 'object') return null;
    const record = call as Record<string, unknown>;
    const fn = record.function as Record<string, unknown> | undefined;
    if (!fn || typeof fn.name !== 'string') return null;
    return { id: typeof record.id === 'string' ? record.id : `call_${index}`, type: 'function', function: { name: fn.name, arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}) } };
  }).filter((call): call is ToolCall => call !== null);
  return calls.length ? calls : undefined;
}

export function normalizeChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('LLM_BASE_URL is empty');
  const url = new URL(trimmed);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('LLM_BASE_URL must use http or https');
  return /\/chat\/completions$/i.test(trimmed) ? trimmed : `${trimmed}/chat/completions`;
}

function extraHeaders(env: AppEnv): Record<string, string> {
  const raw = env.OPENAI_COMPATIBLE_EXTRA_HEADERS?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => typeof value === 'string')) as Record<string, string>;
  } catch { return {}; }
}

/** Calls any OpenAI Chat Completions compatible endpoint. */
export async function callOpenAiCompatible(env: AppEnv, config: LlmConfig, messages: ChatMessage[], opts: LlmCallOptions = {}): Promise<LlmResponse> {
  const { tools, toolChoice = 'auto', reasoning = false, temperature, maxTokens, timeoutMs = OPENROUTER_TIMEOUT_MS, fetchImpl = fetch } = opts;
  if (!config.apiKey) return { ok: false, reason: 'missing LLM API key' };
  let url: string;
  try { url = normalizeChatCompletionsUrl(config.baseUrl || OPENAI_DEFAULT_BASE_URL); } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : 'invalid LLM base URL' }; }
  const body: Record<string, unknown> = { model: config.model, messages, ...(tools?.length ? { tools: tools.map(toolSchema), tool_choice: toolChoice } : {}) };
  if (reasoning) body.reasoning = { enabled: true };
  if (temperature !== undefined) body.temperature = temperature;
  if (maxTokens !== undefined) body.max_tokens = maxTokens;

  for (let attempt = 1; attempt <= OPENROUTER_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', ...extraHeaders(env) };
      if (config.provider === 'openrouter') headers['X-Title'] = 'AI Email Chatbot';
      const response = await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      if (!response.ok) {
        const errorText = await response.text();
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        console.error(`[LLM] ${config.provider} HTTP ${response.status} attempt=${attempt}: ${errorText.slice(0, 200)}`);
        if (retryable && attempt < OPENROUTER_MAX_ATTEMPTS) { await sleep(500 * attempt); continue; }
        return { ok: false, reason: retryable ? 'temporary-upstream-failure' : `http-${response.status}` };
      }
      const payload = await response.json() as Record<string, unknown>;
      const choice = (payload.choices as Array<Record<string, unknown>> | undefined)?.[0];
      const message = choice?.message as Record<string, unknown> | undefined;
      return { ok: true, content: textFromContent(message?.content), toolCalls: parseToolCalls(payload), finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined, usage: parseUsage(payload) };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'AbortError';
      if (timedOut && attempt < OPENROUTER_MAX_ATTEMPTS) { await sleep(500 * attempt); continue; }
      console.error(`[LLM] ${config.provider} request failed:`, error);
      return { ok: false, reason: timedOut ? 'timeout' : 'request-failed' };
    } finally { clearTimeout(timeoutId); }
  }
  return { ok: false, reason: 'retries-exhausted' };
}

export async function callOpenRouter(env: AppEnv, config: LlmConfig, messages: ChatMessage[], opts: LlmCallOptions): Promise<LlmResponse> {
  return callOpenAiCompatible(env, { ...config, provider: 'openrouter', baseUrl: OPENROUTER_URL, apiKey: config.apiKey || env.OPENROUTER_API_KEY }, messages, opts);
}

export async function callWorkersAi(env: AppEnv, config: LlmConfig, messages: ChatMessage[], opts: LlmCallOptions): Promise<LlmResponse> {
  if (!env.AI) return { ok: false, reason: 'missing AI binding' };
  const { tools, toolChoice = 'auto', reasoning = false, maxTokens } = opts;
  try {
    const raw = await env.AI.run(config.model as never, { messages, ...(tools?.length ? { tools: tools.map(toolSchema), tool_choice: toolChoice } : {}), ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}), ...(reasoning ? { raw: true } : {}) } as never);
    const result = raw as unknown as { response?: string; tool_calls?: Array<{ id?: string; name?: string; arguments?: unknown }> };
    const toolCalls = result.tool_calls?.filter(call => typeof call?.name === 'string').map((call, index) => ({ id: call.id || `call_${index}`, type: 'function' as const, function: { name: call.name as string, arguments: typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments || {}) } }));
    return { ok: true, content: result.response || '', toolCalls: toolCalls?.length ? toolCalls : undefined };
  } catch (error) { console.error('[LLM] Workers AI failure:', error); return { ok: false, reason: 'workers-ai-failed' }; }
}

export function toolSchema(tool: ToolDef): Record<string, unknown> { return { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }; }
export const llmAdapters: Record<LlmProvider, LlmProviderAdapter> = { openrouter: callOpenRouter, 'workers-ai': callWorkersAi, 'openai-compatible': callOpenAiCompatible };
export async function chatCompletion(env: AppEnv, config: AppConfig, messages: ChatMessage[], opts: LlmCallOptions = {}): Promise<LlmResponse> {
  const llmConfig = { ...resolveLlmConfig(env, config), ...(opts.llmOverride || {}) };
  return llmAdapters[llmConfig.provider](env, llmConfig, messages, opts);
}
