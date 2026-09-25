import type { D1Database } from '@cloudflare/workers-types';

/** Rows returned from queries. */
export type Row = Record<string, unknown>;

/** Bookkeeping returned by write/read ops. */
export interface DbResultMeta {
  changed?: number;
  lastRowId?: number;
  /** Rows read by this call (D1 billing-style accounting). */
  rowsRead?: number;
  /** Rows written by this call (D1 billing-style accounting). */
  rowsWritten?: number;
}

/** Minimal database contract shared by the D1 binding and the sqlite test double. */
export interface Db {
  all(sql: string, ...params: unknown[]): Promise<Row[]>;
  first(sql: string, ...params: unknown[]): Promise<Row | null>;
  run(sql: string, ...params: unknown[]): Promise<DbResultMeta>;
  batch(sqls: Array<{ sql: string; params: unknown[] }>): Promise<DbResultMeta[]>;
  transaction<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): void;
}

/** Accumulates rows-read/rows-written so usageGuard can forecast free-tier D1 limits. */
export class UsageAccountant {
  rowsRead = 0;
  rowsWritten = 0;

  add(meta: DbResultMeta): void {
    this.rowsRead += meta.rowsRead ?? 0;
    this.rowsWritten += meta.rowsWritten ?? 0;
  }

  reset(): void {
    this.rowsRead = 0;
    this.rowsWritten = 0;
  }
}

/** Wraps any Db and records per-call row counts into the accountant. */
export function countDb(db: Db, accountant: UsageAccountant): Db {
  const record = (meta: DbResultMeta): DbResultMeta => {
    accountant.add(meta);
    return meta;
  };

  return {
    async all(sql, ...params) {
      const rows = await db.all(sql, ...params);
      record({ rowsRead: rows.length });
      return rows;
    },
    async first(sql, ...params) {
      const row = await db.first(sql, ...params);
      record({ rowsRead: row ? 1 : 0 });
      return row;
    },
    async run(sql, ...params) {
      return record(await db.run(sql, ...params));
    },
    async batch(sqls) {
      const metas = await db.batch(sqls);
      metas.forEach(meta => record(meta));
      return metas;
    },
    async transaction(fn) {
      return db.transaction(fn);
    },
    close() {
      db.close();
    }
  };
}

/** Adapter from a D1 binding to the Db contract. */
export function createD1Db(d1: D1Database): Db {
  return {
    async all(sql, ...params) {
      const res = await d1.prepare(sql).bind(...params).all();
      return (res.results as Row[]) || [];
    },
    async first(sql, ...params) {
      const res = await d1.prepare(sql).bind(...params).first<Record<string, unknown>>();
      return res === null || res === undefined ? null : (res as unknown as Row);
    },
    async run(sql, ...params) {
      const res = await d1.prepare(sql).bind(...params).run();
      return {
        changed: res.meta?.changes,
        lastRowId: res.meta?.last_row_id,
        rowsRead: res.meta?.rows_read,
        rowsWritten: res.meta?.rows_written
      };
    },
    async batch(sqls) {
      const results = await d1.batch(sqls.map(({ sql, params }) => d1.prepare(sql).bind(...params)));
      return results.map(res => ({
        changed: res.meta?.changes,
        lastRowId: res.meta?.last_row_id,
        rowsRead: res.meta?.rows_read,
        rowsWritten: res.meta?.rows_written
      }));
    },
    async transaction(_fn) {
      throw new Error('D1 interactive transactions are unavailable; use batch() for atomic writes.');
    },
    close() {
      // D1 binding has no close.
    }
  };
}
