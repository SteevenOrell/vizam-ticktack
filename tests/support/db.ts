import { randomUUID } from 'crypto';

import { openBetterSqliteDriver } from '../../src/data/db/betterSqliteDriver';
import type { SqlDriver } from '../../src/data/db/driver';
import { migrate } from '../../src/data/db/migrate';
import type { DataContext } from '../../src/data/store';

/** Fresh in-memory database with migrations applied. */
export async function freshDb(): Promise<SqlDriver> {
  const db = openBetterSqliteDriver(':memory:');
  await migrate(db);
  return db;
}

/** 2026-11-09 10:30 local (a Monday). */
export const NOW = new Date(2026, 10, 9, 10, 30);
export const TODAY = '2026-11-09';

export function context(db: SqlDriver, ownerId = 'local', now: () => Date = () => NOW): DataContext {
  return { db, ownerId, newId: randomUUID, now };
}

export async function count(db: SqlDriver, sql: string, params: (string | number)[] = []): Promise<number> {
  const row = await db.first<{ n: number }>(sql, params);
  return row?.n ?? 0;
}
