import type { KVNamespace } from '@cloudflare/workers-types';
import { byteLength } from '../shared.ts';

const MAX_CACHE_VALUE_BYTES = 65_536;
const DEFAULT_TTL_SECONDS = 300;

export interface Kv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export function toKv(binding: KVNamespace): Kv {
  return binding as Kv;
}

/** Reads a JSON value from the KV cache, returning null on miss/parse failure. */
export async function cacheGet<T>(kv: Kv | undefined, key: string): Promise<T | null> {
  if (!kv) {
    return null;
  }
  try {
    const raw = await kv.get(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Writes a JSON value to the KV cache.
 * Write-minimal: refuses oversized values and only writes when absent
 * unless `overwrite = true`. Keeps us comfortably inside the 1k writes/day
 * free cap for hot cache keys.
 */
export async function cacheSet(
  kv: Kv | undefined,
  key: string,
  value: unknown,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  overwrite = false
): Promise<boolean> {
  if (!kv) {
    return false;
  }
  if (!overwrite && (await kv.get(key)) !== null) {
    return false;
  }
  let raw: string;
  try {
    raw = JSON.stringify(value);
  } catch {
    return false;
  }
  if (byteLength(raw) > MAX_CACHE_VALUE_BYTES) {
    return false;
  }
  await kv.put(key, raw, { expirationTtl: ttlSeconds });
  return true;
}

/** get-or-compute with a TTL; loader only runs on miss and its result is cached. */
export async function cacheGetOrSet<T>(
  kv: Kv | undefined,
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>
): Promise<T> {
  const cached = await cacheGet<T>(kv, key);
  if (cached !== null) {
    return cached;
  }
  const value = await loader();
  await cacheSet(kv, key, value, ttlSeconds);
  return value;
}