import type { Db } from './db.ts';
import { nowSeconds, clamp } from '../shared.ts';

/** Documented free-tier daily limits (see plan §1). */
export const FREE_DAILY_LIMITS = {
  d1Reads: 5_000_000,
  d1Writes: 100_000,
  kvReads: 100_000,
  kvWrites: 1_000,
  llmCalls: 2_000
} as const;

export type UsageField = 'd1_reads' | 'd1_writes' | 'kv_reads' | 'kv_writes' | 'llm_calls';

export interface UsageRow {
  day: string;
  d1_reads: number;
  d1_writes: number;
  kv_reads: number;
  kv_writes: number;
  llm_calls: number;
  degraded: number;
}

export interface UsageDelta {
  d1Reads?: number;
  d1Writes?: number;
  kvReads?: number;
  kvWrites?: number;
  llmCalls?: number;
}

export interface GuardStatus {
  day: string;
  degraded: boolean;
  ratios: Record<UsageField, number>;
  maxRatio: number;
}

/** 'YYYY-MM-DD' in UTC. */
export function dayKey(unixSeconds: number = nowSeconds()): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function toUsageRow(row: Record<string, unknown>, day: string): UsageRow {
  return {
    day: String(row.day ?? day),
    d1_reads: Number(row.d1_reads ?? 0),
    d1_writes: Number(row.d1_writes ?? 0),
    kv_reads: Number(row.kv_reads ?? 0),
    kv_writes: Number(row.kv_writes ?? 0),
    llm_calls: Number(row.llm_calls ?? 0),
    degraded: Number(row.degraded ?? 0)
  };
}

export async function loadUsage(db: Db, day: string = dayKey()): Promise<UsageRow> {
  const row = await db.first('SELECT * FROM usage_guard WHERE day = ?1', day);
  return row ? toUsageRow(row, day) : { day, d1_reads: 0, d1_writes: 0, kv_reads: 0, kv_writes: 0, llm_calls: 0, degraded: 0 };
}

/** Upsert-accumulates a batch of usage deltas in a single write. */
export async function flushUsage(db: Db, delta: UsageDelta, day: string = dayKey()): Promise<UsageRow> {
  await db.run(
    `INSERT INTO usage_guard (day, d1_writes, d1_reads, kv_writes, kv_reads, llm_calls, degraded)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)
     ON CONFLICT(day) DO UPDATE SET
       d1_writes = d1_writes + excluded.d1_writes,
       d1_reads  = d1_reads  + excluded.d1_reads,
       kv_writes = kv_writes + excluded.kv_writes,
       kv_reads  = kv_reads  + excluded.kv_reads,
       llm_calls = llm_calls + excluded.llm_calls`,
    day,
    Math.max(0, Math.floor(delta.d1Writes ?? 0)),
    Math.max(0, Math.floor(delta.d1Reads ?? 0)),
    Math.max(0, Math.floor(delta.kvWrites ?? 0)),
    Math.max(0, Math.floor(delta.kvReads ?? 0)),
    Math.max(0, Math.floor(delta.llmCalls ?? 0))
  );
  return loadUsage(db, day);
}

export interface GuardThresholds {
  softRatio?: number;
  hardRatio?: number;
  limits?: typeof FREE_DAILY_LIMITS;
}

/**
 * Computes whether the worker should auto-degrade for the rest of the day.
 * softRatio (default 0.8) triggers degraded mode; hardRatio (default 0.95)
 * means new heavy work should be refused with a graceful message.
 */
export function evaluateGuard(usage: UsageRow, thresholds: GuardThresholds = {}): GuardStatus & { hard: boolean } {
  const limits = thresholds.limits ?? FREE_DAILY_LIMITS;
  const softRatio = thresholds.softRatio ?? 0.8;
  const hardRatio = thresholds.hardRatio ?? 0.95;

  const ratios = {
    d1_reads: usage.d1_reads / limits.d1Reads,
    d1_writes: usage.d1_writes / limits.d1Writes,
    kv_reads: usage.kv_reads / limits.kvReads,
    kv_writes: usage.kv_writes / limits.kvWrites,
    llm_calls: usage.llm_calls / limits.llmCalls
  } as Record<UsageField, number>;

  const maxRatio = clamp(Math.max(...Object.values(ratios)), 0, 1);
  const degraded = usage.degraded === 1 || maxRatio >= softRatio;

  return {
    day: usage.day,
    degraded,
    ratios,
    maxRatio,
    hard: maxRatio >= hardRatio
  };
}

export async function guardStatus(db: Db, thresholds: GuardThresholds = {}, day: string = dayKey()): Promise<GuardStatus & { hard: boolean; usage: UsageRow }> {
  const usage = await loadUsage(db, day);
  const status = evaluateGuard(usage, thresholds);
  return { ...status, usage };
}

/** Persists the degraded flag for the day (idempotent, one write). */
export async function markDegraded(db: Db, day: string = dayKey()): Promise<void> {
  await db.run('UPDATE usage_guard SET degraded = 1 WHERE day = ?1 AND degraded = 0', day);
}

/** Clears the degraded flag (used by the nightly scheduled job). */
export async function clearDegraded(db: Db, day: string = dayKey()): Promise<void> {
  await db.run('UPDATE usage_guard SET degraded = 0 WHERE day = ?1', day);
}