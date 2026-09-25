import type { ToolOutput } from '../types.ts';
import { truncateBytes } from '../shared.ts';

function toBase64(bytes: ArrayBuffer): string { let binary = ''; for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte); return btoa(binary); }
async function signature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
}

export async function dispatchToolOverHttp(url: string, secret: string, tool: string, args: Record<string, unknown>, sender: string | undefined, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000, userId?: number, threadKey?: string): Promise<ToolOutput> {
  const body = JSON.stringify({ tool, args, sender, userId, threadKey, timestamp: Date.now(), requestId: crypto.randomUUID() });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tool-signature': await signature(secret, body) }, body, signal: controller.signal });
    const payload = await response.json() as ToolOutput;
    if (!response.ok) return { ok: false, content: typeof payload?.content === 'string' ? payload.content : `Tool fan-out HTTP ${response.status}`, error: payload?.error || 'fanout-failed' };
    return { ok: Boolean(payload.ok), content: truncateBytes(String(payload.content || ''), 8192), error: payload.error, data: payload.data };
  } catch (error) { return { ok: false, content: `Tool fan-out failed: ${error instanceof Error ? error.message : 'unknown error'}`, error: 'fanout-failed' }; }
  finally { clearTimeout(timer); }
}

export async function verifyToolSignature(secret: string, body: string, received: string, maxAgeMs = 300_000): Promise<boolean> {
  try {
    const parsed = JSON.parse(body) as { timestamp?: unknown; requestId?: unknown };
    if (typeof parsed.timestamp !== 'number' || Math.abs(Date.now() - parsed.timestamp) > maxAgeMs) return false;
    if (typeof parsed.requestId !== 'string' || !/^[a-f0-9-]{20,80}$/i.test(parsed.requestId)) return false;
  } catch { return false; }
  const expected = await signature(secret, body);
  if (expected.length !== received.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected.charCodeAt(index) ^ received.charCodeAt(index);
  return difference === 0;
}

/** Resolves a child Worker URL. `auto` uses a deployment-provided public URL. */
export function resolveFanoutUrl(env: { TOOL_FANOUT_URL?: string; WORKER_PUBLIC_URL?: string; PUBLIC_URL?: string; WORKER_URL?: string }): string | undefined {
  const configured = [env.TOOL_FANOUT_URL, env.WORKER_PUBLIC_URL, env.PUBLIC_URL, env.WORKER_URL].map(value => value?.trim()).find(value => value && value.toLowerCase() !== 'auto');
  return configured;
}
