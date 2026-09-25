/**
 * Application-wide shared types and constants.
 * Kept free of program logic; pure type/utlity module.
 */

/** Role names used in the conversation buffer and D1 `messages` table. */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

/** A single turn in the conversation sent to the LLM. */
export interface ChatMessage {
  role: MessageRole;
  content?: string;
  /** Tool name for role === 'tool' results. */
  name?: string;
  /** Native OpenAI-style tool call. */
  tool_calls?: ToolCall[];
  /** Native tool_call_id used to map tool results back. */
  tool_call_id?: string;
}

/** OpenAI-compatible tool call emitted by the model. */
export interface ToolCall {
  id: string;
  type?: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/** JSON-schema-ish parameter descriptor for a tool (compact). */
export interface ToolParameterSchema {
  type?: 'string' | 'number' | 'boolean' | 'integer' | 'array' | 'object' | 'null';
  description?: string;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  maxProperties?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  items?: ToolParameterSchema;
  required?: string[];
  properties?: Record<string, ToolParameterSchema>;
  additionalProperties?: boolean;
  default?: unknown;
}

/** Canonical definition of a tool reachable by the agent loop. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  /** Binding or secret keys required for this capability. */
  requires?: string[];
  /** Setup metadata shown in the Admin capability catalog. */
  capability?: ToolCapability;
  /** Category label for docs/registry. */
  category: string;
  /** Hard-coded list of dangerous ops; gated by destructive flags.*/
  destructive?: boolean;
  run: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolOutput> | ToolOutput;
}

export interface SetupField {
  key: string;
  label: string;
  type?: 'text' | 'password' | 'url' | 'textarea' | 'number';
  secret?: boolean;
  optional?: boolean;
  description?: string;
}

/** Complete setup and safety metadata surfaced in the Admin capability catalog. */
export interface ToolCapability {
  implemented: boolean;
  setupFields: SetupField[];
  requiredBindings: string[];
  requiredSecrets: string[];
  requiredSettings: string[];
  authMode: 'none' | 'api-key' | 'headers' | 'oauth' | 'cloudflare-binding';
  sideEffect: 'read' | 'user-write' | 'write' | 'destructive';
  confirmation: 'none' | 'sender-thread' | 'admin';
}

/** Structured output of one tool execution. */
export interface ToolOutput {
  ok: boolean;
  /** Human/model readable result. */
  content: string;
  /** Error reason when !ok. */
  error?: string;
  /** Extra structured data (json), optional, size-capped. */
  data?: unknown;
}

/** Budgets that the agent loop enforces (see agent/budgets.ts). */
export interface Budgets {
  maxSteps: number;
  maxSubrequests: number;
  maxWallMs: number;
  maxToolResultBytes: number;
  maxParallelTools: number;
  maxTokenContext: number;
  subrequestsUsed: number;
}

/** Context handed to every tool run. */
export interface ToolContext {
  env: Record<string, unknown>;
  /** D1 database binding. */
  db?: unknown;
  /** KV binding used for caching. */
  kv?: unknown;
  /** Fetch implementation (injectable for tests). */
  fetch: typeof fetch;
  /** Aborted when the agent's tool budget expires. */
  signal?: AbortSignal;
  /** Sender email when the run is email-triggered. */
  sender?: string;
  /** Immutable approved-user identity for per-user credentials and ownership. */
  userId?: number;
  /** D1 conversation receiving durable file references created by this run. */
  conversationId?: number;
  /** Effective bounded R2 retention for files created during this run. */
  fileCacheTtlSeconds?: number;
  /** Stable inbound thread key used for side-effect confirmation. */
  threadKey?: string;
  /** Utilities the tools may use. */
  utils: ToolUtils;
  /** Log sink (injectable). */
  log: (level: 'debug' | 'info' | 'warn' | 'error', message: string, extra?: unknown) => void;
}

/** Sandbox helpers made available to tools. */
export interface ToolUtils {
  now: () => number;
  truncate: (text: string, maxBytes: number) => string;
  safeJson: (text: string) => unknown | null;
  hmac?: (secret: string, data: string) => Promise<string>;
}

/** Result shape returned by pipeline stages. */
export interface PipelineResult {
  ok: boolean;
  reason?: string;
  reply?: string;
  runId?: string;
}

/** Email threading headers set on the outbound message. */
export type ThreadHeaders = Record<string, string>;
