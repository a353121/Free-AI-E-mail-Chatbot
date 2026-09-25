import test from 'node:test';
import assert from 'node:assert/strict';

import { estimateChatTokens, estimateMessageTokens, estimateTokens } from '../src/agent/tokens.ts';
import { fitModelContext } from '../src/agent/loop.ts';
import { conversationKey, subjectKey } from '../src/data/memory.ts';
import { searchConversationHistory } from '../src/data/historySearch.ts';

test('token estimates are conservative and include message overhead', () => {
  assert.equal(estimateTokens(''), 1);
  assert.ok(estimateTokens('hello'.repeat(100)) >= Math.ceil(new TextEncoder().encode('hello'.repeat(100)).byteLength / 3));
  assert.ok(estimateMessageTokens({ role: 'user', content: 'hello' }) > estimateTokens('hello'));
});

test('token context fitting preserves system and newest email within the budget', () => {
  const messages = [
    { role: 'system', content: 'policy '.repeat(80) },
    { role: 'user', content: 'old request '.repeat(80) },
    { role: 'assistant', content: 'old answer '.repeat(80) },
    { role: 'user', content: 'current request '.repeat(50) }
  ];
  const fitted = fitModelContext(messages, 900, { unit: 'tokens' });
  assert.ok(estimateChatTokens(fitted) <= 900);
  assert.equal(fitted[0].role, 'system');
  assert.equal(fitted.at(-1).content.includes('current'), true);
  assert.ok(estimateChatTokens(fitModelContext(messages, 64, { unit: 'tokens' })) <= 64);
  assert.ok(estimateChatTokens(fitModelContext(messages, 32, { unit: 'tokens' })) <= 32);
});

test('subject identity strips repeated mail prefixes but keeps subjects separate', () => {
  assert.equal(subjectKey(' Fwd: Re: Hello   AI '), 'hello ai');
  assert.equal(conversationKey('Hello AI'), conversationKey('Re: Fwd: Hello AI'));
  assert.notEqual(conversationKey('Hello AI'), conversationKey('Different topic'));
  assert.equal(conversationKey('   '), 'legacy');
});

class SearchDb {
  constructor({ failFts = false } = {}) { this.failFts = failFts; this.calls = []; }
  async all(sql, ...params) {
    this.calls.push({ sql, params });
    if (sql.includes('message_fts MATCH') && this.failFts) throw new Error('fts unavailable');
    return [{ id: 41, role: 'user', content: 'The old project decision was to keep the transcript in D1.', created_at: 123 }];
  }
  async first() { return null; }
  async run() { return { changed: 0 }; }
  async batch() { return []; }
  async transaction(fn) { return fn(this); }
  close() {}
}

test('history search is scoped, capped, and marks retrieved text as untrusted', async () => {
  const db = new SearchDb();
  const result = await searchConversationHistory(db, 'project decision', { userId: 7, conversationId: 9, limit: 4, resultTokens: 80 });
  assert.equal(result.ok, true);
  assert.match(result.content, /Untrusted conversation memory/);
  assert.ok(new TextEncoder().encode(result.content).byteLength <= 80 * 3);
  assert.match(db.calls[0].sql, /message_fts MATCH/);
  assert.deepEqual(db.calls[0].params.slice(1, 3), [9, 7]);
});

test('history search falls back to LIKE when FTS is unavailable', async () => {
  const db = new SearchDb({ failFts: true });
  const result = await searchConversationHistory(db, 'project', { userId: 7, conversationId: 9 });
  assert.equal(result.ok, true);
  assert.equal(result.data.source, 'like-fallback');
  assert.ok(db.calls.some(call => call.sql.includes('lower(coalesce(content')));
});

test('history search quotes FTS terms instead of accepting search expressions', async () => {
  const db = new SearchDb();
  await searchConversationHistory(db, 'alpha" OR 1=1 --', { userId: 7, conversationId: 9 });
  const match = String(db.calls[0].params[0]);
  assert.match(match, /"alpha"/);
  assert.match(match, /"OR"/);
  assert.doesNotMatch(match, /OR 1=1/);
});
