import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import { clearHistoryForEmail, MAX_MESSAGES, normalizeHistory } from '../src/history/store.js';

const readJsonFixture = async name => JSON.parse(await fs.readFile(new URL(`./fixtures/history/${name}`, import.meta.url), 'utf8'));

test('normalizeHistory drops invalid entries, normalizes content, and keeps full pairs', async () => {
  const history = await readJsonFixture('mixed-history.json');

  assert.deepEqual(normalizeHistory(history), [
    { role: 'assistant', content: 'First answer' },
    { role: 'user', content: 'Second question' },
    { role: 'assistant', content: 'Second\n\nanswer' },
    { role: 'user', content: 'Third question' }
  ]);
});

test('normalizeHistory trims to the configured message limit while preserving complete turns', () => {
  const history = Array.from({ length: MAX_MESSAGES + 3 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `Message ${index}`
  }));

  const normalized = normalizeHistory(history);

  assert.equal(normalized.length, MAX_MESSAGES);
  assert.deepEqual(normalized[0], { role: 'assistant', content: `Message ${history.length - MAX_MESSAGES}` });
  assert.deepEqual(normalized.at(-1), { role: 'user', content: `Message ${history.length - 1}` });
});

test('normalizeHistory returns an empty list for non-array input', () => {
  assert.deepEqual(normalizeHistory('bad input'), []);
});

test('clearHistoryForEmail preserves the KV entry with an empty history array', async () => {
  const writes = [];
  const kv = {
    async put(key, value) {
      writes.push({ key, value });
    }
  };

  const cleared = await clearHistoryForEmail(kv, 'person@example.com');

  assert.deepEqual(cleared, []);
  assert.deepEqual(writes, [{ key: 'person@example.com', value: '[]' }]);
});
