import type { AppEnv } from '../env.ts';
import type { ToolDef } from '../types.ts';

/** Names of platform bindings and their presence. */
export interface BindingReport {
  bindings: {
    DB: boolean;
    CHAT_MEMORY: boolean;
    AI: boolean;
    VECTORIZE: boolean;
    R2: boolean;
    QUEUE: boolean;
    WORKFLOWS: boolean;
    EMAIL: boolean;
    BROWSER: boolean;
    USAGE_COUNTER: boolean;
    HYPERDRIVE: boolean;
  };
  secrets: Record<string, boolean>;
}

const BINDING_NAMES = [
  'DB', 'CHAT_MEMORY', 'AI', 'VECTORIZE', 'R2', 'QUEUE', 'WORKFLOWS', 'EMAIL', 'BROWSER', 'USAGE_COUNTER', 'HYPERDRIVE'
] as const;

export type BindingName = (typeof BINDING_NAMES)[number];

/** Known platform binding names (as opposed to secret/env keys). */
export function isBindingName(name: string): name is BindingName {
  return (BINDING_NAMES as readonly string[]).includes(name);
}

/**
 * Resolves whether a required resource is present.
 * Binding names consult env bindings; anything else is treated as a secret/env var.
 */
export function hasResource(env: AppEnv, name: string): boolean {
  if (isBindingName(name)) {
    return Boolean((env as unknown as Record<string, unknown>)[name]);
  }
  const value = (env as unknown as Record<string, unknown>)[name];
  return typeof value === 'string' ? value.length > 0 : Boolean(value);
}

export function bindingReport(env: AppEnv): BindingReport {
  const bindings = {} as BindingReport['bindings'];
  for (const name of BINDING_NAMES) {
    bindings[name] = Boolean((env as unknown as Record<string, unknown>)[name]);
  }
  const secrets: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(env as unknown as Record<string, unknown>)) {
    if (!isBindingName(key)) {
      secrets[key] = typeof value === 'string' ? value.length > 0 : Boolean(value);
    }
  }
  return {
    bindings,
    secrets
  };
}

export interface ToolAvailability {
  available: boolean;
  status: 'ready' | 'needs-setup' | 'missing-binding' | 'not-implemented';
  missing: string[];
  /** Short human-readable reason when unavailable. */
  reason?: string;
}

/**
 * Central gate for future registered capabilities. The current registry is empty,
 * so no capability is advertised or executable.
 */
export function toolAvailability(tool: ToolDef, env: AppEnv): ToolAvailability {
  if (tool.capability?.implemented === false) return { available: false, status: 'not-implemented', missing: [], reason: 'not implemented' };
  const missing: string[] = [];
  for (const requirement of tool.requires ?? []) {
    if (!hasResource(env, requirement)) {
      missing.push(requirement);
    }
  }
  if (missing.length) {
    const hasBindingGap = missing.some(isBindingName);
    return { available: false, status: hasBindingGap ? 'missing-binding' : 'needs-setup', missing, reason: `missing ${missing.join(', ')}` };
  }
  return { available: true, status: 'ready', missing: [] };
}

export { BINDING_NAMES };
