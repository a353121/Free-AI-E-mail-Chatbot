import type { Db } from '../data/db.ts';
import { forgetFacts, rememberFact } from '../data/memory.ts';
import { deleteSenderData } from '../data/sender.ts';
import type { AppConfig } from '../config/loader.ts';

export interface CommandResult { handled: boolean; reply?: string; body: string; }
export async function handleCommand(body: string, sender: string, db: Db | undefined, _config: AppConfig): Promise<CommandResult> {
  sender = sender.trim().toLowerCase();
  const trimmed = body.trim();
  const command = trimmed.match(/^!(help|usage|summary|delete-my-data)\b/i)?.[1]?.toLowerCase();
  if (command === 'help') return { handled: true, reply: 'Commands: !help, !usage, !summary, !delete-my-data, remember <fact>, forget <topic>. Put reset in the subject to clear memory.', body };
  if (command === 'summary') {
    if (!db) return { handled: true, reply: 'Conversation summaries require D1.', body };
    const row = await db.first('SELECT summary FROM conversations WHERE sender_email = ?1 ORDER BY last_activity DESC LIMIT 1', sender);
    return { handled: true, reply: String(row?.summary || 'There is no saved summary yet.'), body };
  }
  if (command === 'delete-my-data') {
    if (db) await deleteSenderData(db, sender);
    return { handled: true, reply: 'Your saved conversation, facts, and contact memory have been deleted.', body };
  }
  if (command === 'usage') {
    if (!db) return { handled: true, reply: 'Usage details require D1.', body };
    const row = await db.first('SELECT * FROM usage_guard ORDER BY day DESC LIMIT 1');
    return { handled: true, reply: row ? `Today: ${row.llm_calls ?? 0} model calls, ${row.d1_reads ?? 0} D1 reads, ${row.d1_writes ?? 0} D1 writes.` : 'No usage has been recorded yet.', body };
  }
  const remember = trimmed.match(/^remember\s+(.+)/i);
  if (remember) {
    if (!db) return { handled: true, reply: 'Remembering facts requires D1.', body };
    await rememberFact(db, sender, remember[1], 'command');
    return { handled: true, reply: `Remembered: ${remember[1]}`, body };
  }
  const forget = trimmed.match(/^forget\s+(.+)/i);
  if (forget) {
    if (!db) return { handled: true, reply: 'Forgetting facts requires D1.', body };
    const count = await forgetFacts(db, sender, forget[1]);
    return { handled: true, reply: `Forgot ${count} matching fact${count === 1 ? '' : 's'}.`, body };
  }
  return { handled: false, body };
}
