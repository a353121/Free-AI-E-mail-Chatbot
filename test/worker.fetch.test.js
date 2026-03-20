import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/index.js';

test('fetch redirects browser visits to the GitHub repository with a 301', async () => {
  const response = await worker.fetch(new Request('https://ai-e-mail-chatbot.example'));

  assert.equal(response.status, 301);
  assert.equal(response.headers.get('location'), 'https://github.com/a353121/free-ai-e-mail-chatbot');
});
