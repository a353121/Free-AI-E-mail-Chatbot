import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesResetSubject, matchesSubjectTrigger, normalizeInboundSubject } from '../src/email/triggers.js';

test('normalizeInboundSubject lowercases, trims, and collapses whitespace', () => {
  assert.equal(normalizeInboundSubject('   Hello   OPENROUTER   World   '), 'hello openrouter world');
});

test('normalizeInboundSubject strips repeated mail prefixes by default', () => {
  assert.equal(normalizeInboundSubject(' Re:  Fwd: FW:   [AI]   Need Help '), '[ai] need help');
});

test('normalizeInboundSubject can preserve mail prefixes when needed', () => {
  assert.equal(normalizeInboundSubject(' Re: [AI] Need Help ', { stripMailPrefixes: false }), 're: [ai] need help');
});

test('matchesSubjectTrigger defaults to startsWith with [ai]', () => {
  const result = matchesSubjectTrigger(' Re:   [AI]   Please summarize this ', {});
  assert.equal(result.matched, true);
  assert.equal(result.normalizedSubject, '[ai] please summarize this');
  assert.equal(result.config.mode, 'startsWith');
  assert.equal(result.config.trigger, '[ai]');
});

test('matchesSubjectTrigger supports contains mode', () => {
  const result = matchesSubjectTrigger('Status update for openrouter integration', {
    SUBJECT_TRIGGER: 'openrouter',
    SUBJECT_TRIGGER_MODE: 'contains'
  });
  assert.equal(result.matched, true);
});

test('matchesSubjectTrigger supports exact mode', () => {
  assert.equal(
    matchesSubjectTrigger('  Re: [AI]  ', {
      SUBJECT_TRIGGER: '[AI]',
      SUBJECT_TRIGGER_MODE: 'exact'
    }).matched,
    true
  );
  assert.equal(
    matchesSubjectTrigger('[AI] follow-up', {
      SUBJECT_TRIGGER: '[AI]',
      SUBJECT_TRIGGER_MODE: 'exact'
    }).matched,
    false
  );
});

test('matchesSubjectTrigger normalizes SUBJECT_TRIGGER_MODE casing', () => {
  const result = matchesSubjectTrigger('[ai] follow-up', {
    SUBJECT_TRIGGER: '[AI]',
    SUBJECT_TRIGGER_MODE: 'STARTSWITH'
  });
  assert.equal(result.matched, true);
  assert.equal(result.config.mode, 'startsWith');
});

test('matchesResetSubject is case-insensitive and uses contains matching', () => {
  assert.equal(matchesResetSubject('RESET').matched, true);
  assert.equal(matchesResetSubject('Re: please Reset my chat').matched, true);
  assert.equal(matchesResetSubject('status update').matched, false);
});
