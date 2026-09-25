import test from 'node:test';
import assert from 'node:assert/strict';
import { callOpenAiCompatible, normalizeChatCompletionsUrl } from '../src/providers/llm.ts';

test('normalizes both OpenAI base URLs and complete endpoints', () => {
  assert.equal(normalizeChatCompletionsUrl('https://example.test/v1/'), 'https://example.test/v1/chat/completions');
  assert.equal(normalizeChatCompletionsUrl('https://example.test/v1/chat/completions'), 'https://example.test/v1/chat/completions');
});

test('calls a custom OpenAI-compatible endpoint with native tools', async () => {
  let request;
  const result = await callOpenAiCompatible(
    { OPENAI_COMPATIBLE_EXTRA_HEADERS: '{"X-Provider":"test"}' },
    { provider: 'openai-compatible', model: 'test-model', apiKey: 'secret', baseUrl: 'https://llm.example.test/v1' },
    [{ role: 'user', content: 'hello' }],
    {
      tools: [{ name: 'clock', description: 'Get time', parameters: { type: 'object', properties: {} }, capability: { implemented: true, setupFields: [], requiredBindings: [], requiredSecrets: [], requiredSettings: [], authMode: 'none', sideEffect: 'read', confirmation: 'none' }, category: 'test', run: () => ({ ok: true, content: 'ok' }) }],
      fetchImpl: async (url, init) => {
        request = { url, init };
        return new Response(JSON.stringify({ choices: [{ message: { content: 'done', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'clock', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.content, 'done');
  assert.equal(result.toolCalls?.[0].function.name, 'clock');
  assert.equal(request.url, 'https://llm.example.test/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer secret');
  assert.equal(request.init.headers['X-Provider'], 'test');
  assert.equal(JSON.parse(request.init.body).model, 'test-model');
  assert.equal(JSON.parse(request.init.body).tool_choice, 'auto');
});
