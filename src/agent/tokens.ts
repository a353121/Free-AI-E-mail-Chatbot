import type { ChatMessage } from '../types.ts';
import { byteLength, truncateBytes } from '../shared.ts';

/** Deliberately conservative, provider-independent preflight estimate. */
export const ESTIMATED_BYTES_PER_TOKEN = 3;
export const MESSAGE_OVERHEAD_TOKENS = 12;

export interface TokenEstimate {
  tokens: number;
  method: 'conservative-utf8-bytes-3';
}

export function estimateTokens(value: string): number {
  const bytes = byteLength(value || '');
  return Math.max(1, Math.ceil(bytes / ESTIMATED_BYTES_PER_TOKEN));
}

export function estimateMessageTokens(message: ChatMessage): number {
  const serialized = JSON.stringify({
    role: message.role,
    content: message.content || '',
    name: message.name || '',
    tool_calls: message.tool_calls || [],
    tool_call_id: message.tool_call_id || ''
  });
  return MESSAGE_OVERHEAD_TOKENS + estimateTokens(serialized);
}

export function estimateChatTokens(messages: ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function estimateText(value: string): TokenEstimate {
  return { tokens: estimateTokens(value), method: 'conservative-utf8-bytes-3' };
}

export function truncateToTokens(value: string, maxTokens: number): string {
  return truncateBytes(value, Math.max(0, Math.floor(maxTokens * ESTIMATED_BYTES_PER_TOKEN)));
}
