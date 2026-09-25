import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptAdminSecret, decryptAdminSecret } from '../src/admin/runtime.ts';
import { verifyAdminPassword } from '../src/admin/auth.ts';
import { adminPage } from '../src/admin/ui.ts';

test('admin encrypted secret round trips and rejects the wrong master', async () => {
  const encrypted = await encryptAdminSecret('master-secret', 'provider-key');
  assert.notEqual(encrypted, 'provider-key');
  assert.equal(await decryptAdminSecret('master-secret', encrypted), 'provider-key');
  assert.equal(await decryptAdminSecret('wrong-secret', encrypted), null);
});

test('admin password verifier accepts the documented PBKDF2 format', async () => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode('correct horse battery staple'), 'PBKDF2', false, ['deriveBits']);
  const hash = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, material, 256));
  const encode = value => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
  const encoded = `pbkdf2-sha256$100000$${encode(salt)}$${encode(hash)}`;
  assert.equal(await verifyAdminPassword('correct horse battery staple', encoded), true);
  assert.equal(await verifyAdminPassword('wrong', encoded), false);
});

test('admin UI has separate authenticated workspace sections', async () => {
  const response = adminPage(true);
  const body = await response.text();
  assert.match(body, /AI &amp; prompts/);
  assert.match(body, /Runtime safety/);
  assert.doesNotMatch(body, /id="mcp-form"|\/admin\/api\/mcp/);
  assert.match(body, /Users/);
  assert.match(body, /Secrets/);
  assert.doesNotMatch(body, /oauthClientId/);
  assert.doesNotMatch(body, /Connect OAuth/);
  assert.match(body, /Connect Google/);
  assert.match(body, /Connect GitHub/);
  assert.match(body, /name="GOOGLE_CLIENT_ID"/);
  assert.match(body, /name="compaction_trigger_tokens"/);
  assert.match(body, /name="history_search_max_calls"/);
  assert.match(body, /Context token budgets/);
  assert.doesNotMatch(body, /compaction_threshold_messages|Context byte caps/);
  assert.doesNotMatch(body, /name="oauthEnabled"/);
  assert.match(body, /id="user-search"/);
  assert.match(body, /id="user-status"/);
  assert.match(body, /\/admin\/api\/users\//);
  assert.doesNotMatch(body, /hidden aria-hidden/);
  assert.match(response.headers.get('content-security-policy') || '', /script-src 'nonce-/);
});
