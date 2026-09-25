import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.ts';

test('production health route is public and exposes the deployed version', async () => {
  const response = await worker.fetch(new Request('https://bot.example/health'), {});
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.version, '2.1.0');
});

test('admin route presents login without a session', async () => {
  const response = await worker.fetch(new Request('https://bot.example/admin'), {});
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Admin control plane/);
  assert.match(body, /current-password/);
  assert.match(response.headers.get('content-security-policy') || '', /script-src 'nonce-/i);
});
