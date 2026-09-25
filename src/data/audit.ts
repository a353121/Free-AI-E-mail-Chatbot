import type { Db } from './db.ts';
import { nowSeconds } from '../shared.ts';

export interface RunRecord {
  id: string;
  senderEmail?: string;
  conversationId?: number;
  kind: string;
  model?: string;
}

export function createRun(db: Db, record: RunRecord): Promise<void> {
  return db.run(
    'INSERT INTO runs (id, sender_email, conversation_id, kind, model, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
    record.id, record.senderEmail ?? null, record.conversationId ?? null, record.kind, record.model ?? null, 'running', nowSeconds()
  ).then(() => undefined);
}

export function finishRun(db: Db, id: string, result: { status: string; steps: number; subrequests: number; toolCalls: number; estimatedPromptTokens?: number; actualPromptTokens?: number; actualCompletionTokens?: number; historySearches?: number; contextItemsDropped?: number }): Promise<void> {
  return db.run(
    'UPDATE runs SET status = ?1, steps = ?2, subrequests = ?3, tool_calls = ?4, estimated_prompt_tokens = ?5, actual_prompt_tokens = ?6, actual_completion_tokens = ?7, history_searches = ?8, context_items_dropped = ?9, finished_at = ?10 WHERE id = ?11',
    result.status, result.steps, result.subrequests, result.toolCalls, result.estimatedPromptTokens ?? 0, result.actualPromptTokens ?? 0, result.actualCompletionTokens ?? 0, result.historySearches ?? 0, result.contextItemsDropped ?? 0, nowSeconds(), id
  ).then(() => undefined);
}

export function logTool(db: Db, runId: string, record: { tool: string; status: string; durationMs: number; error?: string }): Promise<void> {
  return db.run(
    'INSERT INTO tool_logs (run_id, tool, status, duration_ms, error, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)',
    runId, record.tool, record.status, Math.max(0, Math.round(record.durationMs)), record.error ?? null, nowSeconds()
  ).then(() => undefined);
}

export async function getRun(db: Db, id: string): Promise<Record<string, unknown> | null> {
  const run = await db.first('SELECT * FROM runs WHERE id = ?1', id);
  if (!run) return null;
  const tools = await db.all('SELECT * FROM tool_logs WHERE run_id = ?1 ORDER BY id', id);
  return { ...run, tool_logs: tools };
}
