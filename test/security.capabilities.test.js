import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchValidatedRedirects, validateOutboundUrl } from '../src/security/guardrails.ts';
import { allTools, availableTools, toolReport } from '../src/tools/registry.ts';
import { validateToolArguments } from '../src/agent/loop.ts';
import { DEFAULT_CONFIG } from '../src/config/loader.ts';
import worker from '../src/index.ts';

test('outbound URL validation rejects private IPv6 targets', () => {
  for (const value of ['http://[::1]/', 'http://[fc00::1]/', 'http://[fe80::1]/', 'http://[::ffff:192.168.1.1]/']) {
    assert.throws(() => validateOutboundUrl(value), /Private/);
  }
});

test('redirect validation checks every destination', async () => {
  const seen = [];
  const response = await fetchValidatedRedirects(async (url) => {
    seen.push(String(url));
    if (seen.length === 1) return new Response(null, { status: 302, headers: { location: 'https://public.example/next' } });
    return new Response('ok', { status: 200 });
  }, 'https://public.example/start');
  assert.equal(response.status, 200);
  assert.deepEqual(seen, ['https://public.example/start', 'https://public.example/next']);
});

test('legacy operational routes are disabled without the admin control plane', async () => {
  const response = await worker.fetch(new Request('https://bot.example/tools'), {});
  assert.equal(response.status, 410);
});

test('the capability registry starts empty and configuration cannot invent tools', () => {
  assert.deepEqual(allTools, []);
  assert.deepEqual(availableTools({}, DEFAULT_CONFIG), []);
  assert.deepEqual(toolReport({}), []);
});

test('the admin and user surfaces do not expose custom MCP controls', async () => {
  const admin = await worker.fetch(new Request('https://bot.example/admin'), {});
  const adminBody = await admin.text();
  assert.doesNotMatch(adminBody, /id="mcp-form"|\/admin\/api\/mcp|Add MCP/);
  const user = await (await import('../src/user/ui.ts')).accountPage();
  assert.doesNotMatch(await user.text(), /MCP|mcp/);
});

test('tool argument validation enforces nested schema constraints', () => {
  const tool = {
    name: 'example',
    description: 'test',
    category: 'test',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', minLength: 2, maxLength: 10 },
        limit: { type: 'integer', minimum: 1, maximum: 5 },
        tags: { type: 'array', maxItems: 2, items: { type: 'string', maxLength: 4 } }
      }
    },
    run: async () => ({ ok: true, content: 'ok' })
  };
  assert.equal(validateToolArguments(tool, { query: 'hello', limit: 2, tags: ['one'] }), null);
  assert.match(validateToolArguments(tool, { query: 'x' }), /too short/);
  assert.match(validateToolArguments(tool, { query: 'hello', limit: 6 }), /too large/);
  assert.match(validateToolArguments(tool, { query: 'hello', tags: ['one', 'two', 'three'] }), /too many/);
  assert.match(validateToolArguments(tool, { query: 'hello', extra: true }), /Unknown argument/);
});
