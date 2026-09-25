import type { ToolCall } from '../types.ts';

/** Parses the fallback format used by models that do not emit native tool calls. */
export function parseManifestCalls(content: string): { calls: ToolCall[]; cleanContent: string } {
  const calls: ToolCall[] = [];
  const pattern = /\[TOOL\(([-\w.]+)\)\]\s*(\{[\s\S]*?\})(?=\s*(?:\[TOOL\(|$))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    try { JSON.parse(match[2]); calls.push({ id: `manifest_${calls.length}`, type: 'function', function: { name: match[1], arguments: match[2] } }); } catch { /* leave malformed model output visible */ }
  }
  return { calls, cleanContent: content.replace(pattern, '').trim() };
}
