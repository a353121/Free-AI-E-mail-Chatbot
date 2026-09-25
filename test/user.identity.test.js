import test from 'node:test';
import assert from 'node:assert/strict';
import { getOrCreateUser } from '../src/data/users.ts';

test('a deleted identity is blocked during the deletion cooldown', async () => {
  const db = {
    async first(sql) {
      if (sql.includes('user_tombstones')) return { last_user_id: 9, deleted_at: 90, available_at: 200 };
      throw new Error('users should not be queried during cooldown');
    },
    async run() { throw new Error('writes should not occur during cooldown'); }
  };
  const result = await getOrCreateUser(db, 'person@example.com', 100);
  assert.equal(result.user, null);
  assert.equal(result.tombstoned, true);
  assert.equal(result.created, false);
});

test('after cooldown a deleted row is replaced by a new pending identity', async () => {
  const calls = [];
  let oldRow = true;
  const db = {
    async run(sql, ...params) {
      calls.push({ sql, params });
      if (sql.includes('DELETE FROM users')) oldRow = false;
      return { changed: sql.includes('INSERT OR IGNORE') && !oldRow ? 1 : 0 };
    },
    async first(sql) {
      if (sql.includes('user_tombstones')) return { last_user_id: 9, deleted_at: 90, available_at: 50 };
      return oldRow ? { id: 9, email: 'person@example.com', status: 'deleted', created_at: 10, updated_at: 20, last_seen_at: 20 } : { id: 10, email: 'person@example.com', status: 'pending', created_at: 100, updated_at: 100, last_seen_at: 100 };
    }
  };
  const result = await getOrCreateUser(db, 'person@example.com', 100);
  assert.equal(result.created, true);
  assert.equal(result.user?.id, 10);
  assert.equal(result.user?.status, 'pending');
  assert.ok(calls.some(call => call.sql.includes("status = 'deleted'")));
});
