import type { Db } from '../data/db.ts';
import type { AppEnv } from '../env.ts';
import { adminJson, adminError } from '../admin/response.ts';
import { clientFingerprint } from '../admin/auth.ts';
import { deleteSenderHistory } from '../data/sender.ts';
import { findUserByEmail, recordUserTombstone, transitionUser, normalizeUserEmail, deleteUserOwnedData } from '../data/users.ts';
import { decodeUserHistoryCursor, deleteUserAuth, consumeMagicLogin, createMagicLogin, encodeUserHistoryCursor, readUserSession, revokeAllUserSessions, revokeUserSession, userCsrfValid, userSessionCookies, clearUserSessionCookies } from './auth.ts';
import { enqueueUserLoginEmail, drainUserLoginOutbox } from './outbox.ts';
import { accountPage, loginPage } from './ui.ts';
import { listUserProviders, providerCatalog, saveUserProvider, deleteUserProvider, userToolEnv } from './providers.ts';
import { deleteUserFiles, getUserFile, removeUserFile, signedFilePath, validFileSignature } from '../data/files.ts';
import { deleteUserConversation, exportUserHistory, listUserConversations, readUserConversation } from '../data/history.ts';
import { deleteConversationSummaries, listConversationSummaries, regenerateConversationSummary } from '../data/compaction.ts';
import { beginUserGoogleOAuth, completeUserGoogleOAuth, beginUserGitHubOAuth, completeUserGitHubOAuth } from './oauth.ts';
import { nowSeconds } from '../shared.ts';
import { listUserAudit, recordUserAudit } from '../data/userAudit.ts';

async function bodyJson(request: Request): Promise<Record<string, unknown>> {
  try { const value = await request.json() as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; } catch { return {}; }
}
function genericLoginResponse(): Response { return adminJson({ ok: true, message: 'If this email is eligible, a sign-in link has been sent.' }); }
function withCookies(response: Response, cookies: string[]): Response { for (const cookie of cookies) response.headers.append('set-cookie', cookie); return response; }

export async function handleUser(request: Request, env: AppEnv, db: Db | undefined): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/login' && request.method === 'GET') return loginPage();
  if (url.pathname === '/login/request' && request.method === 'POST') {
    if (!db) return genericLoginResponse();
    const input = await bodyJson(request);
    let email: string;
    try { email = normalizeUserEmail(typeof input.email === 'string' ? input.email : ''); } catch { return genericLoginResponse(); }
    try {
      const user = await findUserByEmail(db, email);
      if (!user || user.status !== 'approved' || !env.ADMIN_SESSION_SECRET) return genericLoginResponse();
      const recent = await db.first('SELECT id FROM magic_login_tokens WHERE user_id = ?1 AND consumed_at IS NULL AND created_at > ?2 LIMIT 1', user.id, Math.floor(Date.now() / 1000) - 60);
      if (recent) return genericLoginResponse();
      const deliveryKey = `user-login:${user.id}:${crypto.randomUUID()}`;
      const login = await createMagicLogin(db, user, clientFingerprint(request), deliveryKey);
      const link = new URL('/login/verify', request.url);
      link.searchParams.set('token', login.token);
      await enqueueUserLoginEmail(db, env, { deliveryKey, userId: user.id, recipient: user.email, subject: 'Your sign-in link', body: `Use this one-time link to sign in to your account:\n\n${link.toString()}\n\nThis link expires in 15 minutes and can only be used once. If you did not request it, you can ignore this message.` });
      await drainUserLoginOutbox(db, env, 1);
    } catch { /* Enumeration-resistant response; the retryable queue records delivery failure. */ }
    return genericLoginResponse();
  }
  if (url.pathname === '/login/verify' && request.method === 'GET') {
    if (!db) return adminError('User login is not configured.', 503);
    const token = url.searchParams.get('token') || '';
    const result = await consumeMagicLogin(db, token);
    if (!result) return adminError('This sign-in link is invalid, expired, or already used.', 401);
    return withCookies(Response.redirect(`${url.origin}/account`, 303), userSessionCookies(result));
  }
  if (url.pathname === '/account' && request.method === 'GET') {
    const session = await readUserSession(request, db);
    return session ? accountPage() : Response.redirect(`${url.origin}/login`, 303);
  }
  if (url.pathname === '/logout' && request.method === 'POST') {
    const session = await readUserSession(request, db);
    if (session && db && !(await userCsrfValid(request, session))) return adminError('CSRF validation failed.', 403);
    if (session && db) await revokeUserSession(db, session.sessionId);
    return withCookies(Response.redirect(`${url.origin}/login`, 303), clearUserSessionCookies());
  }
  if (!url.pathname.startsWith('/user/')) return null;
  const session = await readUserSession(request, db);
  if (!session) return adminError('Authentication required.', 401);
  if (!db) return adminError('D1 is required for the user portal.', 503);
  if (!env.ADMIN_SESSION_SECRET) return adminError('The encrypted credential store is not configured.', 503);
  if (request.method !== 'GET' && !(await userCsrfValid(request, session))) return adminError('CSRF validation failed.', 403);
  if (url.pathname === '/user/api/me' && request.method === 'GET') {
    const sessions = await db.first('SELECT COUNT(*) AS count FROM user_sessions WHERE user_id = ?1 AND revoked_at IS NULL AND expires_at > unixepoch()', session.user.id);
    return adminJson({ ok: true, user: session.user, sessions: Number(sessions?.count || 0) });
  }
  if (url.pathname === '/user/api/audit' && request.method === 'GET') {
    return adminJson({ ok: true, events: await listUserAudit(db, session.user.id, Number(url.searchParams.get('limit') || 100)) });
  }
  if (url.pathname === '/user/api/sessions' && request.method === 'GET') {
    const sessions = await db.all('SELECT id, created_at, last_seen_at, expires_at, revoked_at, request_fingerprint FROM user_sessions WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 50', session.user.id);
    return adminJson({ ok: true, sessions: sessions.map(item => ({ id: Number(item.id), createdAt: Number(item.created_at), lastSeenAt: Number(item.last_seen_at), expiresAt: Number(item.expires_at), revoked: item.revoked_at != null, fingerprint: String(item.request_fingerprint || '').slice(0, 12) })) });
  }
  if (url.pathname === '/user/api/providers' && request.method === 'GET') return adminJson({ ok: true, providers: await listUserProviders(db, session.user.id, env.ADMIN_SESSION_SECRET), catalog: providerCatalog() });
  if (url.pathname === '/user/api/providers/google/oauth/start' && request.method === 'GET') {
    try { return adminJson({ ok: true, ...(await beginUserGoogleOAuth(db, env, session.user.id, url.origin)) }); } catch (error) { return adminError(error instanceof Error ? error.message : 'Google OAuth setup failed.', 400); }
  }
  if (url.pathname === '/user/api/providers/google/oauth/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state') || ''; const code = url.searchParams.get('code') || '';
    if (!state || !code) return adminError('Google OAuth callback is incomplete.', 400);
    try { await completeUserGoogleOAuth(db, env, state, code, fetch, session.user.id); return Response.redirect(`${url.origin}/account?google=connected`, 303); } catch (error) { return adminError(error instanceof Error ? error.message : 'Google OAuth callback failed.', 400); }
  }
  if (url.pathname === '/user/api/providers/github/oauth/start' && request.method === 'GET') {
    try { return adminJson({ ok: true, ...(await beginUserGitHubOAuth(db, env, session.user.id, url.origin)) }); } catch (error) { return adminError(error instanceof Error ? error.message : 'GitHub OAuth setup failed.', 400); }
  }
  if (url.pathname === '/user/api/providers/github/oauth/callback' && request.method === 'GET') {
    const state = url.searchParams.get('state') || ''; const code = url.searchParams.get('code') || '';
    if (!state || !code) return adminError('GitHub OAuth callback is incomplete.', 400);
    try { await completeUserGitHubOAuth(db, env, state, code, fetch, session.user.id); return Response.redirect(`${url.origin}/account?github=connected`, 303); } catch (error) { return adminError(error instanceof Error ? error.message : 'GitHub OAuth callback failed.', 400); }
  }
  const providerPath = url.pathname.match(/^\/user\/api\/providers\/([a-z0-9_-]+)$/i);
  if (providerPath && request.method === 'PUT') {
    const input = await bodyJson(request);
    const values = input.credentials && typeof input.credentials === 'object' && !Array.isArray(input.credentials) ? input.credentials as Record<string, unknown> : input;
    try { await saveUserProvider(db, env.ADMIN_SESSION_SECRET || '', session.user.id, providerPath[1], values, input.metadata && typeof input.metadata === 'object' ? input.metadata as Record<string, unknown> : {}); await recordUserAudit(db, { userId: session.user.id, actor: 'user', action: 'provider-connected', targetType: 'provider', targetId: providerPath[1] }); return adminJson({ ok: true }); }
    catch (error) { return adminError(error instanceof Error ? error.message : 'Provider connection failed.', 400); }
  }
  if (providerPath && request.method === 'DELETE') { await deleteUserProvider(db, session.user.id, providerPath[1]); await recordUserAudit(db, { userId: session.user.id, actor: 'user', action: 'provider-disconnected', targetType: 'provider', targetId: providerPath[1] }); return adminJson({ ok: true }); }
  if (url.pathname === '/user/api/logout' && request.method === 'POST') {
    await revokeUserSession(db, session.sessionId);
    await recordUserAudit(db, { userId: session.user.id, actor: 'user', action: 'session-logout', targetType: 'session', targetId: session.sessionId });
    return withCookies(adminJson({ ok: true }), clearUserSessionCookies());
  }
  if (url.pathname === '/user/api/sessions/revoke' && request.method === 'POST') {
    await revokeAllUserSessions(db, session.user.id);
    await recordUserAudit(db, { userId: session.user.id, actor: 'user', action: 'sessions-revoked', targetType: 'session' });
    return withCookies(adminJson({ ok: true }), clearUserSessionCookies());
  }
  if (url.pathname === '/user/api/history' && request.method === 'GET') {
    const cursor = await decodeUserHistoryCursor(env.ADMIN_SESSION_SECRET || '', session.user.id, url.searchParams.get('cursor'));
    const page = await listUserConversations(db, session.user.id, { limit: Number(url.searchParams.get('limit') || 20), cursor: cursor || undefined, query: url.searchParams.get('q') || '' });
    return adminJson({ ok: true, conversations: page.conversations, nextCursor: page.nextCursor ? await encodeUserHistoryCursor(env.ADMIN_SESSION_SECRET || '', session.user.id, page.nextCursor) : null });
  }
  if (url.pathname === '/user/api/history/export' && request.method === 'GET') {
    const archive = await exportUserHistory(db, session.user.id);
    const conversations = archive.conversations as Array<{ files?: Array<Record<string, unknown>> }>;
    for (const item of conversations) if (item.files) for (const file of item.files) file.download_path = await signedFilePath(env.ADMIN_SESSION_SECRET || '', session.user.id, Number(file.id));
    return new Response(JSON.stringify(archive), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="chat-history.json"', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  }
  const historyPath = url.pathname.match(/^\/user\/api\/history\/(\d+)$/);
  if (historyPath && request.method === 'GET') {
    const item = await readUserConversation(db, session.user.id, Number(historyPath[1]), { limit: Number(url.searchParams.get('limit') || 100), before: Number(url.searchParams.get('before') || 0) });
    if (item) for (const file of item.files) file.download_path = await signedFilePath(env.ADMIN_SESSION_SECRET || '', session.user.id, Number(file.id));
    return item ? adminJson({ ok: true, ...item }) : adminError('Conversation not found.', 404);
  }
  const summaryPath = url.pathname.match(/^\/user\/api\/history\/(\d+)\/summaries$/);
  if (summaryPath && request.method === 'GET') return adminJson({ ok: true, summaries: await listConversationSummaries(db, session.user.id, Number(summaryPath[1])) });
  if (summaryPath && request.method === 'POST') {
    const settings = await db.all("SELECT key, value FROM settings WHERE key IN ('compaction_trigger_tokens', 'compaction_target_tokens', 'compaction_keep_recent_tokens')");
    const values = Object.fromEntries(settings.map(row => [String(row.key), Number(row.value)]));
    const queued = await regenerateConversationSummary(
      db,
      session.user.id,
      Number(summaryPath[1]),
      Number.isFinite(values.compaction_trigger_tokens) ? values.compaction_trigger_tokens : 8000,
      Number.isFinite(values.compaction_target_tokens) ? values.compaction_target_tokens : 4000,
      Number.isFinite(values.compaction_keep_recent_tokens) ? values.compaction_keep_recent_tokens : 3000
    );
    return queued ? adminJson({ ok: true, queued: true }) : adminError('Conversation not found.', 404);
  }
  if (summaryPath && request.method === 'DELETE') return (await deleteConversationSummaries(db, session.user.id, Number(summaryPath[1]))) ? adminJson({ ok: true }) : adminError('Conversation not found.', 404);
  if (historyPath && request.method === 'DELETE') {
    const deleted = await deleteUserConversation(db, env, session.user.id, Number(historyPath[1]));
    if (deleted) await recordUserAudit(db, { userId: session.user.id, actor: 'user', action: 'conversation-deleted', targetType: 'conversation', targetId: historyPath[1] });
    return deleted ? adminJson({ ok: true }) : adminError('Conversation not found.', 404);
  }
  if (url.pathname === '/user/api/history' && request.method === 'DELETE') {
    await deleteUserFiles(db, env, session.user.id);
    await deleteSenderHistory(db, session.user.email);
    await recordUserAudit(db, { userId: session.user.id, actor: 'user', action: 'history-deleted', targetType: 'history' });
    return adminJson({ ok: true });
  }
  if (url.pathname === '/user/api/files' && request.method === 'GET') {
    const files = await db.all("SELECT id, filename, content_type, byte_size, checksum, status, created_at, expires_at FROM file_objects WHERE user_id = ?1 AND status = 'available' ORDER BY created_at DESC LIMIT 200", session.user.id);
    for (const file of files) file.download_path = await signedFilePath(env.ADMIN_SESSION_SECRET || '', session.user.id, Number(file.id));
    return adminJson({ ok: true, files });
  }
  const filePath = url.pathname.match(/^\/user\/api\/files\/(\d+)$/);
  if (filePath && request.method === 'GET') {
    if (!(await validFileSignature(env.ADMIN_SESSION_SECRET || '', session.user.id, Number(filePath[1]), url.searchParams.get('expires'), url.searchParams.get('signature')))) return adminError('File link is invalid or expired.', 404);
    const file = await getUserFile(db, env, session.user.id, Number(filePath[1]));
    if (!file?.object.body) return adminError('File not found.', 404);
    const filename = String(file.row.filename || 'download').replace(/[\r\n"\\]/g, '_');
    return new Response(file.object.body, { headers: { 'content-type': String(file.row.content_type || 'application/octet-stream'), 'content-length': String(file.row.byte_size || ''), 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  }
  if (filePath && request.method === 'DELETE') { const removed = await removeUserFile(db, env, session.user.id, Number(filePath[1])); if (removed) await recordUserAudit(db, { userId: session.user.id, actor: 'user', action: 'file-deleted', targetType: 'file', targetId: filePath[1] }); return adminJson({ ok: removed }); }
  if (url.pathname === '/user/api/account' && request.method === 'DELETE') {
    const authAge = await db.first('SELECT created_at FROM user_sessions WHERE id = ?1 AND revoked_at IS NULL', session.sessionId);
    if (Number(authAge?.created_at || 0) < nowSeconds() - 900) return adminError('Recent authentication is required before deleting the account. Request a new sign-in link.', 428);
    const deletedUser = await transitionUser(db, session.user.id, 'deleted', `user:${session.user.id}`, 'self-service deletion', clientFingerprint(request));
    await recordUserTombstone(db, deletedUser);
    await deleteUserOwnedData(db, env, session.user.id);
    await deleteUserAuth(db, session.user.id);
    await deleteSenderHistory(db, session.user.email);
    await db.run('DELETE FROM user_lifecycle_events WHERE user_id = ?1 AND new_status != \'deleted\'', session.user.id).catch(() => undefined);
    return withCookies(adminJson({ ok: true }), clearUserSessionCookies());
  }
  return adminError('User route not found.', 404);
}
