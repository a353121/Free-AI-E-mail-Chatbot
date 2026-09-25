import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchToolOverHttp, verifyToolSignature } from '../src/agent/fanout.ts';

test('fan-out request is signed and accepted by the verifier', async () => {
  let request;
  const result = await dispatchToolOverHttp('https://child.example/_internal/tool', 'shared-secret', 'current_time', { timezone: 'UTC' }, 'sender@example.com', async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ ok: true, content: 'UTC' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(result.ok, true);
  assert.equal(request.url, 'https://child.example/_internal/tool');
  assert.equal(await verifyToolSignature('shared-secret', request.init.body, request.init.headers['x-tool-signature']), true);
  assert.equal(await verifyToolSignature('wrong', request.init.body, request.init.headers['x-tool-signature']), false);
  const withoutRequestId = JSON.stringify({ tool: 'current_time', args: {}, timestamp: Date.now() });
  assert.equal(await verifyToolSignature('shared-secret', withoutRequestId, request.init.headers['x-tool-signature']), false);
});
