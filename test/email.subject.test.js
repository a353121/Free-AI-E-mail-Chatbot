import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { buildReplySubject } from '../src/email/subject.js';

const readJsonFixture = async name => JSON.parse(await fs.readFile(new URL(`./fixtures/providers/${name}`, import.meta.url), 'utf8'));

test('buildReplySubject adds a Re prefix for fresh inbound subjects', () => {
  assert.equal(buildReplySubject('OpenRouter status update'), 'Re: OpenRouter status update');
});

test('buildReplySubject preserves existing reply prefixes case-insensitively', () => {
  assert.equal(buildReplySubject('re: Existing Thread'), 're: Existing Thread');
});

test('buildReplySubject falls back when the subject is empty', () => {
  assert.equal(buildReplySubject('   '), 'Re: AI response');
});

test('buildReplySubject can be paired with provider fixtures without extra munging', async () => {
  const payload = await readJsonFixture('openrouter-success.json');
  assert.equal(buildReplySubject(payload.model), 'Re: openrouter/free');
});
