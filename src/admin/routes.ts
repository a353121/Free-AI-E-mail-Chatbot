import type { Db } from '../data/db.ts';
import { bindingReport } from '../config/tiers.ts';
import { guardStatus } from '../data/usageGuard.ts';
import { deleteSenderData } from '../data/sender.ts';
import type { AppEnv } from '../env.ts';
import { adminPage } from './ui.ts';
import { adminJson, adminError } from './response.ts';
import { ADMIN_RUNTIME_KEYS, ADMIN_SETTING_KEYS, ADMIN_SECRET_KEYS, applyRuntimeOverrides, configuredSecretNames, saveAdminSecrets, saveRuntimeSettings } from './runtime.ts';
import { clearSessionCookie, csrfValid, loginAllowed, makeAdminSession, readAdminSession, recordLogin, sessionCookie, verifyAdminPassword } from './auth.ts';
import { revokeAllUserSessions } from '../user/auth.ts';
import { beginGoogleOAuth, completeGoogleOAuth, revokeGoogleOAuth } from './googleOAuth.ts';
import { beginGitHubOAuth, completeGitHubOAuth } from './githubOAuth.ts';
import { recordUserTombstone, transitionUser, deleteUserOwnedData, type UserStatus } from '../data/users.ts';
import { compactionHealth } from '../data/compaction.ts';
import { listUserAudit, recordUserAudit } from '../data/userAudit.ts';

async function bodyJson(request: Request): Promise<Record<string, unknown>> { try { const value = await request.json() as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; } }
function configured(env: AppEnv): boolean { return Boolean(env.ADMIN_PASSWORD_HASH && env.ADMIN_SESSION_SECRET); }
function temporaryPasswordMatches(env: AppEnv, password: string): boolean {
  return env.TEMPORARY_ADMIN_MODE === 'true' && Boolean(env.TEMPORARY_ADMIN_PASSWORD) && env.TEMPORARY_ADMIN_PASSWORD === password;
}
function publicSettings(env: AppEnv, db: Db | undefined): Promise<Record<string, string>> {
  if (!db) return Promise.resolve(Object.fromEntries([...ADMIN_RUNTIME_KEYS, ...ADMIN_SETTING_KEYS].map(key => [key, String((env as unknown as Record<string, unknown>)[key] || '')])));
  return db.all('SELECT key, value FROM settings').then(rows => {
    const values = Object.fromEntries([...ADMIN_RUNTIME_KEYS, ...ADMIN_SETTING_KEYS].map(key => [key, String((env as unknown as Record<string, unknown>)[key] || '')]));
    for (const row of rows) if ([...(ADMIN_RUNTIME_KEYS as readonly string[]), ...(ADMIN_SETTING_KEYS as readonly string[])].includes(String(row.key))) values[String(row.key)] = String(row.value ?? '');
    return values;
  }).catch(() => ({}));
}

async function users(db: Db, filters: { query?: string; status?: string; createdFrom?: number; createdTo?: number; activityFrom?: number; activityTo?: number; minProviders?: number } = {}): Promise<Record<string, unknown>[]> {
  try {
    const predicates = ['1 = 1'];
    const params: unknown[] = [];
    const having: string[] = [];
    const query = String(filters.query || '').trim().toLowerCase().slice(0, 200);
    const status = String(filters.status || '').trim().toLowerCase();
    if (query) { params.push(`%${query}%`); predicates.push(`lower(u.email) LIKE ?${params.length}`); }
    if (['pending', 'approved', 'declined', 'suspended', 'deleted'].includes(status)) { params.push(status); predicates.push(`u.status = ?${params.length}`); }
    if (Number.isFinite(filters.createdFrom) && Number(filters.createdFrom) > 0) { params.push(Number(filters.createdFrom)); predicates.push(`u.created_at >= ?${params.length}`); }
    if (Number.isFinite(filters.createdTo) && Number(filters.createdTo) > 0) { params.push(Number(filters.createdTo)); predicates.push(`u.created_at <= ?${params.length}`); }
    if (Number.isFinite(filters.activityFrom) && Number(filters.activityFrom) > 0) { params.push(Number(filters.activityFrom)); having.push(`COALESCE(MAX(v.last_activity), u.created_at) >= ?${params.length}`); }
    if (Number.isFinite(filters.activityTo) && Number(filters.activityTo) > 0) { params.push(Number(filters.activityTo)); having.push(`COALESCE(MAX(v.last_activity), u.created_at) <= ?${params.length}`); }
    if (Number.isFinite(filters.minProviders) && Number(filters.minProviders) > 0) { params.push(Number(filters.minProviders)); having.push(`COUNT(DISTINCT p.provider) >= ?${params.length}`); }
    const rows = await db.all(`SELECT u.id, u.email AS sender_email, u.status, u.created_at, u.last_seen_at,
      COUNT(DISTINCT v.id) AS conversations,
      COUNT(DISTINCT m.id) AS messages,
      MAX(v.last_activity) AS last_activity,
      COUNT(DISTINCT p.provider) AS provider_count,
      CASE WHEN b.sender_email IS NULL THEN 0 ELSE 1 END AS blocked
      FROM users u
      LEFT JOIN conversations v ON v.sender_email = u.email
      LEFT JOIN messages m ON m.conversation_id = v.id
      LEFT JOIN user_provider_connections p ON p.user_id = u.id
      LEFT JOIN sender_blocks b ON b.sender_email = u.email
      WHERE ${predicates.join(' AND ')}
      GROUP BY u.id, u.email, u.status, u.created_at, u.last_seen_at, b.sender_email
      ${having.length ? `HAVING ${having.join(' AND ')}` : ''}
      ORDER BY COALESCE(last_activity, u.created_at) DESC LIMIT 500`, ...params);
    return rows;
  } catch { return []; }
}

async function bootstrap(request: Request, env: AppEnv, db: Db, csrf: string): Promise<Response> {
  const settings = await publicSettings(env, db);
  const runtimeEnv = await applyRuntimeOverrides(env, db);
  const runtimeValues = runtimeEnv as unknown as Record<string, unknown>;
  return adminJson({ ok: true, csrf, settings, configuredSecrets: await configuredSecretNames(db, env), secretCatalog: [...ADMIN_SECRET_KEYS], google: { connected: Boolean(runtimeValues.GOOGLE_ACCESS_TOKEN), scopes: String(runtimeValues.GOOGLE_GRANTED_SCOPES || runtimeValues.GOOGLE_SCOPES || ''), expiresAt: Number(runtimeValues.GOOGLE_TOKEN_EXPIRES_AT || 0) || null }, github: { connected: Boolean(runtimeValues.GITHUB_ACCESS_TOKEN), scopes: String(runtimeValues.GITHUB_GRANTED_SCOPES || runtimeValues.GITHUB_SCOPES || ''), expiresAt: Number(runtimeValues.GITHUB_TOKEN_EXPIRES_AT || 0) || null }, users: await users(db), activeCapabilities: 0, bindings: bindingReport(runtimeEnv), guard: await guardStatus(db) });
}

export async function handleAdmin(request: Request, env: AppEnv, db: Db | undefined): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/admin' && request.method === 'GET') {
    const session = await readAdminSession(request, env.ADMIN_SESSION_SECRET);
    return adminPage(Boolean(session));
  }
  if (url.pathname === '/admin/login' && request.method === 'POST') {
    if (!configured(env)) return adminError('Admin is not configured. Set ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET as Worker secrets.', 503);
    if (!await loginAllowed(db, request)) return adminError('Too many login attempts. Try again later.', 429);
    const input = await bodyJson(request);
    const success = typeof input.password === 'string' && (await verifyAdminPassword(input.password, env.ADMIN_PASSWORD_HASH as string) || temporaryPasswordMatches(env, input.password));
    await recordLogin(db, request, success);
    if (!success) return adminError('Invalid credentials.', 401);
    const session = await makeAdminSession(env.ADMIN_SESSION_SECRET as string);
    return adminJson({ ok: true, csrf: session.csrf }, 200, { 'set-cookie': sessionCookie(session.value, session.expires - Math.floor(Date.now() / 1000)) });
  }
  if (!url.pathname.startsWith('/admin/')) return null;
  if (!configured(env)) return adminError('Admin is not configured.', 503);
  const session = await readAdminSession(request, env.ADMIN_SESSION_SECRET);
  if (!session) return adminError('Authentication required.', 401);
  if (!db) return adminError('D1 is required for the admin control plane.', 503);
  if (request.method !== 'GET' && !csrfValid(request, session)) return adminError('CSRF validation failed.', 403);
  if (url.pathname === '/admin/logout' && request.method === 'POST') return adminJson({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });

  if (url.pathname === '/admin/api/bootstrap' && request.method === 'GET') return bootstrap(request, env, db, session.csrf);
  if (url.pathname === '/admin/api/compaction' && request.method === 'GET') return adminJson({ ok: true, ...(await compactionHealth(db)) });
  if (url.pathname === '/admin/api/settings' && request.method === 'PUT') {
    const values = await bodyJson(request);
    return adminJson({ ok: true, updated: await saveRuntimeSettings(db, values) });
  }
  if (url.pathname === '/admin/api/secrets' && request.method === 'PUT') {
    const values = await bodyJson(request);
    return adminJson({ ok: true, updated: env.ADMIN_SESSION_SECRET ? await saveAdminSecrets(db, env.ADMIN_SESSION_SECRET, values) : [] });
  }
  if (url.pathname === '/admin/api/google/oauth/start' && request.method === 'GET') {
    try { return adminJson({ ok: true, ...(await beginGoogleOAuth(db, env, url.origin)) }); }
    catch (error) { return adminError(error instanceof Error ? error.message : 'Google OAuth setup failed.', 400); }
  }
  if (url.pathname === '/admin/api/google/oauth/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    if (!state || !code) return adminError('Google OAuth callback is missing state or code.', 400);
    try { await completeGoogleOAuth(db, env, state, code, fetch); return Response.redirect(`${url.origin}/admin?google=connected`, 303); }
    catch (error) { return adminError(error instanceof Error ? error.message : 'Google OAuth callback failed.', 400); }
  }
  if (url.pathname === '/admin/api/google/oauth' && request.method === 'DELETE') {
    await revokeGoogleOAuth(db, env, fetch);
    return adminJson({ ok: true });
  }
  if (url.pathname === '/admin/api/github/oauth/start' && request.method === 'GET') {
    try { return adminJson({ ok: true, ...(await beginGitHubOAuth(db, env, url.origin)) }); }
    catch (error) { return adminError(error instanceof Error ? error.message : 'GitHub OAuth setup failed.', 400); }
  }
  if (url.pathname === '/admin/api/github/oauth/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    if (!state || !code) return adminError('GitHub OAuth callback is missing state or code.', 400);
    try { await completeGitHubOAuth(db, env, state, code, fetch); return Response.redirect(`${url.origin}/admin?github=connected`, 303); }
    catch (error) { return adminError(error instanceof Error ? error.message : 'GitHub OAuth callback failed.', 400); }
  }
  if (url.pathname === '/admin/api/github/oauth' && request.method === 'DELETE') {
    await db.run("DELETE FROM admin_secrets WHERE name IN ('GITHUB_ACCESS_TOKEN', 'GITHUB_REFRESH_TOKEN', 'GITHUB_TOKEN_EXPIRES_AT', 'GITHUB_REFRESH_TOKEN_EXPIRES_AT', 'GITHUB_GRANTED_SCOPES')");
    return adminJson({ ok: true });
  }
  if (url.pathname === '/admin/api/users' && request.method === 'GET') return adminJson({ ok: true, users: await users(db, { query: url.searchParams.get('q') || '', status: url.searchParams.get('status') || '', createdFrom: Number(url.searchParams.get('created_from') || 0), createdTo: Number(url.searchParams.get('created_to') || 0), activityFrom: Number(url.searchParams.get('activity_from') || 0), activityTo: Number(url.searchParams.get('activity_to') || 0), minProviders: Number(url.searchParams.get('min_providers') || 0) }) });
  const bulkUsers = url.pathname.match(/^\/admin\/api\/users\/bulk\/(approve|decline)$/);
  if (bulkUsers && request.method === 'POST') {
    const input = await bodyJson(request);
    const ids = Array.isArray(input.ids) ? input.ids.map(value => Number(value)).filter(value => Number.isInteger(value) && value > 0).slice(0, 100) : [];
    if (!ids.length) return adminError('ids must contain at least one user ID.', 400);
    const next: UserStatus = bulkUsers[1] === 'approve' ? 'approved' : 'declined';
    const results: Record<string, unknown>[] = [];
    for (const id of ids) {
      try {
        const updated = await transitionUser(db, id, next, 'admin', typeof input.reason === 'string' ? input.reason : 'bulk review');
        await recordUserAudit(db, { userId: updated.id, actor: 'admin', action: `user-${bulkUsers[1]}`, targetType: 'user', targetId: updated.id, metadata: { bulk: true, reasonProvided: Boolean(input.reason) } });
        results.push({ id, ok: true, status: updated.status });
      } catch (error) { results.push({ id, ok: false, error: error instanceof Error ? error.message : 'transition failed' }); }
    }
    return adminJson({ ok: true, results });
  }
  const userAction = url.pathname.match(/^\/admin\/api\/users\/(\d+)\/(approve|decline|suspend|reinstate|delete)$/);
  if (userAction && request.method === 'POST') {
    const input = await bodyJson(request);
    const action = userAction[2];
    const next: UserStatus = action === 'approve' || action === 'reinstate' ? 'approved' : action === 'decline' ? 'declined' : action === 'suspend' ? 'suspended' : 'deleted';
    try {
      const updated = await transitionUser(db, Number(userAction[1]), next, 'admin', typeof input.reason === 'string' ? input.reason : '');
      await recordUserAudit(db, { userId: updated.id, actor: 'admin', action: `user-${action}`, targetType: 'user', targetId: updated.id, metadata: { reasonProvided: Boolean(input.reason) } });
      if (next === 'deleted') { await recordUserTombstone(db, updated); await deleteUserOwnedData(db, env, updated.id); await deleteSenderData(db, updated.email); }
      return adminJson({ ok: true, user: { id: updated.id, email: updated.email, status: updated.status } });
      } catch (error) { return adminError(error instanceof Error ? error.message : 'User transition failed.', 400); }
  }
  const userDetail = url.pathname.match(/^\/admin\/api\/users\/(\d+)$/);
  if (userDetail && request.method === 'GET') {
    const userId = Number(userDetail[1]);
    const user = await db.first('SELECT id, email, status, display_name, created_at, updated_at, approved_at, approved_by, last_seen_at, deleted_at FROM users WHERE id = ?1', userId);
    if (!user) return adminError('User not found.', 404);
    const [events, sessions, providers, outcomes, audit] = await Promise.all([
      db.all('SELECT actor, old_status, new_status, reason, created_at FROM user_lifecycle_events WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100', userId),
      db.all('SELECT id, created_at, last_seen_at, expires_at, revoked_at, request_fingerprint FROM user_sessions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50', userId),
      db.all('SELECT provider, granted_scopes, provider_subject, expires_at, status, created_at, updated_at FROM user_provider_connections WHERE user_id = ?1 ORDER BY provider', userId),
      db.all('SELECT id, kind, status, model, created_at, finished_at, steps, tool_calls, subrequests FROM runs WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50').catch(() => []),
      listUserAudit(db, userId)
    ]);
    return adminJson({ ok: true, user, events, sessions, providers, outcomes, audit });
  }
  const userGovernance = url.pathname.match(/^\/admin\/api\/users\/(\d+)\/(sessions\/revoke|connections\/revoke|audit)$/);
  if (userGovernance) {
    const userId = Number(userGovernance[1]);
    if (!(await db.first('SELECT id FROM users WHERE id = ?1', userId))) return adminError('User not found.', 404);
    if (userGovernance[2] === 'sessions/revoke' && request.method === 'POST') { await revokeAllUserSessions(db, userId); await recordUserAudit(db, { userId, actor: 'admin', action: 'sessions-revoked', targetType: 'session' }); return adminJson({ ok: true }); }
    if (userGovernance[2] === 'connections/revoke' && request.method === 'POST') {
      await db.run('DELETE FROM user_provider_connections WHERE user_id = ?1', userId);
      await recordUserAudit(db, { userId, actor: 'admin', action: 'connections-revoked', targetType: 'connection' });
      return adminJson({ ok: true });
    }
    if (userGovernance[2] === 'audit' && request.method === 'GET') return adminJson({ ok: true, events: await db.all('SELECT actor, old_status, new_status, reason, created_at FROM user_lifecycle_events WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 100', userId), audit: await listUserAudit(db, userId) });
  }
  const userPath = url.pathname.match(/^\/admin\/api\/users\/(.+)$/);
  if (userPath) {
    const sender = decodeURIComponent(userPath[1].replace(/\/block$/, ''));
    if (!sender || sender.length > 320) return adminError('Invalid sender.', 400);
    if (url.pathname.endsWith('/block') && request.method === 'POST') {
      const input = await bodyJson(request);
      if (input.blocked === false) await db.run('DELETE FROM sender_blocks WHERE sender_email = ?1', sender);
      else await db.run('INSERT INTO sender_blocks (sender_email, reason, created_at) VALUES (?1, ?2, unixepoch()) ON CONFLICT(sender_email) DO UPDATE SET reason = excluded.reason', sender, typeof input.reason === 'string' ? input.reason.slice(0, 500) : 'admin');
      return adminJson({ ok: true });
    }
    if (request.method === 'DELETE') { await deleteSenderData(db, sender); return adminJson({ ok: true }); }
  }
  return adminError('Admin route not found.', 404);
}
