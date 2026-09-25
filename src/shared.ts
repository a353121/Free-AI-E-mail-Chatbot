import type { ToolContext } from './types.ts';

export const FALLBACK_REPLY = 'Sorry, I could not generate a reliable response right now. Please try again later.';

export const REPO_URL = 'https://github.com/a353121/free-ai-e-mail-chatbot';

/** Plain-text: normalize CRLF, strip stray HTML, unwrap markdown markers, collapse whitespace. */
export function normalizePlainText(content: string): string {
  if (typeof content !== 'string') {
    return '';
  }

  return content
    .replace(/\r\n/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/```[\s\S]*?```/g, block => block.replace(/```/g, '').trim())
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^[\-*>#]+\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Seconds since epoch (UTC). */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** Truncate a string to a byte budget while preserving UTF-8 characters. */
export function truncateBytes(text: string, maxBytes: number): string {
  if (maxBytes <= 0) {
    return '';
  }
  if (new TextEncoder().encode(text).length <= maxBytes) {
    return text;
  }
  let clipped = text.slice(0, Math.floor(maxBytes * 0.75));
  while (new TextEncoder().encode(clipped).length > maxBytes && clipped.length > 0) {
    clipped = clipped.slice(0, -1);
  }
  return clipped + '\n…[truncated]';
}

/** Safe JSON parse returning null on failure. */
export function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Split once on the first separator. */
export function splitOnce(text: string, separator: string): [string, string] {
  const index = text.indexOf(separator);
  if (index === -1) {
    return [text, ''];
  }
  return [text.slice(0, index), text.slice(index + separator.length)];
}

/** RFC-style comma list normalize: 'a, b , c' -> ['a','b','c']. */
export function normalizeList(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  return value
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}

/** Byte length via TextEncoder. */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Default no-op logger fallback for tools. */
export function createScopedLog(tag: string): ToolContext['log'] {
  return (level, message, extra) => {
    const snip =
      extra === undefined
        ? ''
        : ` ${typeof extra === 'string' ? extra : JSON.stringify(extra).slice(0, 300)}`;
    console[level](`[${tag}] ${message}${snip}`);
  };
}