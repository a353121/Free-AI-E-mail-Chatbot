import test from 'node:test';
import assert from 'node:assert/strict';

import { deleteUserConversation, listUserConversations, readUserConversation } from '../src/data/history.ts';
import { buildConversationBuffer } from '../src/data/memory.ts';
import { appendFileReferences } from '../src/data/files.ts';
import { decodeUserHistoryCursor, encodeUserHistoryCursor } from '../src/user/auth.ts';

class FakeDb {
  constructor() { this.calls = []; this.owner = true; }
  async all(sql, ...params) {
    this.calls.push({ type: 'all', sql, params });
    if (sql.includes('SELECT c.id')) return [{ id: 12, subject: 'Test thread', last_activity: 100, message_count: 2, last_message: 'hello' }];
    if (sql.includes('SELECT id, r2_key')) return [{ id: 4, r2_key: 'users/7/files/a' }];
    if (sql.includes('SELECT id, role, name, content')) return [{ id: 1, role: 'user', content: 'hello', created_at: 1 }];
    if (sql.includes('SELECT id, message_id')) return [{ id: 4, filename: 'a.txt', status: 'available' }];
    if (sql.includes('SELECT * FROM messages')) return [
      { id: 3, conversation_id: 12, user_id: 7, role: 'tool', name: 'lookup', content: 'result', tool_calls: null, tool_call_id: 'call_1' },
      { id: 2, conversation_id: 12, user_id: 7, role: 'assistant', content: null, tool_calls: '[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{}"}}]', tool_call_id: null },
      { id: 1, conversation_id: 12, user_id: 7, role: 'user', content: 'use a tool', tool_calls: null, tool_call_id: null }
    ];
    return [];
  }
  async first(sql, ...params) {
    this.calls.push({ type: 'first', sql, params });
    if (sql.includes('FROM conversations WHERE id = ?1 AND user_id = ?2')) return this.owner ? { id: 12, subject: 'Test thread', summary: null, metadata: '{}', last_activity: 100, created_at: 1 } : null;
    if (sql.includes('SELECT id FROM conversations')) return this.owner ? { id: 12 } : null;
    if (sql.includes('SELECT user_id FROM conversations')) return { user_id: 7 };
    if (sql.includes('SELECT content FROM messages')) return { content: 'hello' };
    return null;
  }
  async run(sql, ...params) { this.calls.push({ type: 'run', sql, params }); return { changed: 1, lastRowId: 4 }; }
  async batch(sqls) { return Promise.all(sqls.map(item => this.run(item.sql, ...item.params))); }
  async transaction(fn) { return fn(this); }
  close() {}
}

test('user history listing and transcript reads are scoped to the owner', async () => {
  const db = new FakeDb();
  const page = await listUserConversations(db, 7, { limit: 20 });
  assert.equal(page.conversations[0].id, 12);
  const transcript = await readUserConversation(db, 7, 12);
  assert.equal(transcript.messages[0].content, 'hello');
  db.owner = false;
  assert.equal(await readUserConversation(db, 99, 12), null);
});

test('deleting a conversation removes its R2 object before D1 metadata', async () => {
  const db = new FakeDb();
  const deleted = [];
  const env = { R2: { delete: async key => deleted.push(key) } };
  assert.equal(await deleteUserConversation(db, env, 7, 12), true);
  assert.deepEqual(deleted, ['users/7/files/a']);
  assert.ok(db.calls.some(call => call.sql.includes('DELETE FROM conversations')));
});

test('file references are kept as text in the D1 message', async () => {
  const db = new FakeDb();
  await appendFileReferences(db, 1, ['a.txt — /user/api/files/4']);
  const update = db.calls.find(call => call.sql.includes('UPDATE messages SET content'));
  assert.match(String(update.params[0]), /\/user\/api\/files\/4/);
  assert.doesNotMatch(String(update.params[0]), /users\/7\/files/);
});

test('context loading preserves assistant tool calls and matching tool results', async () => {
  const db = new FakeDb();
  const buffer = await buildConversationBuffer(db, 12);
  assert.deepEqual(buffer.messages.map(message => message.role), ['user', 'assistant', 'tool']);
  assert.equal(buffer.messages[1].tool_calls[0].id, 'call_1');
  assert.equal(buffer.messages[2].tool_call_id, 'call_1');
});

test('history cursors are signed and bound to the user', async () => {
  const cursor = await encodeUserHistoryCursor('test-secret', 7, 12);
  assert.equal(await decodeUserHistoryCursor('test-secret', 7, cursor), 12);
  assert.equal(await decodeUserHistoryCursor('test-secret', 8, cursor), null);
  assert.equal(await decodeUserHistoryCursor('wrong-secret', 7, cursor), null);
});
