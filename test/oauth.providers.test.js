import test from 'node:test';
import assert from 'node:assert/strict';
import { beginGoogleOAuth, completeGoogleOAuth, revokeGoogleOAuth } from '../src/admin/googleOAuth.ts';
import { beginGitHubOAuth, completeGitHubOAuth } from '../src/admin/githubOAuth.ts';
import { applyRuntimeOverrides, loadAdminSecrets, saveAdminSecrets } from '../src/admin/runtime.ts';

class MemoryDb {
  secrets = new Map();
  googleState = null;
  githubState = null;

  async all(sql) {
    if (sql.includes('SELECT name, ciphertext FROM admin_secrets')) return [...this.secrets].map(([name, ciphertext]) => ({ name, ciphertext }));
    return [];
  }

  async first(sql, state) {
    if (sql.includes('google_oauth_states')) return this.googleState && this.googleState.state === state ? this.googleState : null;
    if (sql.includes('github_oauth_states')) return this.githubState && this.githubState.state === state ? this.githubState : null;
    return null;
  }

  async run(sql, ...params) {
    if (sql.includes('INSERT INTO admin_secrets')) this.secrets.set(String(params[0]), String(params[1]));
    if (sql.includes('DELETE FROM admin_secrets')) for (const name of ['GOOGLE_ACCESS_TOKEN', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_TOKEN_EXPIRES_AT', 'GOOGLE_GRANTED_SCOPES']) this.secrets.delete(name);
    if (sql.includes('DELETE FROM google_oauth_states WHERE state')) this.googleState = null;
    if (sql.includes('DELETE FROM github_oauth_states WHERE state')) this.githubState = null;
    if (sql.includes('INSERT INTO google_oauth_states')) this.googleState = { state: String(params[0]), code_verifier: String(params[1]), redirect_uri: String(params[2]), expires_at: Math.floor(Date.now() / 1000) + 600 };
    if (sql.includes('INSERT INTO github_oauth_states')) this.githubState = { state: String(params[0]), code_verifier: String(params[1]), redirect_uri: String(params[2]), expires_at: Math.floor(Date.now() / 1000) + 600 };
    return {};
  }

  async batch() { return []; }
  async transaction(fn) { return fn(this); }
  close() {}
}

const env = { ADMIN_SESSION_SECRET: 'test-admin-master', GOOGLE_CLIENT_ID: 'google-client', GOOGLE_CLIENT_SECRET: 'google-secret', GITHUB_CLIENT_ID: 'github-client', GITHUB_CLIENT_SECRET: 'github-secret' };

test('Google OAuth start uses state, PKCE, offline access, and the exact callback', async () => {
  const db = new MemoryDb();
  const { authorizationUrl } = await beginGoogleOAuth(db, env, 'https://worker.example');
  const url = new URL(authorizationUrl);
  assert.equal(url.origin, 'https://accounts.google.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://worker.example/admin/api/google/oauth/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('code_challenge'));
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('state'), db.googleState.state);
});

test('Google OAuth callback encrypts tokens and rejects expired state', async () => {
  const db = new MemoryDb();
  await beginGoogleOAuth(db, env, 'https://worker.example');
  const state = db.googleState.state;
  await completeGoogleOAuth(db, env, state, 'google-code', async (url, init) => {
    assert.equal(String(url), 'https://oauth2.googleapis.com/token');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['content-type'], 'application/x-www-form-urlencoded');
    return new Response(JSON.stringify({ access_token: 'google-access', refresh_token: 'google-refresh', expires_in: 3600, scope: 'gmail.readonly drive' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const stored = await loadAdminSecrets(db, env);
  assert.equal(stored.GOOGLE_ACCESS_TOKEN, 'google-access');
  assert.equal(stored.GOOGLE_REFRESH_TOKEN, 'google-refresh');
  assert.equal(stored.GOOGLE_GRANTED_SCOPES, 'gmail.readonly drive');
  let revoked = false;
  await revokeGoogleOAuth(db, env, async (url, init) => {
    revoked = String(url) === 'https://oauth2.googleapis.com/revoke' && init.method === 'POST';
    return new Response(null, { status: 200 });
  });
  assert.equal(revoked, true);
  assert.equal((await loadAdminSecrets(db, env)).GOOGLE_ACCESS_TOKEN, undefined);
  await assert.rejects(() => completeGoogleOAuth(db, env, state, 'again', fetch), /invalid or expired/);
});

test('GitHub OAuth supports PKCE and stores expiring access and refresh tokens', async () => {
  const db = new MemoryDb();
  const { authorizationUrl } = await beginGitHubOAuth(db, env, 'https://worker.example');
  const url = new URL(authorizationUrl);
  assert.equal(url.searchParams.get('redirect_uri'), 'https://worker.example/admin/api/github/oauth/callback');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(url.searchParams.get('scope').includes('offline_access'));
  await completeGitHubOAuth(db, env, db.githubState.state, 'github-code', async (request, init) => {
    assert.equal(String(request), 'https://github.com/login/oauth/access_token');
    assert.equal(init.headers.accept, 'application/json');
    return new Response(JSON.stringify({ access_token: 'github-access', refresh_token: 'github-refresh', expires_in: 28800, refresh_token_expires_in: 15897600, scope: 'repo,read:user' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const stored = await loadAdminSecrets(db, env);
  assert.equal(stored.GITHUB_ACCESS_TOKEN, 'github-access');
  assert.equal(stored.GITHUB_REFRESH_TOKEN, 'github-refresh');
  assert.equal(stored.GITHUB_GRANTED_SCOPES, 'repo,read:user');
});

test('runtime refreshes expired Google and GitHub access tokens and maps them to adapters', async () => {
  const db = new MemoryDb();
  await saveAdminSecrets(db, env.ADMIN_SESSION_SECRET, {
    GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET,
    GOOGLE_REFRESH_TOKEN: 'google-refresh',
    GOOGLE_TOKEN_EXPIRES_AT: '1',
    GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
    GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
    GITHUB_REFRESH_TOKEN: 'github-refresh',
    GITHUB_TOKEN_EXPIRES_AT: '1'
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('google')) return new Response(JSON.stringify({ access_token: 'google-new', expires_in: 3600 }), { status: 200 });
    return new Response(JSON.stringify({ access_token: 'github-new', refresh_token: 'github-new-refresh', expires_in: 3600 }), { status: 200 });
  };
  try {
    const runtime = await applyRuntimeOverrides({ ADMIN_SESSION_SECRET: env.ADMIN_SESSION_SECRET }, db);
    assert.equal(runtime.GMAIL_ACCESS_TOKEN, 'google-new');
    assert.equal(runtime.GITHUB_TOKEN, 'github-new');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
