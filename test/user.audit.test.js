import test from 'node:test';
import assert from 'node:assert/strict';
import { listUserAudit, recordUserAudit } from '../src/data/userAudit.ts';

test('user audit events are owner-scoped and redact credential-shaped metadata', async () => {
  const calls = [];
  const db = {
    async run(sql, ...params) { calls.push({ sql, params }); return { changed: 1 }; },
    async all(sql, ...params) { calls.push({ sql, params }); return [{ id: 3, user_id: 7, action: 'provider-connected' }]; }
  };
  await recordUserAudit(db, {
    userId: 7,
    actor: 'user',
    action: 'provider-connected',
    targetType: 'provider',
    targetId: 'github',
    metadata: { provider: 'github', accessToken: 'must-not-be-stored', reasonProvided: true }
  });
  assert.equal(calls[0].params[0], 7);
  assert.equal(calls[0].params[3], 'provider');
  assert.equal(calls[0].params[4], 'github');
  assert.equal(calls[0].params[5].includes('must-not-be-stored'), false);
  assert.equal(calls[0].params[5].includes('reasonProvided'), true);
  const events = await listUserAudit(db, 7, 20);
  assert.equal(calls[1].params[0], 7);
  assert.equal(calls[1].params[1], 20);
  assert.equal(events[0].user_id, 7);
});
