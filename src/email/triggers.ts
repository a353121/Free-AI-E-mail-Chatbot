const DEFAULT_SUBJECT_TRIGGER = '[ai]';
const DEFAULT_SUBJECT_TRIGGER_MODE = 'startsWith';
const RESET_SUBJECT_KEYWORD = 'reset';
const MAIL_PREFIX_PATTERN = /^(?:(?:re|fw|fwd)\s*:\s*)+/i;
const SUBJECT_TRIGGER_MODES = new Map([
  ['contains', 'contains' as const],
  ['startswith', 'startsWith' as const],
  ['exact', 'exact' as const]
]);

export type SubjectTriggerMode = 'contains' | 'startsWith' | 'exact';

export interface SubjectMatchResult {
  matched: boolean;
  normalizedSubject: string;
  config: SubjectTriggerConfig;
}

export interface SubjectTriggerConfig {
  trigger: string;
  mode: SubjectTriggerMode;
}

export interface ResetSubjectResult {
  matched: boolean;
  normalizedSubject: string;
  keyword: string;
}

export function normalizeInboundSubject(subject: string, options: { stripMailPrefixes?: boolean } = {}): string {
  const { stripMailPrefixes = true } = options;

  let normalized = String(subject || '').toLowerCase().trim().replace(/\s+/g, ' ');

  if (stripMailPrefixes) {
    normalized = normalized.replace(MAIL_PREFIX_PATTERN, '').trim().replace(/\s+/g, ' ');
  }

  return normalized;
}

export function getSubjectTriggerConfig(env: { SUBJECT_TRIGGER?: string; SUBJECT_TRIGGER_MODE?: string } = {}): SubjectTriggerConfig {
  const trigger = normalizeInboundSubject(env.SUBJECT_TRIGGER || DEFAULT_SUBJECT_TRIGGER, { stripMailPrefixes: false });
  const requestedMode = String(env.SUBJECT_TRIGGER_MODE || DEFAULT_SUBJECT_TRIGGER_MODE).trim().toLowerCase();
  const normalizedMode = SUBJECT_TRIGGER_MODES.get(requestedMode) || DEFAULT_SUBJECT_TRIGGER_MODE;

  return {
    trigger,
    mode: normalizedMode
  };
}

export function matchesSubjectTrigger(subject: string, env: { SUBJECT_TRIGGER?: string; SUBJECT_TRIGGER_MODE?: string } = {}): SubjectMatchResult {
  const config = getSubjectTriggerConfig(env);
  const normalizedSubject = normalizeInboundSubject(subject);

  if (!config.trigger) {
    return {
      matched: false,
      normalizedSubject,
      config
    };
  }

  const matched =
    config.mode === 'exact'
      ? normalizedSubject === config.trigger
      : config.mode === 'contains'
        ? normalizedSubject.includes(config.trigger)
        : normalizedSubject.startsWith(config.trigger);

  return {
    matched,
    normalizedSubject,
    config
  };
}

export function matchesResetSubject(subject: string): ResetSubjectResult {
  const normalizedSubject = normalizeInboundSubject(subject);

  return {
    matched: normalizedSubject.includes(RESET_SUBJECT_KEYWORD),
    normalizedSubject,
    keyword: RESET_SUBJECT_KEYWORD
  };
}