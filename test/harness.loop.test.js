import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CONFIG } from '../src/config/loader.ts';
import { runAgent } from '../src/agent/loop.ts';

function config() {
  return {
    ...DEFAULT_CONFIG,
    llmModel: 'test-model',
    llmApiKey: 'test-key',
    contextCaps: { ...DEFAULT_CONFIG.contextCaps, modelContextTokens: 2_000, outputTokens: 200 }
  };
}

test('the harness can use internal history search without exposing external tools', async () => {
  const requests = [];
  const searched = [];
  const result = await runAgent(
    {},
    config(),
    [{ role: 'system', content: 'Answer carefully.' }, { role: 'user', content: 'What did we decide?' }],
    [],
    {
      historySearch: async query => { searched.push(query); return { ok: true, content: '[Untrusted conversation memory]\nMessage 2: We chose D1.' }; },
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        if (requests.length === 1) return new Response(JSON.stringify({ choices: [{ message: { content: '', tool_calls: [{ id: 'h1', type: 'function', function: { name: 'history_search', arguments: '{"query":"decision"}' } }] } }], usage: { prompt_tokens: 20, completion_tokens: 4 } }), { status: 200 });
        return new Response(JSON.stringify({ choices: [{ message: { content: 'We decided to use D1.' } }], usage: { prompt_tokens: 30, completion_tokens: 6 } }), { status: 200 });
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.reply, 'We decided to use D1.');
  assert.deepEqual(searched, ['decision']);
  assert.equal(result.historySearches, 1);
  assert.equal(result.actualPromptTokens, 50);
  assert.equal(result.actualCompletionTokens, 10);
  assert.ok(requests[0].tools.some(tool => tool.function.name === 'history_search'));
  assert.equal(requests[0].tools.length, 1);
});

test('a no-tool run sends no tool schema or tool choice', async () => {
  let body;
  const result = await runAgent({}, config(), [{ role: 'system', content: 'Be concise.' }, { role: 'user', content: 'Hello' }], [], {
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: 'Hi.' } }] }), { status: 200 });
    }
  });
  assert.equal(result.reply, 'Hi.');
  assert.equal('tools' in body, false);
  assert.equal('tool_choice' in body, false);
});

test('manifest-style models can request the same private history operation', async () => {
  let calls = 0;
  const searched = [];
  const result = await runAgent({}, { ...config(), llmModel: 'openrouter/free' }, [{ role: 'system', content: 'Answer carefully.' }, { role: 'user', content: 'Recall the old note.' }], [], {
    historySearch: async query => { searched.push(query); return { ok: true, content: '[Untrusted conversation memory]\nMessage 4: old note.' }; },
    fetchImpl: async (_url, init) => {
      calls += 1;
      const body = calls === 1 ? { choices: [{ message: { content: '[TOOL(history_search)] {"query":"old note"}' } }] } : { choices: [{ message: { content: 'I found the old note.' } }] };
      assert.equal('tools' in JSON.parse(init.body), false);
      return new Response(JSON.stringify(body), { status: 200 });
    }
  });
  assert.equal(result.reply, 'I found the old note.');
  assert.deepEqual(searched, ['old note']);
  assert.equal(result.historySearches, 1);
});

test('history recall is capped at two searches per email', async () => {
  let requestCount = 0;
  let searches = 0;
  const result = await runAgent({}, config(), [{ role: 'system', content: 'Answer carefully.' }, { role: 'user', content: 'Search old notes.' }], [], {
    historySearch: async () => { searches += 1; return { ok: true, content: 'old note' }; },
    fetchImpl: async (_url, init) => {
      requestCount += 1;
      const body = requestCount === 1
        ? { choices: [{ message: { content: '', tool_calls: [1, 2, 3].map((id) => ({ id: `h${id}`, type: 'function', function: { name: 'history_search', arguments: `{"query":"note ${id}"}` } })) } }] }
        : { choices: [{ message: { content: 'Done.' } }] };
      return new Response(JSON.stringify(body), { status: 200 });
    }
  });
  assert.equal(result.reply, 'Done.');
  assert.equal(searches, 2);
  assert.equal(result.historySearches, 2);
});
