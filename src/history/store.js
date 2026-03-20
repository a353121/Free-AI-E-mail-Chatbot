import { normalizePlainText } from '../shared.js';

export const MAX_TURNS = 15;
export const MAX_MESSAGES = MAX_TURNS * 2;
export const SYSTEM_INSTRUCTIONS_KEY = 'SYSTEM_INSTRUCTIONS';

export function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  const normalized = history
    .filter(item => item && typeof item === 'object')
    .filter(item => (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
    .map(item => ({ role: item.role, content: normalizePlainText(item.content) }))
    .filter(item => item.content);

  let trimmed = normalized.slice(-MAX_MESSAGES);

  if (trimmed.length % 2 !== 0) {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}

export async function loadHistoryForEmail(kv, email) {
  const stored = await kv.get(email);
  if (!stored) {
    return [];
  }

  try {
    return normalizeHistory(JSON.parse(stored));
  } catch (error) {
    console.error(`[KV] Invalid JSON for ${email}, resetting history:`, error);
    return [];
  }
}

export async function loadSystemInstructions(kv) {
  const systemInstructions = await kv.get(SYSTEM_INSTRUCTIONS_KEY);
  if (!systemInstructions || !systemInstructions.trim()) {
    return null;
  }

  return systemInstructions.trim();
}

export async function saveHistoryForEmail(kv, email, history) {
  const normalized = normalizeHistory(history);
  await kv.put(email, JSON.stringify(normalized));
  return normalized;
}

export async function clearHistoryForEmail(kv, email) {
  const emptyHistory = [];
  await kv.put(email, JSON.stringify(emptyHistory));
  return emptyHistory;
}
