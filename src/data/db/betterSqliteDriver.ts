/**
 * Node-only driver (Jest tests and scripts/seed.ts). Never imported by app code: Metro must not bundle it.
 */
import Database from 'better-sqlite3';

import { withTransactionQueue, type SqlDriver, type SqlValue } from './driver';

export function openBetterSqliteDriver(filename = ':memory:'): SqlDriver {
  const db = new Database(filename);
  if (filename !== ':memory:') db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  return withTransactionQueue({
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params: readonly SqlValue[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { changes: r.changes, lastInsertRowId: Number(r.lastInsertRowid) };
    },
    all: async <T>(sql: string, params: readonly SqlValue[] = []) => db.prepare(sql).all(...params) as T[],
    first: async <T>(sql: string, params: readonly SqlValue[] = []) =>
      (db.prepare(sql).get(...params) as T | undefined) ?? null,
    transaction: async <T>(fn: () => Promise<T>) => {
      db.exec('BEGIN');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: async () => {
      db.close();
    },
  });
}
