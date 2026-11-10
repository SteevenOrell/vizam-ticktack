import type { SqlDriver } from './driver';
import { migration001 } from './migrations/001_initial';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Ordered list; versions must be 1, 2, 3, ... with no gaps. */
export const migrations: readonly Migration[] = [{ version: 1, name: '001_initial', sql: migration001 }];

export async function getSchemaVersion(db: SqlDriver): Promise<number> {
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

/**
 * Applies pending migrations in order, each in its own transaction together with the `user_version` bump, so a
 * failed migration leaves the database at the previous version. Returns the versions that were applied.
 */
export async function migrate(db: SqlDriver, list: readonly Migration[] = migrations): Promise<number[]> {
  list.forEach((m, i) => {
    if (m.version !== i + 1) throw new Error(`Migration list is not contiguous at ${m.name}`);
  });

  const current = await getSchemaVersion(db);
  if (current > list.length) {
    throw new Error(`Database schema ${current} is newer than this app (${list.length})`);
  }

  const applied: number[] = [];
  for (const m of list) {
    if (m.version <= current) continue;
    await db.transaction(async () => {
      await db.exec(m.sql);
      // PRAGMA cannot take bound parameters; the value is an integer from our own constant list.
      await db.exec(`PRAGMA user_version = ${Math.trunc(m.version)}`);
    });
    applied.push(m.version);
  }
  return applied;
}
