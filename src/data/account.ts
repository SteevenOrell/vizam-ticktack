/**
 * Account-level local data operations (ARCHITECTURE.md section 9):
 * - guest -> account: re-own every guest row to the uid in one transaction and queue it for upload;
 * - one account per local database (`sync_state.bound_uid`);
 * - sign-out / account deletion: wipe all local data (shared-device privacy).
 */
import { LOCAL_OWNER } from '../domain/models';
import { notifyDataChanged } from './changes';
import type { SqlDriver } from './db/driver';
import { entities, ENTITY_TYPES, type EntityDef } from './entities';
import { GUEST_PROFILE_ID } from './profile';

const SYNCED_TABLES = ENTITY_TYPES.map((t) => (entities[t] as EntityDef).table);
const LOCAL_TABLES = ['outbox', 'sync_state', 'scheduled_notifications', 'occurrence_window'];

export async function getSyncValue(db: SqlDriver, key: string): Promise<string | null> {
  const row = await db.first<{ value: string }>('SELECT value FROM sync_state WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setSyncValue(db: SqlDriver, key: string, value: string): Promise<void> {
  await db.run(
    'INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

export const getBoundUid = (db: SqlDriver) => getSyncValue(db, 'bound_uid');

/** Number of user-visible guest items (top-level tasks and series, goals, routines) on this device. */
export async function countGuestItems(db: SqlDriver): Promise<number> {
  let total = 0;
  for (const table of ['tasks', 'goals', 'routines']) {
    const row = await db.first<{ n: number }>(
      `SELECT count(*) AS n FROM ${table} WHERE owner_id = ? AND deleted = 0${table === 'tasks' ? ' AND parent_task_id IS NULL' : ''}`,
      [LOCAL_OWNER],
    );
    total += row?.n ?? 0;
  }
  return total;
}

/** Local changes not yet accepted by the server (shown before sign-out). */
export async function pendingChangeCount(db: SqlDriver): Promise<number> {
  const row = await db.first<{ n: number }>('SELECT count(*) AS n FROM outbox');
  return row?.n ?? 0;
}

/**
 * Moves guest data to the signed-in account and queues it for upload. Generated occurrences stay a local cache
 * (re-owned, not queued). With `keepGuestProfile: false` (signing in to an existing account) the guest profile is
 * dropped so the account's own profile is pulled instead of being overwritten.
 */
export async function adoptGuestData(
  db: SqlDriver,
  uid: string,
  options: { keepGuestProfile: boolean; now?: Date },
): Promise<number> {
  if (!uid || uid === LOCAL_OWNER) throw new Error('A signed-in uid is required');
  const at = (options.now ?? new Date()).getTime();
  let moved = 0;
  await db.transaction(async () => {
    const bound = await getBoundUid(db);
    if (bound && bound !== uid) throw new Error('This device is bound to another account; sign out first');

    // Profile: its ID is the owner ID, so it is re-keyed rather than updated.
    if (options.keepGuestProfile) {
      // An account profile already on this device (pulled earlier) wins over the guest one.
      const existing = await db.first<{ n: number }>('SELECT count(*) AS n FROM profile WHERE id = ?', [uid]);
      if ((existing?.n ?? 0) === 0) {
        await db.run(
          `UPDATE profile SET id = ?, owner_id = ?, dirty = 1, local_rev = local_rev + 1 WHERE id = ? AND owner_id = ?`,
          [uid, uid, GUEST_PROFILE_ID, LOCAL_OWNER],
        );
      }
    }
    await db.run('DELETE FROM profile WHERE owner_id = ?', [LOCAL_OWNER]);

    for (const type of ENTITY_TYPES) {
      if (type === 'profile') continue;
      const table = (entities[type] as EntityDef).table;
      const queued = type === 'occurrences' ? 'AND is_exception = 1' : '';
      const r = await db.run(
        `UPDATE ${table} SET owner_id = ?, dirty = 1, local_rev = local_rev + 1 WHERE owner_id = ? ${queued}`,
        [uid, LOCAL_OWNER],
      );
      moved += r.changes;
      if (type === 'occurrences') {
        await db.run('UPDATE task_occurrences SET owner_id = ? WHERE owner_id = ?', [uid, LOCAL_OWNER]);
      }
    }

    // Rebuild the outbox from every dirty row of the account (guest entries had no account to go to).
    await db.run('DELETE FROM outbox');
    for (const type of ENTITY_TYPES) {
      const table = (entities[type] as EntityDef).table;
      await db.run(
        `INSERT INTO outbox (entity_type, entity_id, op, enqueued_rev, attempts, next_attempt_at, state)
         SELECT ?, id, CASE WHEN deleted = 1 THEN 'delete' ELSE 'upsert' END, local_rev, 0, ?, 'pending'
         FROM ${table} WHERE owner_id = ? AND dirty = 1`,
        [type, at, uid],
      );
    }
    await setSyncValue(db, 'bound_uid', uid);
  });
  notifyDataChanged('local');
  return moved;
}

/** Binds an empty or already-bound database to `uid`. Returns false when another account owns the data. */
export async function bindAccount(db: SqlDriver, uid: string): Promise<boolean> {
  const bound = await getBoundUid(db);
  if (bound && bound !== uid) return false;
  if (!bound) await setSyncValue(db, 'bound_uid', uid);
  return true;
}

/** Deletes every local row (sign-out and account deletion). Schema and migrations stay. */
export async function wipeLocalData(db: SqlDriver): Promise<void> {
  await db.transaction(async () => {
    for (const table of [...SYNCED_TABLES, ...LOCAL_TABLES]) {
      await db.run(`DELETE FROM ${table}`);
    }
  });
  notifyDataChanged('local');
}
