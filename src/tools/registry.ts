import type { AppConfig } from '../config/loader.ts';
import { toolAvailability } from '../config/tiers.ts';
import type { AppEnv } from '../env.ts';
import type { ToolDef } from '../types.ts';

/**
 * Deliberately empty capability surface.
 *
 * The agent, schema validator, budgets, audit hooks, fan-out protocol, and
 * Capabilities are added here one at a time
 * only after their ownership, side-effect policy, provider contract, and
 * regression tests exist.
 */
export const allTools: ToolDef[] = [];

export function availableTools(_env: AppEnv, _config: AppConfig): ToolDef[] {
  return [];
}

export function toolReport(env: AppEnv): Array<{ name: string; category: string; available: boolean; reason?: string; requires?: string[]; capability?: ToolDef['capability'] }> {
  return allTools.map(tool => ({ name: tool.name, category: tool.category, requires: tool.requires, capability: tool.capability, ...toolAvailability(tool, env) }));
}
