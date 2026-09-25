import test from 'node:test';
import assert from 'node:assert/strict';

import { fitModelContext } from '../src/agent/loop.ts';

test('context fitting preserves complete tool-call turns and byte bounds', () => {
  const messages = [
    { role: 'system', content: 'policy '.repeat(40) },
    { role: 'user', content: 'old request '.repeat(40) },
    { role: 'assistant', content: '', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] },
    { role: 'tool', name: 'lookup', tool_call_id: 'call-1', content: 'old result '.repeat(40) },
    { role: 'user', content: '最新の依頼 '.repeat(100) }
  ];
  const fitted = fitModelContext(messages, 900);
  assert.ok(new TextEncoder().encode(JSON.stringify(fitted)).byteLength <= 900);
  assert.equal(fitted[0].role, 'system');
  assert.equal(fitted.at(-1).role, 'user');
  assert.equal(fitted.some(message => message.role === 'assistant' && message.tool_calls), fitted.some(message => message.role === 'tool' && message.tool_call_id === 'call-1'));
});

test('context fitting does not mutate the caller-owned messages', () => {
  const original = [{ role: 'user', content: 'x'.repeat(4000) }];
  const snapshot = JSON.stringify(original);
  fitModelContext(original, 400);
  assert.equal(JSON.stringify(original), snapshot);
});
