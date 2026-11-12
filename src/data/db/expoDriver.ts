import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import { withTransactionQueue, type RunResult, type SqlDriver, type SqlValue } from './driver';

export const DATABASE_NAME = 'ticktack.db';

export function wrapExpoDatabase(db: SQLiteDatabase): SqlDriver {
  return withTransactionQueue({
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => {
      const r = await db.runAsync(sql, params as SqlValue[]);
      return { changes: r.changes, lastInsertRowId: r.lastInsertRowId } satisfies RunResult;
    },
    all: <T>(sql: string, params: readonly SqlValue[] = []) => db.getAllAsync<T>(sql, params as SqlValue[]),
    first: <T>(sql: string, params: readonly SqlValue[] = []) => db.getFirstAsync<T>(sql, params as SqlValue[]),
    transaction: async <T>(fn: () => Promise<T>) => {
      let result: T | undefined;
      await db.withTransactionAsync(async () => {
        result = await fn();
      });
      return result as T;
    },
    close: () => db.closeAsync(),
  });
}

export async function openExpoDriver(name = DATABASE_NAME): Promise<SqlDriver> {
  const db = await openDatabaseAsync(name);
  // WAL is a connection setting, not part of a migration. The web build (wa-sqlite on OPFS) ignores it.
  if (process.env.EXPO_OS !== 'web') {
    await db.execAsync('PRAGMA journal_mode = WAL;');
  }
  await db.execAsync('PRAGMA foreign_keys = ON;');
  return wrapExpoDatabase(db);
}
