import type { AppConfig } from '../config/loader.ts';

export interface IntentResult { name: string; confidence: number; tone: string; }
export function classifyIntent(text: string, config: AppConfig): IntentResult {
  const value = text.toLowerCase();
  const allowed = new Set(config.emailIntents);
  let best: IntentResult = { name: 'info', confidence: 0, tone: 'helpful and direct' };
  for (const [name, intent] of Object.entries(config.intents)) {
    if (allowed.size && !allowed.has(name)) continue;
    const matches = intent.keywords.filter(keyword => value.includes(keyword.toLowerCase())).length;
    const confidence = intent.keywords.length ? matches / Math.min(intent.keywords.length, 4) : 0;
    if (confidence > best.confidence) best = { name, confidence: Math.min(1, confidence), tone: intent.tone };
  }
  return best;
}
